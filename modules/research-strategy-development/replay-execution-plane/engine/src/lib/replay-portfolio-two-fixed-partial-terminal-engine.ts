import {
  REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_TERMINAL_EVIDENCE_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_TERMINAL_LIMITATIONS,
  REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_TERMINAL_POLICY_VERSION,
  assertReplayPortfolioTwoFixedPartialTerminalEvidence,
  replayPortfolioTwoFixedPartialExactRiskObservationHash,
  replayPortfolioTwoFixedPartialStepHash,
  replayPortfolioTwoFixedPartialTerminalEvidenceHash,
  replayPortfolioTwoFixedPartialTerminalRecordHash,
  summarizeReplayPortfolioTwoFixedPartialTerminalRecords,
  type ReplayPortfolioTwoFixedPartialExactRiskObservation,
  type ReplayPortfolioTwoFixedPartialStep,
  type ReplayPortfolioTwoFixedPartialTerminalEvidence,
  type ReplayPortfolioTwoFixedPartialTerminalOwner,
  type ReplayPortfolioTwoFixedPartialTerminalRecord,
} from "../../../contracts/src/lib/replay-portfolio-two-fixed-partial-terminal-contracts"
import {
  canonicalHash,
  compareReplayEventKeys,
  type ReplayArtifactManifest,
  type ReplayFill,
  type ReplayPartialReduceIntent,
  type ReplayResult,
} from "../../../contracts/src/lib/replay-contracts"
import {
  addReplayDecimalValues,
  quantizeReplayDifferenceProduct,
  quantizeReplayProduct,
} from "../../../contracts/src/lib/replay-decimal"
import { applyAdverseSlippageV3, calculateNotionalChargeV3 } from
  "../../../accounting/src/lib/replay-accounting"

export interface ReplayPortfolioTwoFixedPartialTerminalLane {
  lane_id: string
  symbol: string
  request_hash: string
  source_terminal_record_hash: string
  side: "long" | "short"
  initial_cash: number
  entry_price: number
  initial_quantity: number
  isolated_collateral: number
  stop_price: number
  target_price: number
  fee_bps: number
  slippage_bps: number
  price_increment: string
  settlement_increment: string
  partial_intents: [ReplayPartialReduceIntent, ReplayPartialReduceIntent]
  replay: { result: ReplayResult; artifact_manifest: ReplayArtifactManifest }
}
export interface ReplayPortfolioTwoFixedPartialTerminalEngineInput {
  portfolio_id: string
  settlement_asset: string
  source_terminal_evidence_hash: string
  source_terminal_artifact_manifest_hash: string
  risk_result_hash: string
  lanes: ReplayPortfolioTwoFixedPartialTerminalLane[]
}

export function executeReplayPortfolioTwoFixedPartialTerminal(
  input: ReplayPortfolioTwoFixedPartialTerminalEngineInput,
): ReplayPortfolioTwoFixedPartialTerminalEvidence {
  if (input.lanes.length === 0 || new Set(input.lanes.map((lane) => lane.lane_id)).size !== input.lanes.length) {
    throw new Error("Portfolio two-fixed-partial Lane authority is empty or duplicated")
  }
  const records = input.lanes.map(materializeRecord).sort((a, b) => a.lane_id.localeCompare(b.lane_id))
  const laneRecordsHash = canonicalHash(records)
  const terminalOwnerCounts = ownerCounts(records)
  const summary = summarizeReplayPortfolioTwoFixedPartialTerminalRecords(records)
  const fingerprintHash = canonicalHash({
    source_terminal_evidence_hash: input.source_terminal_evidence_hash,
    source_terminal_artifact_manifest_hash: input.source_terminal_artifact_manifest_hash,
    risk_result_hash: input.risk_result_hash,
    lane_records_hash: laneRecordsHash,
    exact_risk_observations_hash: summary.exact_risk_observations_hash,
    terminal_owner_counts: terminalOwnerCounts,
    limitations: REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_TERMINAL_LIMITATIONS,
  })
  const body: Omit<ReplayPortfolioTwoFixedPartialTerminalEvidence, "evidence_hash"> = {
    schema_version: REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_TERMINAL_EVIDENCE_SCHEMA_VERSION,
    policy_version: REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_TERMINAL_POLICY_VERSION,
    portfolio_id: input.portfolio_id,
    settlement_asset: input.settlement_asset,
    source_terminal_evidence_hash: input.source_terminal_evidence_hash,
    source_terminal_artifact_manifest_hash: input.source_terminal_artifact_manifest_hash,
    risk_result_hash: input.risk_result_hash,
    lane_records: records,
    lane_records_hash: laneRecordsHash,
    ...summary,
    terminal_owner_counts: terminalOwnerCounts,
    limitations: REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_TERMINAL_LIMITATIONS,
    fingerprint_hash: fingerprintHash,
  }
  const evidence = { ...body, evidence_hash: replayPortfolioTwoFixedPartialTerminalEvidenceHash(body) }
  assertReplayPortfolioTwoFixedPartialTerminalEvidence(evidence)
  return evidence
}

function materializeRecord(lane: ReplayPortfolioTwoFixedPartialTerminalLane): ReplayPortfolioTwoFixedPartialTerminalRecord {
  const { result, artifact_manifest: manifest } = lane.replay
  if (result.fingerprint.request_hash !== lane.request_hash || manifest.result_hash !== result.fingerprint.result_hash) {
    throw new Error(`Portfolio two-fixed-partial Lane ${lane.lane_id} Result identity drift`)
  }
  const entry = result.fills.find((fill) => fill.order_role === "entry")
  const partials = result.fills.filter((fill) => fill.order_role === "strategy_partial_reduce")
  if (!entry || entry.quantity !== lane.initial_quantity || entry.price !== lane.entry_price || partials.length > 2) {
    throw new Error(`Portfolio two-fixed-partial Lane ${lane.lane_id} entry or partial Fill cardinality drift`)
  }
  const steps = partials.map((fill, index) => {
    const intent = lane.partial_intents[index]
    const position = result.positions.find((candidate) => candidate.cause_fill_id === fill.fill_id)
    const previous = index === 0 ? lane.initial_quantity : Math.abs(result.positions.find(
      (candidate) => candidate.cause_fill_id === partials[index - 1]!.fill_id,
    )!.signed_quantity)
    if (!intent || fill.quantity !== intent.quantity || fill.timestamp < intent.earliest_executable_time
        || !result.source_events.some((source) => source.event_key.event_time === fill.timestamp)
        || !position || position.state !== "open"
        || Math.abs(position.signed_quantity) !== addReplayDecimalValues(previous, -fill.quantity)) {
      throw new Error(`Portfolio two-fixed-partial Lane ${lane.lane_id} partial ${index + 1} closure drift`)
    }
    const remaining = Math.abs(position.signed_quantity)
    const body: Omit<ReplayPortfolioTwoFixedPartialStep, "step_hash"> = {
      partial_sequence: (index + 1) as 1 | 2,
      protection_generation: (index + 2) as 2 | 3,
      intent_hash: canonicalHash(intent), fill_hash: canonicalHash(fill), event_key: structuredClone(fill.event_key),
      timestamp: fill.timestamp, filled_quantity: fill.quantity, fill_price: fill.price,
      realized_pnl_delta: position.realized_pnl_delta, trading_fee: fill.fee,
      remaining_quantity: remaining, settled_cash_after: settledCashAt(lane.initial_cash, result, fill.event_key),
      reserved_isolated_collateral_after: lane.isolated_collateral,
      mark_exposure_at_fill: quantizeReplayProduct([fill.price, remaining], 1, lane.settlement_increment, "ceil"),
      active_stop_bounded_risk_after: stopRisk(lane, remaining),
    }
    return { ...body, step_hash: replayPortfolioTwoFixedPartialStepHash(body) }
  })
  const terminal = result.fills.find((fill) => ["stop", "target", "strategy_exit", "liquidation"].includes(fill.order_role))
  const open = result.equity_bridge.terminal_position_state === "open"
  if (partials.length < 2 && !terminal || open && partials.length !== 2) {
    throw new Error(`Portfolio two-fixed-partial Lane ${lane.lane_id} missing current-generation terminal preemption`)
  }
  if (open === Boolean(terminal)) throw new Error(`Portfolio two-fixed-partial Lane ${lane.lane_id} terminal closure drift`)
  if (terminal && !result.source_events.some((source) => source.event_key.event_time === terminal.timestamp)) {
    throw new Error(`Portfolio two-fixed-partial Lane ${lane.lane_id} terminal lacks source-event authority`)
  }
  if (terminal && partials.length < 2) {
    const preemptedIntent = lane.partial_intents[partials.length]!
    const firstExecutableOpen = result.source_events.filter((source) => source.kind === "bar_open"
      && source.event_key.event_time >= preemptedIntent.earliest_executable_time)
      .sort((left, right) => compareReplayEventKeys(left.event_key, right.event_key))[0]
    if (firstExecutableOpen && terminal.timestamp > firstExecutableOpen.event_key.event_time) {
      throw new Error(`Portfolio two-fixed-partial Lane ${lane.lane_id} terminal did not preempt first executable boundary`)
    }
  }
  const terminalPosition = terminal && result.positions.find((position) => position.cause_fill_id === terminal.fill_id)
  const remainingBeforeTerminal = steps.at(-1)?.remaining_quantity ?? lane.initial_quantity
  if (terminal && (!terminalPosition || terminalPosition.state !== "flat"
      || terminal.quantity !== remainingBeforeTerminal)) {
    throw new Error(`Portfolio two-fixed-partial Lane ${lane.lane_id} terminal Fill/Position quantity drift`)
  }
  const endingQuantity = open ? Math.abs(result.valuation_snapshot.signed_quantity) : 0
  if (open && endingQuantity !== steps[1]!.remaining_quantity) {
    throw new Error(`Portfolio two-fixed-partial Lane ${lane.lane_id} ending quantity drift`)
  }
  const owner = terminalOwner(terminal?.order_role, partials.length, open)
  const exactRiskObservations = materializeExactRiskObservations(result, partials)
  const liquidationExecutionHash = liquidationClosureHash(result, terminal, exactRiskObservations)
  const endingSettled = result.ledger.at(-1)?.balance_after ?? lane.initial_cash
  const admissionRisk = stopRisk(lane, lane.initial_quantity)
  const body: Omit<ReplayPortfolioTwoFixedPartialTerminalRecord, "record_hash"> = {
    lane_id: lane.lane_id, symbol: lane.symbol, request_hash: lane.request_hash,
    source_terminal_record_hash: lane.source_terminal_record_hash,
    lane_result_hash: result.fingerprint.result_hash, lane_artifact_manifest_hash: canonicalHash(manifest),
    side: lane.side, entry_price: lane.entry_price, initial_quantity: lane.initial_quantity,
    isolated_collateral: lane.isolated_collateral, stop_price: lane.stop_price, target_price: lane.target_price,
    partial_status: partials.length === 0 ? "terminal_before_first"
      : partials.length === 1 ? "first_filled_terminal_before_second"
      : open ? "both_filled_open_at_data_end" : "both_filled_then_terminal",
    partial_intent_hashes: lane.partial_intents.map((intent) => canonicalHash(intent)) as [string, string],
    partial_execution_statuses: partials.length === 0
      ? ["preempted_by_current_generation_terminal", "not_reached_prior_terminal"]
      : partials.length === 1 ? ["filled", "preempted_by_current_generation_terminal"] : ["filled", "filled"],
    partial_steps: steps, exact_risk_observations: exactRiskObservations,
    exact_risk_observations_hash: canonicalHash(exactRiskObservations),
    owner, terminal_fill_hash: terminal ? canonicalHash(terminal) : null,
    liquidation_execution_hash: liquidationExecutionHash,
    terminal_time: terminal?.timestamp ?? null, ending_open: open, ending_quantity: endingQuantity,
    ending_settled_cash: endingSettled,
    ending_reserved_isolated_collateral: open ? lane.isolated_collateral : 0,
    ending_mark_price: open ? result.valuation_snapshot.mark_price : null,
    ending_mark_exposure: open ? quantizeReplayProduct(
      [result.valuation_snapshot.mark_price, endingQuantity], 1, lane.settlement_increment, "ceil") : 0,
    ending_unrealized_pnl: open ? result.valuation_snapshot.unrealized_pnl : 0,
    admission_frozen_stop_risk_amount: admissionRisk,
    ending_active_stop_bounded_risk_amount: open ? steps[1]!.active_stop_bounded_risk_after : 0,
    risk_budget_release_amount: open ? 0 : admissionRisk,
  }
  return { ...body, record_hash: replayPortfolioTwoFixedPartialTerminalRecordHash(body) }
}

function materializeExactRiskObservations(result: ReplayResult, partials: ReplayFill[]):
  ReplayPortfolioTwoFixedPartialExactRiskObservation[] {
  const snapshots = result.margin_snapshots.filter((snapshot) => snapshot.stage === "path"
    && snapshot.resolution === "exact"
    && (snapshot.mark_source === "funding_mark" || snapshot.mark_source === "mark_event"))
    .sort((left, right) => compareReplayEventKeys(left.event_key, right.event_key))
  return snapshots.map((snapshot, index) => {
    const source = result.source_events.find((candidate) => candidate.source_event_id === snapshot.mark_source_ref
      && compareReplayEventKeys(candidate.event_key, snapshot.event_key) === 0)
    const expectedSourceKind = snapshot.mark_source === "funding_mark" ? "funding" : "mark"
    const position = [...result.positions].reverse().find((candidate) =>
      compareReplayEventKeys(candidate.event_key, snapshot.event_key) <= 0)
    const completedPartials = partials.filter((fill) => compareReplayEventKeys(fill.event_key, snapshot.event_key) <= 0).length
    const funding = expectedSourceKind === "funding" ? result.ledger.find((entry) => entry.kind === "funding"
      && entry.ref === snapshot.mark_source_ref
      && compareReplayEventKeys(entry.event_key, snapshot.event_key) === 0) : null
    if (!source || source.kind !== expectedSourceKind || !position || position.state !== "open"
        || snapshot.state === "flat"
        || snapshot.signed_quantity !== position.signed_quantity || completedPartials > 2
        || expectedSourceKind === "funding" && !funding) {
      throw new Error(`Portfolio two-fixed-partial exact-risk Snapshot ${snapshot.snapshot_id} authority drift`)
    }
    const body: Omit<ReplayPortfolioTwoFixedPartialExactRiskObservation, "observation_hash"> = {
      observation_sequence: index + 1, snapshot_hash: canonicalHash(snapshot),
      source_event_hash: canonicalHash(source), source_event_id: source.source_event_id,
      event_key: structuredClone(snapshot.event_key), source_kind: expectedSourceKind,
      protection_generation: (completedPartials + 1) as 1 | 2 | 3,
      signed_quantity: snapshot.signed_quantity, absolute_quantity: Math.abs(snapshot.signed_quantity),
      mark_price: snapshot.mark_price, notional: snapshot.notional,
      isolated_collateral: snapshot.isolated_collateral,
      attributed_settled_cashflow: snapshot.attributed_settled_cashflow,
      unrealized_pnl: snapshot.unrealized_pnl, margin_balance: snapshot.margin_balance,
      initial_margin_requirement: snapshot.initial_margin_requirement,
      maintenance_margin_requirement: snapshot.maintenance_margin_requirement,
      maintenance_margin_headroom: snapshot.maintenance_margin_headroom,
      margin_ratio: snapshot.margin_ratio,
      state: snapshot.state as ReplayPortfolioTwoFixedPartialExactRiskObservation["state"],
      maintenance_breach_observed: snapshot.maintenance_breach_observed,
      liquidation_evaluated: snapshot.liquidation_evaluated,
      funding_cashflow: funding?.amount ?? null,
    }
    return { ...body, observation_hash: replayPortfolioTwoFixedPartialExactRiskObservationHash(body) }
  })
}

function liquidationClosureHash(result: ReplayResult, terminal: ReplayFill | undefined,
  observations: ReplayPortfolioTwoFixedPartialExactRiskObservation[]): string | null {
  const liquidation = result.liquidation
  if (terminal?.order_role !== "liquidation") {
    if (liquidation) throw new Error("Portfolio two-fixed-partial non-liquidation owner carries Liquidation evidence")
    return null
  }
  const trigger = liquidation?.trigger_observation
  const triggerSnapshot = trigger && result.margin_snapshots.find((snapshot) =>
    snapshot.snapshot_id === trigger.margin_snapshot_id)
  if (!liquidation || liquidation.evidence_grade !== "simulated_from_exact_risk_observation"
      || liquidation.execution_model !== "trigger_mark_adverse_slippage_full_close"
      || liquidation.settlement_state !== "flat_without_deficit"
      || liquidation.liquidation_fill_id !== terminal.fill_id
      || liquidation.quantity !== terminal.quantity || !trigger
      || trigger.execution_status !== "simulated_full_close"
      || trigger.resolution !== "exact" || !triggerSnapshot
      || !observations.some((observation) => observation.snapshot_hash === canonicalHash(triggerSnapshot)
        && observation.maintenance_breach_observed)) {
    throw new Error("Portfolio two-fixed-partial exact Liquidation closure drift")
  }
  return canonicalHash(liquidation)
}

function settledCashAt(initial: number, result: ReplayResult, key: ReplayPortfolioTwoFixedPartialStep["event_key"]): number {
  return addReplayDecimalValues(initial, ...result.ledger.filter((entry) =>
    entry.kind !== "initial_cash" && entry.kind !== "ending_cash"
      && compareReplayEventKeys(entry.event_key, key) <= 0).map((entry) => entry.amount))
}
function terminalOwner(role: string | undefined, completedPartials: number,
  open: boolean): ReplayPortfolioTwoFixedPartialTerminalOwner {
  if (open) return "generation_three_open_at_data_end"
  if (role === "stop") return completedPartials === 0 ? "initial_protective_stop"
    : completedPartials === 1 ? "generation_two_protective_stop" : "generation_three_protective_stop"
  if (role === "target") return completedPartials === 0 ? "initial_take_profit"
    : completedPartials === 1 ? "generation_two_take_profit" : "generation_three_take_profit"
  if (role === "liquidation") return "exact_liquidation"
  if (role === "strategy_exit") return "strategy_exit"
  throw new Error("Portfolio two-fixed-partial flat Lane lacks terminal owner")
}
function ownerCounts(records: ReplayPortfolioTwoFixedPartialTerminalRecord[]) {
  const owners: ReplayPortfolioTwoFixedPartialTerminalOwner[] = [
    "initial_protective_stop", "initial_take_profit", "generation_two_protective_stop",
    "generation_two_take_profit", "generation_three_protective_stop", "generation_three_take_profit",
    "exact_liquidation", "strategy_exit", "generation_three_open_at_data_end",
  ]
  return Object.fromEntries(owners.map((owner) => [owner,
    records.filter((record) => record.owner === owner).length])) as
    Record<ReplayPortfolioTwoFixedPartialTerminalOwner, number>
}
function stopRisk(lane: ReplayPortfolioTwoFixedPartialTerminalLane, quantity: number): number {
  const execution = applyAdverseSlippageV3(lane.stop_price, lane.side === "long" ? "sell" : "buy",
    lane.slippage_bps, lane.price_increment)
  const loss = quantizeReplayDifferenceProduct(lane.entry_price, execution, quantity,
    lane.side === "long" ? 1 : -1, lane.settlement_increment, "ceil")
  return addReplayDecimalValues(loss,
    calculateNotionalChargeV3(execution, quantity, lane.fee_bps, lane.settlement_increment))
}
