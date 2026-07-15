import { expect, test } from "bun:test"
import {
  REPLAY_DATASET_MANIFEST_SCHEMA_VERSION,
  REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION,
  REPLAY_INSTRUMENT_SPEC_SNAPSHOT_SCHEMA_VERSION,
  REPLAY_REQUEST_SCHEMA_VERSION,
  REPLAY_SIMULATOR_POLICY_VERSION,
  REPLAY_VENUE_RISK_POLICY_SCHEMA_VERSION,
  canonicalHash,
  replayDatasetHash,
  type ReplayDatasetManifest,
  type ReplayExecutionRequest,
  type ReplayFundingEvent,
  type ReplayMarkEvent,
  type ReplayMarketBar,
} from "../../../contracts/src/lib/replay-contracts"
import {
  ReplayExecutionInterruptedError,
  executeReplayKernel,
  type ReplayEngineCheckpoint,
} from "./replay-reference-engine"

const HASH = "a".repeat(64)
const MAINTENANCE_TIER = { tier_id: "tier-1", snapshot_ref: "fixture:margin-tier-1", snapshot_hash: HASH, notional_floor: 0, notional_cap: 50_000, maintenance_margin_rate: 0.005, maintenance_amount: 0 }
const RISK_SNAPSHOT = { schema_version: REPLAY_VENUE_RISK_POLICY_SCHEMA_VERSION, snapshot_id: "risk-1", venue_id: "binance-usdm", symbol: "BTCUSDT", effective_at: "2020-01-01T00:00:00Z", valid_until: null, observed_at: "2026-07-13T00:00:00Z", source_ref: "fixture:risk-1", source_hash: HASH, initial_margin_rate: 0.1, maintenance_tier: MAINTENANCE_TIER, liquidation_fee_bps: 50 }
const SPEC_SNAPSHOT = { schema_version: REPLAY_INSTRUMENT_SPEC_SNAPSHOT_SCHEMA_VERSION, snapshot_id: "spec-1", venue_id: "binance-usdm", symbol: "BTCUSDT", effective_at: "2020-01-01T00:00:00Z", valid_until: null, observed_at: "2026-07-13T00:00:00Z", source_ref: "fixture:spec-1", source_hash: HASH }
const ACCOUNTING = { spec_version: REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION, product_type: "linear_derivative" as const, base_asset: "BTC", quote_asset: "USDT", settlement_asset: "USDT", contract_multiplier: "1", price_increment: "0.01", quantity_increment: "0.001", settlement_increment: "0.00000001" }

function request(side: "long" | "short" = "long"): ReplayExecutionRequest {
  return {
    schema_version: REPLAY_REQUEST_SCHEMA_VERSION,
    run_id: `run-${side}`,
    idempotency_key: `key-${side}`,
    experiment_id: "experiment-1",
    trial_group_id: "group-1",
    trial_group_hash: HASH,
    trial_id: "trial-1",
    candidate_id: "candidate-1",
    candidate_hash: HASH,
    identity_hash_policy_version: "rd-identity-v1",
    experiment_contract_hash: HASH,
    trial_reservation_ref: "reservation://trial-1",
    trial_reservation_hash: HASH,
    dataset_manifest_ref: "dataset://fixture",
    dataset_hash: HASH,
    venue_risk_policy_snapshot_hash: canonicalHash(RISK_SNAPSHOT),
    instrument_spec_snapshot_hash: canonicalHash({ snapshot: SPEC_SNAPSHOT, accounting: ACCOUNTING }),
    harness_hash: HASH,
    assumptions_hash: HASH,
    symbol: "BTCUSDT",
    timeframe: "4h",
    initial_cash: 10_000,
    order: {
      side,
      quantity: 1,
      signal_time: "2026-07-14T00:00:00Z",
      earliest_executable_time: "2026-07-14T04:00:00Z",
      stop_price: side === "long" ? 95 : 105,
      target_price: side === "long" ? 110 : 90,
    },
    cost_policy: { policy_id: "fixture", version: "1", fee_bps: 2, slippage_bps: 1, liquidation_fee_bps: 50 },
    simulator_policy: {
      version: REPLAY_SIMULATOR_POLICY_VERSION,
      signal_visibility: "closed_candle",
      earliest_execution: "next_open",
      same_bar_policy: "stop_first",
      gap_fill_policy: "worse_open",
      position_accounting: "average_cost",
      funding_timing: "exact_event",
      end_of_data: "mark_open",
      margin_evaluation: "before_strategy_orders",
    },
    margin_policy: { policy_id: "fixture", version: "rd-replay-isolated-margin-v6", mode: "isolated", collateral_asset: "USDT", isolated_collateral: 1000, initial_margin_rate: 0.1, maintenance_tier: { ...MAINTENANCE_TIER }, cashflow_scope: "position_attributed", collateral_transfer: "reserve_at_entry_release_at_terminal_if_flat", settled_cashflow_account: "isolated_margin_collateral", observation_scope: "source_event_path", mark_source_policy: "complete_exact_mark_else_ohlcv_adverse", maintenance_trigger: "margin_balance_below_maintenance_requirement", breach_terminal_priority: "risk_before_strategy_exit", breach_evidence: "first_observed_source_event", maintenance_breach_action: "exact_observation_full_liquidation_else_terminal_failure", liquidation: "simulated_full_close", liquidation_trigger_sources: "mark_or_funding_mark", liquidation_execution_price: "trigger_mark_adverse_slippage", liquidation_quantity: "full_position", liquidation_order_priority: "cancel_strategy_exits_before_forced_fill", liquidation_deficit: "fail_without_result" },
    random_seed: 1,
  }
}

function bar(openTime: string, closeTime: string, open: number, high: number, low: number, close: number): ReplayMarketBar {
  return { open_time: openTime, close_time: closeTime, open, high, low, close, volume: 100, closed: true }
}

function inputFor(
  requestValue: ReplayExecutionRequest,
  bars: ReplayMarketBar[],
  fundingEvents: ReplayFundingEvent[] = [],
  markEvents: ReplayMarkEvent[] = [],
) {
  const dataHash = replayDatasetHash(bars, fundingEvents, markEvents)
  const venueRiskPolicy = {
    ...RISK_SNAPSHOT,
    initial_margin_rate: requestValue.margin_policy.initial_margin_rate,
    maintenance_tier: structuredClone(requestValue.margin_policy.maintenance_tier),
    liquidation_fee_bps: requestValue.cost_policy.liquidation_fee_bps,
  }
  const boundRequest = { ...requestValue, dataset_hash: dataHash, venue_risk_policy_snapshot_hash: canonicalHash(venueRiskPolicy) }
  const datasetManifest: ReplayDatasetManifest = {
    schema_version: REPLAY_DATASET_MANIFEST_SCHEMA_VERSION,
    manifest_id: "manifest-fixture", manifest_ref: boundRequest.dataset_manifest_ref, data_hash: dataHash,
    dataset_kind: "ohlcv", symbol: boundRequest.symbol, timeframe: boundRequest.timeframe, interval_ms: 14_400_000,
    row_count: bars.length, first_open_time: bars[0].open_time, last_close_time: bars.at(-1)!.close_time,
    observed_through: bars.at(-1)!.close_time, closed_candles_only: true,
    bar_final_availability: "close_time", funding_availability: "event_time", mark_availability: "event_time",
    mark_coverage: markEvents.length > 0 ? "complete_grid" : "none",
    mark_interval_ms: markEvents.length > 0 ? 14_400_000 : null,
    mark_event_count: markEvents.length,
    venue_risk_policy: venueRiskPolicy,
    instrument: {
      listed_at: "2020-01-01T00:00:00Z", trading_enabled_at: "2020-01-01T00:00:00Z", delisted_at: null, status_history: "complete",
      spec_snapshot: SPEC_SNAPSHOT,
      accounting: ACCOUNTING,
    },
    universe: { selected_at: "2026-07-13T00:00:00Z", survivorship: "point_in_time" },
  }
  return { request: boundRequest, dataset_manifest: datasetManifest, bars, funding_events: fundingEvents, mark_events: markEvents }
}

test("closed-candle signal enters at next open and resolves same-bar collision stop first", () => {
  const result = executeReplayKernel(inputFor(request(), [bar("2026-07-14T04:00:00Z", "2026-07-14T08:00:00Z", 100, 111, 94, 105)]))
  expect(result.fills.map((fill) => fill.order_role)).toEqual(["entry", "stop"])
  expect(result.order_events.find((event) => event.kind === "triggered")?.trigger_source).toBe("bar_range")
  expect(result.order_events.find((event) => event.kind === "triggered")?.trigger_observed_price).toBe(95)
  expect(result.limitations[0]?.severity).toBe("resolution_limited")
  expect(result.metrics.ending_equity).toBeLessThan(10_000)
})

test("stop gap fills at the worse open and ledger conserves equity", () => {
  const result = executeReplayKernel(inputFor(request(), [
      bar("2026-07-14T04:00:00Z", "2026-07-14T08:00:00Z", 100, 102, 98, 101),
      bar("2026-07-14T08:00:00Z", "2026-07-14T12:00:00Z", 90, 93, 88, 91),
  ]))
  expect(result.fills[1].order_role).toBe("stop")
  expect(result.fills[1].price).toBeLessThan(95)
  expect(result.order_events.find((event) => event.kind === "triggered")?.trigger_source).toBe("bar_open")
  expect(result.order_events.find((event) => event.kind === "triggered")?.trigger_observed_price).toBe(90)
  expect(result.ledger.at(-1)?.balance_after).toBe(result.metrics.ending_equity)
})

test("take-profit gap triggers from the observed open for long and short positions", () => {
  const cases = [
    {
      side: "long" as const,
      bars: [
        bar("2026-07-14T04:00:00Z", "2026-07-14T08:00:00Z", 100, 109, 98, 108),
        bar("2026-07-14T08:00:00Z", "2026-07-14T12:00:00Z", 120, 122, 118, 121),
      ],
      observedOpen: 120,
      expectedFill: 119.98,
    },
    {
      side: "short" as const,
      bars: [
        bar("2026-07-14T04:00:00Z", "2026-07-14T08:00:00Z", 100, 102, 95, 98),
        bar("2026-07-14T08:00:00Z", "2026-07-14T12:00:00Z", 80, 82, 78, 81),
      ],
      observedOpen: 80,
      expectedFill: 80.01,
    },
  ]

  for (const fixture of cases) {
    const result = executeReplayKernel(inputFor(request(fixture.side), fixture.bars))
    const trigger = result.order_events.find((event) => event.kind === "triggered")
    expect(result.fills[1].order_role).toBe("target")
    expect(result.fills[1].timestamp).toBe("2026-07-14T08:00:00Z")
    expect(trigger?.trigger_source).toBe("bar_open")
    expect(trigger?.trigger_observed_price).toBe(fixture.observedOpen)
    expect(result.fills[1].price).toBe(fixture.expectedFill)
  }
})

test("exact funding event enters the unified evidence ledger", () => {
  const fundingEvents = [{ timestamp: "2026-07-14T08:00:00Z", rate: 0.001, mark_price: 98 }]
  const result = executeReplayKernel(inputFor(request("short"), [
      bar("2026-07-14T04:00:00Z", "2026-07-14T08:00:00Z", 100, 102, 97, 98),
      bar("2026-07-14T08:00:00Z", "2026-07-14T12:00:00Z", 98, 100, 89, 90),
  ], fundingEvents))
  expect(result.metrics.total_funding).toBe(0.098)
  expect(result.ledger.some((entry) => entry.kind === "funding")).toBe(true)
})

test("funding uses the t-minus position at entry and exit boundaries", () => {
  const fundingEvents = [
    { timestamp: "2026-07-14T04:00:00Z", rate: 0.001, mark_price: 100 },
    { timestamp: "2026-07-14T12:00:00Z", rate: 0.001, mark_price: 110 },
  ]
  const result = executeReplayKernel(inputFor(request(), [
    bar("2026-07-14T04:00:00Z", "2026-07-14T08:00:00Z", 100, 109, 98, 108),
    bar("2026-07-14T08:00:00Z", "2026-07-14T12:00:00Z", 108, 111, 106, 110),
  ], fundingEvents))
  const fundingLedger = result.ledger.filter((entry) => entry.kind === "funding")
  expect(result.metrics.total_funding).toBe(-0.11)
  expect(fundingLedger).toHaveLength(1)
  expect(fundingLedger[0].ref).toContain("source:funding:2")
  expect(result.source_events.filter((event) => event.kind === "funding")).toHaveLength(2)
})

test("rerunning the same request and data is byte-semantically deterministic", () => {
  const input = inputFor(request(), [bar("2026-07-14T04:00:00Z", "2026-07-14T08:00:00Z", 100, 109, 98, 108)])
  const first = executeReplayKernel(input)
  expect(first).toEqual(executeReplayKernel(input))
  expect(first.fills.map((fill) => fill.order_role)).toEqual(["entry"])
  expect(first.order_events.map((event) => event.kind)).toEqual([
    "submitted", "activated", "filled",
    "submitted", "activated", "submitted", "activated",
    "cancelled", "cancelled",
  ])
  expect(first.order_events.map((event) => event.sequence)).toEqual(first.order_events.map((_, index) => index + 1))
  expect(first.positions.at(-1)?.state).toBe("open")
  expect(first.valuation_snapshot).toMatchObject({ mark_source: "bar_close", mark_price: 108 })
  expect(first.equity_bridge.terminal_position_state).toBe("open")
  expect(first.equity_bridge.ending_equity).toBe(first.metrics.ending_equity)
  expect(first.trial_balance.position_valuation_balance).toBe(first.metrics.unrealized_pnl)
  expect(first.limitations.some((item) => item.code === "end-of-data-open-position-marked")).toBe(true)
})

test("source-boundary checkpoint resumes to a byte-semantically identical result", () => {
  const replayInput = inputFor(request(), [
    bar("2026-07-14T04:00:00Z", "2026-07-14T08:00:00Z", 100, 104, 98, 102),
    bar("2026-07-14T08:00:00Z", "2026-07-14T12:00:00Z", 102, 106, 99, 104),
    bar("2026-07-14T12:00:00Z", "2026-07-14T16:00:00Z", 104, 111, 103, 110),
  ])
  const clean = executeReplayKernel(replayInput)
  let checkpoint: ReplayEngineCheckpoint | undefined

  try {
    executeReplayKernel({
      ...replayInput,
      execution_control: {
        on_checkpoint: (candidate) => {
          checkpoint = candidate
          return candidate.next_source_offset >= 2 ? "cancel" : "continue"
        },
      },
    })
    throw new Error("expected Replay checkpoint interruption")
  } catch (error) {
    expect(error).toBeInstanceOf(ReplayExecutionInterruptedError)
  }

  expect(checkpoint?.entry_transition?.signed_position_after).toBe(1)
  const resumed = executeReplayKernel({
    ...replayInput,
    execution_control: { resume_checkpoint: checkpoint! },
  })
  expect(resumed).toEqual(clean)
})

test("checkpoint hash and source prefix fencing reject tampered resume state", () => {
  const replayInput = inputFor(request(), [
    bar("2026-07-14T04:00:00Z", "2026-07-14T08:00:00Z", 100, 104, 98, 102),
    bar("2026-07-14T08:00:00Z", "2026-07-14T12:00:00Z", 102, 111, 99, 110),
  ])
  let checkpoint: ReplayEngineCheckpoint | undefined
  expect(() => executeReplayKernel({
    ...replayInput,
    execution_control: { on_checkpoint: (candidate) => {
      checkpoint = candidate
      return "cancel"
    } },
  })).toThrow(ReplayExecutionInterruptedError)
  checkpoint!.source_events[0].source_event_id = "tampered"
  expect(() => executeReplayKernel({
    ...replayInput,
    execution_control: { resume_checkpoint: checkpoint! },
  })).toThrow("source prefix hash")
})

test("terminal source completion wins over a cancellation that cannot be observed before it", () => {
  const replayInput = inputFor(request(), [
    bar("2026-07-14T04:00:00Z", "2026-07-14T08:00:00Z", 100, 111, 98, 110),
  ])
  let checkpointCount = 0
  const result = executeReplayKernel({
    ...replayInput,
    execution_control: { on_checkpoint: () => {
      checkpointCount += 1
      return checkpointCount >= 2 ? "cancel" : "continue"
    } },
  })
  expect(result.fills.at(-1)?.order_role).toBe("target")
  expect(checkpointCount).toBe(1)
})

test("Numeric Policy v3 rounds quantity down and rejects misaligned trigger prices", () => {
  const roundedRequest = request()
  roundedRequest.order.quantity = 1.0009
  const bars = [bar("2026-07-14T04:00:00Z", "2026-07-14T08:00:00Z", 100, 111, 99, 110)]
  const result = executeReplayKernel(inputFor(roundedRequest, bars))
  expect(result.fills.map((fill) => fill.quantity)).toEqual([1, 1])
  expect(result.limitations.some((item) => item.code === "quantity-rounded-down")).toBe(true)

  const misalignedRequest = request()
  misalignedRequest.order.stop_price = 95.005
  expect(() => executeReplayKernel(inputFor(misalignedRequest, bars))).toThrow("stop_price must align")
})

test("complete exact marks replace OHLCV margin observations and value the open terminal position", () => {
  const bars = [
    bar("2026-07-14T04:00:00Z", "2026-07-14T08:00:00Z", 100, 109, 98, 108),
    bar("2026-07-14T08:00:00Z", "2026-07-14T12:00:00Z", 108, 109, 100, 106),
  ]
  const marks: ReplayMarkEvent[] = [
    { timestamp: "2026-07-14T04:00:00Z", available_at: "2026-07-14T04:00:00Z", source_sequence: 1, mark_price: 100 },
    { timestamp: "2026-07-14T08:00:00Z", available_at: "2026-07-14T08:00:00Z", source_sequence: 2, mark_price: 104 },
    { timestamp: "2026-07-14T12:00:00Z", available_at: "2026-07-14T12:00:00Z", source_sequence: 3, mark_price: 103 },
  ]
  const result = executeReplayKernel(inputFor(request(), bars, [], marks))
  expect(result.fills).toHaveLength(1)
  expect(result.valuation_snapshot).toMatchObject({ mark_source: "mark_event", mark_price: 103 })
  expect(result.margin_snapshots.filter((snapshot) => snapshot.stage === "path").map((snapshot) => snapshot.mark_source)).toEqual(["mark_event", "mark_event"])
  expect(result.margin_snapshots.every((snapshot) => snapshot.mark_source !== "bar_open" && snapshot.mark_source !== "bar_adverse_extreme")).toBe(true)
  expect(result.limitations.some((item) => item.code === "ohlcv-margin-path-adverse-extreme")).toBe(false)
  expect(result.order_events.map((event) => event.kind)).toEqual([
    "submitted", "activated", "filled", "submitted", "activated", "submitted", "activated", "cancelled", "cancelled",
  ])
})

test("exact mark maintenance breach liquidates before same-time strategy exit", () => {
  const constrained = request()
  constrained.margin_policy = { ...constrained.margin_policy, isolated_collateral: 20 }
  constrained.cost_policy = { ...constrained.cost_policy, liquidation_fee_bps: 10 }
  const bars = [bar("2026-07-14T04:00:00Z", "2026-07-14T08:00:00Z", 100, 111, 99, 110)]
  const marks: ReplayMarkEvent[] = [
    { timestamp: "2026-07-14T04:00:00Z", available_at: "2026-07-14T04:00:00Z", source_sequence: 1, mark_price: 100 },
    { timestamp: "2026-07-14T08:00:00Z", available_at: "2026-07-14T08:00:00Z", source_sequence: 2, mark_price: 80.4 },
  ]
  const result = executeReplayKernel(inputFor(constrained, bars, [], marks))
  expect(result.fills.at(-1)).toMatchObject({ order_role: "liquidation", reduce_only: true, price: 80.39 })
  expect(result.positions.at(-1)).toMatchObject({ state: "flat", signed_quantity: 0 })
  expect(result.liquidation).toMatchObject({
    schema_version: "trade.rd-replay-liquidation-execution.v1",
    execution_model: "trigger_mark_adverse_slippage_full_close",
    evidence_grade: "simulated_from_exact_risk_observation",
    strategy_order_action: "cancel_before_forced_order",
    trigger_mark_price: 80.4,
    settlement_state: "flat_without_deficit",
    trigger_observation: {
      schema_version: "trade.rd-replay-maintenance-breach-observation.v2",
      mark_source: "mark_event",
      resolution: "exact",
      trigger: "margin_balance_below_maintenance_requirement",
      terminal_priority: "risk_before_strategy_exit",
      execution_status: "simulated_full_close",
      authoritative_result: false,
    },
  })
  expect(result.order_events.slice(-5).map((event) => event.kind)).toEqual(["cancelled", "cancelled", "submitted", "activated", "filled"])
  expect(result.order_events.slice(-5).every((event) => event.event_key.boundary_phase === 15)).toBe(true)
  expect(result.ledger.some((entry) => entry.kind === "liquidation_fee")).toBe(true)
  expect(result.metrics.total_liquidation_fees).toBeGreaterThan(0)
  expect(result.limitations.some((item) => item.code === "simulated-liquidation-execution")).toBe(true)
})

test("exact funding mark can trigger liquidation before a later OHLC exit", () => {
  const constrained = request()
  constrained.margin_policy = { ...constrained.margin_policy, isolated_collateral: 20 }
  constrained.cost_policy = { ...constrained.cost_policy, liquidation_fee_bps: 10 }
  const bars = [bar("2026-07-14T04:00:00Z", "2026-07-14T08:00:00Z", 100, 111, 99, 110)]
  const funding: ReplayFundingEvent[] = [{ timestamp: "2026-07-14T06:00:00Z", rate: 0, mark_price: 80.4 }]
  const result = executeReplayKernel(inputFor(constrained, bars, funding))
  expect(result.liquidation?.trigger_observation).toMatchObject({ mark_source: "funding_mark", resolution: "exact" })
  expect(result.fills.at(-1)).toMatchObject({ order_role: "liquidation", timestamp: "2026-07-14T06:00:00Z" })
  expect(result.source_events.at(-1)).toMatchObject({ kind: "funding" })
})

test("liquidation deficit is typed and publishes no synthetic insurance evidence", () => {
  const constrained = request()
  constrained.margin_policy = { ...constrained.margin_policy, isolated_collateral: 20 }
  constrained.cost_policy = { ...constrained.cost_policy, liquidation_fee_bps: 10 }
  const bars = [bar("2026-07-14T04:00:00Z", "2026-07-14T08:00:00Z", 100, 101, 1, 1)]
  const marks: ReplayMarkEvent[] = [
    { timestamp: "2026-07-14T04:00:00Z", available_at: "2026-07-14T04:00:00Z", source_sequence: 1, mark_price: 100 },
    { timestamp: "2026-07-14T08:00:00Z", available_at: "2026-07-14T08:00:00Z", source_sequence: 2, mark_price: 1 },
  ]
  try {
    executeReplayKernel(inputFor(constrained, bars, [], marks))
    throw new Error("expected liquidation deficit")
  } catch (error) {
    expect(error).toMatchObject({
      code: "liquidation-deficit-unsupported",
      terminal_snapshot: { mark_source: "mark_event", mark_price: 1, liquidation_evaluated: true },
      maintenance_breach: { execution_status: "simulated_full_close", authoritative_result: false },
    })
    expect((error as { remaining_collateral: number }).remaining_collateral).toBeLessThan(0)
  }
})
