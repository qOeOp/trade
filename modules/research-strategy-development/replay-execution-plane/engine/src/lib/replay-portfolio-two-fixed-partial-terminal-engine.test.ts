import { describe, expect, test } from "bun:test"
import {
  REPLAY_PARTIAL_REDUCE_INTENT_SCHEMA_VERSION,
  REPLAY_PARTIAL_REDUCE_PROTECTION_POLICY_VERSION,
  canonicalHash,
  type ReplayArtifactManifest,
  type ReplayFill,
  type ReplayPartialReduceIntent,
  type ReplayResult,
} from "../../../contracts/src/lib/replay-contracts"
import {
  assertReplayPortfolioTwoFixedPartialTerminalEvidence,
  replayPortfolioTwoFixedPartialStepHash,
  replayPortfolioTwoFixedPartialTerminalEvidenceHash,
  replayPortfolioTwoFixedPartialTerminalRecordHash,
} from "../../../contracts/src/lib/replay-portfolio-two-fixed-partial-terminal-contracts"
import {
  executeReplayPortfolioTwoFixedPartialTerminal,
  type ReplayPortfolioTwoFixedPartialTerminalLane,
} from "./replay-portfolio-two-fixed-partial-terminal-engine"

const key = (time: string, id: string) => ({ event_time: time, boundary_phase: 20 as const,
  source_sequence: 1, event_subphase: 0, stable_event_id: id })

describe("Portfolio two-fixed-partial terminal/risk successor", () => {
  test("binds generation two and three cash, exposure, and active-stop risk for long and short", () => {
    for (const side of ["long", "short"] as const) {
      const terminal = executeReplayPortfolioTwoFixedPartialTerminal(authority(lane(side, false)))
      const record = terminal.lane_records[0]!
      expect(record.partial_steps.map((step) => ({ generation: step.protection_generation,
        quantity: step.remaining_quantity, cash: step.settled_cash_after,
        exposure: step.mark_exposure_at_fill, risk: step.active_stop_bounded_risk_after }))).toEqual([
        { generation: 2, quantity: 0.7, cash: 100.5, exposure: side === "long" ? 73.5 : 66.5, risk: 7 },
        { generation: 3, quantity: 0.4, cash: 102.5, exposure: side === "long" ? 44 : 36, risk: 4 },
      ])
      expect(record).toMatchObject({ owner: "strategy_exit", ending_open: false, ending_quantity: 0,
        ending_settled_cash: 109.5, ending_reserved_isolated_collateral: 0,
        admission_frozen_stop_risk_amount: 10, ending_active_stop_bounded_risk_amount: 0,
        risk_budget_release_amount: 10 })
      expect(record.exact_risk_observations.map((observation) => [observation.source_kind,
        observation.protection_generation, observation.absolute_quantity])).toEqual([
        ["funding", 1, 1], ["mark", 1, 1], ["funding", 2, 0.7], ["mark", 2, 0.7],
        ["funding", 3, 0.4], ["mark", 3, 0.4],
      ])
      expect(terminal).toMatchObject({ ending_settled_cash: 109.5, ending_available_cash: 109.5,
        ending_portfolio_nav: 109.5, ending_gross_mark_exposure: 0,
        ending_active_stop_bounded_risk: 0, total_risk_budget_released: 10,
        exact_risk_observation_count: 6 })

      const open = executeReplayPortfolioTwoFixedPartialTerminal(authority(lane(side, true)))
      expect(open.lane_records[0]).toMatchObject({ owner: "generation_three_open_at_data_end", ending_open: true,
        ending_quantity: 0.4, ending_settled_cash: 102.5, ending_reserved_isolated_collateral: 20,
        ending_mark_price: side === "long" ? 115 : 85, ending_mark_exposure: side === "long" ? 46 : 34,
        ending_unrealized_pnl: 6, ending_active_stop_bounded_risk_amount: 4,
        risk_budget_release_amount: 0 })
      expect(open).toMatchObject({ ending_available_cash: 82.5, ending_unrealized_pnl: 6,
        ending_portfolio_nav: 108.5, ending_active_stop_bounded_risk: 4 })
    }
  })

  test("certifies current-generation terminal preemption at both partial boundaries and all post-second owners", () => {
    const cases = [
      [0, "stop", "initial_protective_stop", "terminal_before_first"],
      [0, "target", "initial_take_profit", "terminal_before_first"],
      [1, "stop", "generation_two_protective_stop", "first_filled_terminal_before_second"],
      [1, "target", "generation_two_take_profit", "first_filled_terminal_before_second"],
      [2, "stop", "generation_three_protective_stop", "both_filled_then_terminal"],
      [2, "target", "generation_three_take_profit", "both_filled_then_terminal"],
      [2, "strategy_exit", "strategy_exit", "both_filled_then_terminal"],
      [2, "liquidation", "exact_liquidation", "both_filled_then_terminal"],
    ] as const
    for (const [completedPartials, role, owner, status] of cases) {
      const evidence = executeReplayPortfolioTwoFixedPartialTerminal(authority(
        terminalLane("long", completedPartials, role)))
      const record = evidence.lane_records[0]!
      expect(record).toMatchObject({ owner, partial_status: status, ending_open: false,
        ending_quantity: 0, ending_reserved_isolated_collateral: 0,
        ending_active_stop_bounded_risk_amount: 0, risk_budget_release_amount: 10 })
      expect(record.partial_steps).toHaveLength(completedPartials)
      expect(record.partial_execution_statuses).toEqual(completedPartials === 0
        ? ["preempted_by_current_generation_terminal", "not_reached_prior_terminal"]
        : completedPartials === 1
          ? ["filled", "preempted_by_current_generation_terminal"] : ["filled", "filled"])
      expect(evidence.terminal_owner_counts[owner]).toBe(1)
      expect(record.liquidation_execution_hash === null).toBe(role !== "liquidation")
    }
  })

  test("fails closed on inconsistent preemption quantity and rehashed generation/quantity tamper", () => {
    const riskQuantityDrift = lane("long", false)
    riskQuantityDrift.replay.result.margin_snapshots[2]!.signed_quantity = 0.8
    expect(() => executeReplayPortfolioTwoFixedPartialTerminal(authority(riskQuantityDrift)))
      .toThrow("exact-risk Snapshot margin:3 authority drift")

    const late = terminalLane("long", 1, "stop")
    const lateTerminal = late.replay.result.fills.find((fill) => fill.fill_id === "fill:terminal")!
    lateTerminal.timestamp = "2026-07-14T00:06:00Z"
    lateTerminal.event_key = key(lateTerminal.timestamp, lateTerminal.fill_id)
    late.replay.result.source_events.push({ source_event_id: "source:late-terminal", kind: "bar_open",
      source_index: 99, event_key: { event_time: lateTerminal.timestamp, boundary_phase: 0,
        source_sequence: 99, event_subphase: 0, stable_event_id: "source:late-terminal" } })
    expect(() => executeReplayPortfolioTwoFixedPartialTerminal(authority(late)))
      .toThrow("did not preempt first executable boundary")

    const missing = lane("long", false)
    missing.replay.result.fills = missing.replay.result.fills.filter((fill) =>
      fill.fill_id !== "fill:partial:2")
    const inconsistentTerminal = missing.replay.result.fills.find((fill) => fill.fill_id === "fill:terminal")!
    inconsistentTerminal.timestamp = "2026-07-14T00:04:00Z"
    inconsistentTerminal.event_key = key(inconsistentTerminal.timestamp, inconsistentTerminal.fill_id)
    expect(() => executeReplayPortfolioTwoFixedPartialTerminal(authority(missing)))
      .toThrow("terminal Fill/Position quantity drift")

    const evidence = executeReplayPortfolioTwoFixedPartialTerminal(authority(lane("long", true)))
    const tampered = structuredClone(evidence)
    const record = tampered.lane_records[0]!
    record.partial_steps[1].protection_generation = 2
    record.partial_steps[1].step_hash = replayPortfolioTwoFixedPartialStepHash(record.partial_steps[1])
    record.record_hash = replayPortfolioTwoFixedPartialTerminalRecordHash(record)
    tampered.lane_records_hash = canonicalHash(tampered.lane_records)
    tampered.fingerprint_hash = canonicalHash({ source_terminal_evidence_hash: tampered.source_terminal_evidence_hash,
      source_terminal_artifact_manifest_hash: tampered.source_terminal_artifact_manifest_hash,
      risk_result_hash: tampered.risk_result_hash, lane_records_hash: tampered.lane_records_hash,
      limitations: tampered.limitations })
    tampered.evidence_hash = replayPortfolioTwoFixedPartialTerminalEvidenceHash(tampered)
    expect(() => assertReplayPortfolioTwoFixedPartialTerminalEvidence(tampered)).toThrow("partial step semantics")
  })
})

function authority(laneInput: ReplayPortfolioTwoFixedPartialTerminalLane) {
  return { portfolio_id: "portfolio-two-partial", settlement_asset: "USDT",
    source_terminal_evidence_hash: "a".repeat(64), source_terminal_artifact_manifest_hash: "b".repeat(64),
    risk_result_hash: "c".repeat(64), lanes: [laneInput] }
}

function lane(side: "long" | "short", open: boolean): ReplayPortfolioTwoFixedPartialTerminalLane {
  const entryPrice = 100
  const prices = side === "long" ? [105, 110, 120] : [95, 90, 80]
  const intents: [ReplayPartialReduceIntent, ReplayPartialReduceIntent] = [
    intent(side, "2026-07-14T00:01:00Z", "2026-07-14T00:02:00Z"),
    intent(side, "2026-07-14T00:03:00Z", "2026-07-14T00:04:00Z"),
  ]
  const fills: ReplayFill[] = [
    fill("fill:entry", "entry", side === "long" ? "buy" : "sell", 1, entryPrice, "2026-07-14T00:00:00Z"),
    fill("fill:partial:1", "strategy_partial_reduce", side === "long" ? "sell" : "buy", 0.3,
      prices[0]!, "2026-07-14T00:02:00Z", 1),
    fill("fill:partial:2", "strategy_partial_reduce", side === "long" ? "sell" : "buy", 0.3,
      prices[1]!, "2026-07-14T00:04:00Z", 1),
  ]
  if (!open) fills.push(fill("fill:terminal", "strategy_exit", side === "long" ? "sell" : "buy", 0.4,
    prices[2]!, "2026-07-14T00:06:00Z", 1))
  const position = (id: string, sequence: number, fillId: string, signed: number, realized: number,
    cumulative: number, time: string) => ({ position_event_id: id, position_id: "position:1", sequence,
      event_key: key(time, id), timestamp: time, cause_fill_id: fillId, symbol: "BTCUSDT",
      accounting_method: "average_cost" as const, numeric_policy_version: "rd-replay-number-v3" as const,
      state: signed === 0 ? "flat" as const : "open" as const,
      side: signed === 0 ? null : side, signed_quantity: signed, average_entry_price: signed === 0 ? null : 100,
      valuation_price: 100, valuation_source: "fill_price" as const, realized_pnl_delta: realized,
      realized_pnl_cumulative: cumulative, unrealized_pnl: 0 })
  const signed = side === "long" ? 1 : -1
  const positions: ReplayResult["positions"] = [
    position("position:entry", 1, "fill:entry", signed, 0, 0, "2026-07-14T00:00:00Z"),
    position("position:partial:1", 2, "fill:partial:1", signed * 0.7, 1.5, 1.5, "2026-07-14T00:02:00Z"),
    position("position:partial:2", 3, "fill:partial:2", signed * 0.4, 3, 4.5, "2026-07-14T00:04:00Z"),
  ]
  if (!open) positions.push(position("position:terminal", 4, "fill:terminal", 0, 8, 12.5,
    "2026-07-14T00:06:00Z"))
  const flows = [
    ["2026-07-14T00:02:00Z", 1.5, "pnl:1"], ["2026-07-14T00:02:00Z", -1, "fee:1"],
    ["2026-07-14T00:04:00Z", 3, "pnl:2"], ["2026-07-14T00:04:00Z", -1, "fee:2"],
    ...(!open ? [["2026-07-14T00:06:00Z", 8, "pnl:terminal"],
      ["2026-07-14T00:06:00Z", -1, "fee:terminal"]] : []),
  ] as Array<[string, number, string]>
  let balance = 100
  const ledger = flows.map(([time, amount, id], index) => {
    balance += amount
    const fillEventId = id.endsWith(":1") ? "fill:partial:1"
      : id.endsWith(":2") ? "fill:partial:2" : "fill:terminal"
    return { entry_id: id, event_key: key(time, fillEventId), timestamp: time,
      kind: id.startsWith("fee") ? "fee" as const : "realized_pnl" as const,
      amount, balance_after: balance, ref: id, sequence: index + 1 }
  }) as ReplayResult["ledger"]
  const requestHash = canonicalHash({ lane: side })
  const resultHash = canonicalHash({ side, open, fills, positions, ledger })
  const mark = side === "long" ? 115 : 85
  const sourceEvents: ReplayResult["source_events"] = ["2026-07-14T00:00:00Z", "2026-07-14T00:02:00Z",
    "2026-07-14T00:04:00Z", "2026-07-14T00:06:00Z"].map((time, index) => ({
    source_event_id: `source:open:${index}`, kind: "bar_open" as const, source_index: index,
    event_key: { event_time: time, boundary_phase: 0 as const, source_sequence: index,
      event_subphase: 0, stable_event_id: `source:open:${index}` },
  }))
  const riskFacts = [
    ["2026-07-14T00:01:00Z", "funding", 101, 1, "position:entry"],
    ["2026-07-14T00:01:30Z", "mark", 102, 1, "position:entry"],
    ["2026-07-14T00:03:00Z", "funding", 106, 0.7, "position:partial:1"],
    ["2026-07-14T00:03:30Z", "mark", 107, 0.7, "position:partial:1"],
    ["2026-07-14T00:05:00Z", "funding", 111, 0.4, "position:partial:2"],
    ["2026-07-14T00:05:30Z", "mark", 112, 0.4, "position:partial:2"],
  ] as const
  const riskSources = riskFacts.map(([time, kind], index) => ({
    source_event_id: `source:risk:${kind}:event-${index}`, kind, source_index: index,
    event_key: { event_time: time, boundary_phase: 10 as const, source_sequence: index + 10,
      event_subphase: 0, stable_event_id: `source:risk:${kind}:event-${index}` },
  }))
  sourceEvents.push(...riskSources)
  sourceEvents.sort((left, right) => Date.parse(left.event_key.event_time) - Date.parse(right.event_key.event_time))
  for (const source of riskSources.filter((candidate) => candidate.kind === "funding")) {
    ledger.push({ entry_id: `ledger:${source.source_event_id}`, event_key: source.event_key,
      timestamp: source.event_key.event_time, kind: "funding", amount: 0, balance_after: balance,
      ref: source.source_event_id })
  }
  const marginSnapshots = riskFacts.map(([time, kind, price, quantity, positionId], index) => {
    const source = riskSources[index]!
    const signedQuantity = signed * quantity
    const notional = price * quantity
    const unrealized = (price - 100) * signedQuantity
    const marginBalance = 20 + unrealized
    const maintenance = notional * 0.01
    return { policy_version: "rd-replay-isolated-margin-v7", venue_risk_policy_snapshot_id: "risk-policy-1",
      venue_risk_policy_snapshot_hash: "9".repeat(64), snapshot_id: `margin:${index + 1}`,
      snapshot_sequence: index + 1, stage: "path" as const, event_key: source.event_key, timestamp: time,
      position_event_id: positionId, mark_source_ref: source.source_event_id,
      mark_source: kind === "funding" ? "funding_mark" as const : "mark_event" as const,
      resolution: "exact" as const, symbol: "BTCUSDT", collateral_asset: "USDT",
      signed_quantity: signedQuantity, mark_price: price, notional, isolated_collateral: 20,
      attributed_settled_cashflow: 0, unrealized_pnl: unrealized, margin_balance: marginBalance,
      initial_margin_requirement: notional * 0.02, maintenance_margin_requirement: maintenance,
      initial_margin_headroom: marginBalance - notional * 0.02,
      maintenance_margin_headroom: marginBalance - maintenance,
      margin_ratio: maintenance / marginBalance, initial_margin_sufficient: true,
      maintenance_margin_sufficient: true,
      maintenance_trigger: "margin_balance_below_maintenance_requirement" as const,
      maintenance_breach_observed: false, breach_terminal_priority: "risk_before_strategy_exit" as const,
      state: "healthy" as const, liquidation_evaluated: false }
  }) as ReplayResult["margin_snapshots"]
  const result = { run_id: `run:${side}`, source_events: sourceEvents, fills, positions, ledger,
    margin_snapshots: marginSnapshots, liquidation: null,
    equity_bridge: { terminal_position_state: open ? "open" : "flat" },
    valuation_snapshot: { signed_quantity: open ? signed * 0.4 : 0, mark_price: mark,
      unrealized_pnl: open ? 6 : 0 }, fingerprint: { request_hash: requestHash, result_hash: resultHash },
  } as unknown as ReplayResult
  return { lane_id: `lane:${side}`, symbol: "BTCUSDT", request_hash: requestHash,
    source_terminal_record_hash: canonicalHash({ source: side }), side, initial_cash: 100,
    entry_price: 100, initial_quantity: 1, isolated_collateral: 20,
    stop_price: side === "long" ? 90 : 110, target_price: side === "long" ? 120 : 80,
    fee_bps: 0, slippage_bps: 0, price_increment: "0.1", settlement_increment: "0.1",
    partial_intents: intents, replay: { result,
      artifact_manifest: { run_id: result.run_id, result_hash: resultHash } as ReplayArtifactManifest } }
}

function terminalLane(side: "long" | "short", completedPartials: 0 | 1 | 2,
  role: "stop" | "target" | "strategy_exit" | "liquidation"):
  ReplayPortfolioTwoFixedPartialTerminalLane {
  const value = lane(side, false)
  const result = value.replay.result
  const terminalTime = completedPartials === 0 ? "2026-07-14T00:02:00Z"
    : completedPartials === 1 ? "2026-07-14T00:04:00Z" : "2026-07-14T00:06:00Z"
  const remaining = completedPartials === 0 ? 1 : completedPartials === 1 ? 0.7 : 0.4
  result.fills = result.fills.filter((fill) => fill.order_role !== "strategy_partial_reduce"
    || fill.fill_id === "fill:partial:1" && completedPartials >= 1
    || fill.fill_id === "fill:partial:2" && completedPartials >= 2)
  const terminal = result.fills.find((fill) => fill.fill_id === "fill:terminal")!
  terminal.order_role = role
  terminal.quantity = remaining
  terminal.timestamp = terminalTime
  terminal.event_key = key(terminalTime, terminal.fill_id)
  result.positions = result.positions.filter((position) => position.cause_fill_id !== "fill:partial:1"
    && position.cause_fill_id !== "fill:partial:2"
    || position.cause_fill_id === "fill:partial:1" && completedPartials >= 1
    || position.cause_fill_id === "fill:partial:2" && completedPartials >= 2)
  const terminalPosition = result.positions.find((position) => position.cause_fill_id === "fill:terminal")!
  terminalPosition.sequence = completedPartials + 2
  terminalPosition.timestamp = terminalTime
  terminalPosition.event_key = key(terminalTime, terminalPosition.position_event_id)
  result.source_events = result.source_events.filter((source) => source.event_key.event_time <= terminalTime)
  result.margin_snapshots = result.margin_snapshots.filter((snapshot) => snapshot.timestamp < terminalTime)
  result.ledger = result.ledger.filter((entry) => !entry.ref.endsWith(":1") || completedPartials >= 1)
    .filter((entry) => !entry.ref.endsWith(":2") || completedPartials >= 2)
    .filter((entry) => entry.timestamp <= terminalTime)
  let balance = 100
  for (const entry of result.ledger) {
    if (entry.ref.endsWith(":terminal")) {
      entry.timestamp = terminalTime
      entry.event_key = key(terminalTime, terminal.fill_id)
    }
    balance += entry.amount
    entry.balance_after = balance
  }
  if (role === "liquidation") {
    terminal.liquidation_fee = 1
    const triggerSnapshot = result.margin_snapshots.at(-1)!
    triggerSnapshot.maintenance_margin_sufficient = false
    triggerSnapshot.maintenance_breach_observed = true
    triggerSnapshot.state = "maintenance_breached"
    triggerSnapshot.maintenance_margin_headroom = -1
    triggerSnapshot.liquidation_evaluated = true
    const trigger = { schema_version: "trade.rd-replay-maintenance-breach-observation.v3",
      observation_id: `${triggerSnapshot.snapshot_id}:breach`, event_key: triggerSnapshot.event_key,
      timestamp: triggerSnapshot.timestamp, margin_snapshot_id: triggerSnapshot.snapshot_id,
      venue_risk_policy_snapshot_id: triggerSnapshot.venue_risk_policy_snapshot_id,
      venue_risk_policy_snapshot_hash: triggerSnapshot.venue_risk_policy_snapshot_hash,
      position_event_id: triggerSnapshot.position_event_id, mark_source_ref: triggerSnapshot.mark_source_ref,
      mark_source: triggerSnapshot.mark_source, resolution: "exact", trigger: triggerSnapshot.maintenance_trigger,
      trigger_state: "maintenance_breached", margin_balance: triggerSnapshot.margin_balance,
      maintenance_margin_requirement: triggerSnapshot.maintenance_margin_requirement,
      maintenance_margin_headroom: triggerSnapshot.maintenance_margin_headroom,
      terminal_priority: "risk_before_strategy_exit", execution_status: "simulated_full_close",
      authoritative_result: false } as const
    result.liquidation = { schema_version: "trade.rd-replay-liquidation-execution.v2",
      liquidation_id: "liquidation:1", simulator_policy_version: "rd-replay-simulator-v24",
      margin_policy_version: "rd-replay-isolated-margin-v7",
      venue_risk_policy_snapshot_id: triggerSnapshot.venue_risk_policy_snapshot_id,
      venue_risk_policy_snapshot_hash: triggerSnapshot.venue_risk_policy_snapshot_hash,
      cost_policy_id: "cost-1", cost_policy_version: "cost-v1", trigger_observation: trigger,
      execution_model: "trigger_mark_adverse_slippage_full_close",
      evidence_grade: "simulated_from_exact_risk_observation",
      strategy_order_action: "cancel_before_forced_order", liquidation_order_id: terminal.order_id,
      liquidation_fill_id: terminal.fill_id, quantity: terminal.quantity,
      trigger_mark_price: triggerSnapshot.mark_price, slippage_bps: 0, execution_price: terminal.price,
      trading_fee: terminal.fee, liquidation_fee_bps: 0, liquidation_fee: terminal.liquidation_fee,
      settlement_state: "flat_without_deficit" }
  } else {
    result.liquidation = null
  }
  const resultHash = canonicalHash({ side, completedPartials, role, fills: result.fills,
    positions: result.positions, ledger: result.ledger })
  result.fingerprint.result_hash = resultHash
  value.replay.artifact_manifest.result_hash = resultHash
  return value
}

function intent(side: "long" | "short", signal: string,
  executable: string): ReplayPartialReduceIntent {
  return { schema_version: REPLAY_PARTIAL_REDUCE_INTENT_SCHEMA_VERSION,
    side: side === "long" ? "sell" : "buy", order_type: "market", reduce_only: true,
    quantity_policy: "fixed_quantity", quantity: 0.3, signal_time: signal, earliest_executable_time: executable,
    post_fill_position_policy: "must_remain_open",
    protection_resize_policy: "after_fill_cancel_both_then_replace_remaining_at_same_source_boundary",
    protection_policy_version: REPLAY_PARTIAL_REDUCE_PROTECTION_POLICY_VERSION,
    replacement_trigger_policy: "preserve_current_stop_and_target_prices",
    remaining_quantity_authority: "absolute_post_fill_position",
    schedule_combination_policy: "up_to_two_partial_reduces_then_optional_final_full_exit_no_other_mutation" }
}
function fill(id: string, role: ReplayFill["order_role"], side: ReplayFill["side"], quantity: number,
  price: number, time: string, fee = 0): ReplayFill {
  return { fill_id: id, order_id: `order:${id}`, order_role: role, event_key: key(time, id), timestamp: time,
    side, quantity, price, fee, reduce_only: role !== "entry" }
}
