import { expect, test } from "bun:test"
import {
  REPLAY_DATASET_MANIFEST_SCHEMA_VERSION,
  REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION,
  REPLAY_REQUEST_SCHEMA_VERSION,
  REPLAY_SIMULATOR_POLICY_VERSION,
  replayDatasetHash,
  type ReplayDatasetManifest,
  type ReplayExecutionRequest,
  type ReplayFundingEvent,
  type ReplayMarketBar,
} from "../../../contracts/src/lib/replay-contracts"
import { executeReplayKernel } from "./replay-reference-engine"

const HASH = "a".repeat(64)

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
    dataset_manifest_ref: "dataset://fixture",
    dataset_hash: HASH,
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
    cost_policy: { policy_id: "fixture", version: "1", fee_bps: 2, slippage_bps: 1 },
    simulator_policy: {
      version: REPLAY_SIMULATOR_POLICY_VERSION,
      signal_visibility: "closed_candle",
      earliest_execution: "next_open",
      same_bar_policy: "stop_first",
      gap_fill_policy: "worse_open",
      position_accounting: "average_cost",
      funding_timing: "exact_event",
    },
    random_seed: 1,
  }
}

function bar(openTime: string, closeTime: string, open: number, high: number, low: number, close: number): ReplayMarketBar {
  return { open_time: openTime, close_time: closeTime, open, high, low, close, volume: 100, closed: true }
}

function inputFor(requestValue: ReplayExecutionRequest, bars: ReplayMarketBar[], fundingEvents: ReplayFundingEvent[] = []) {
  const dataHash = replayDatasetHash(bars, fundingEvents)
  const boundRequest = { ...requestValue, dataset_hash: dataHash }
  const datasetManifest: ReplayDatasetManifest = {
    schema_version: REPLAY_DATASET_MANIFEST_SCHEMA_VERSION,
    manifest_id: "manifest-fixture", manifest_ref: boundRequest.dataset_manifest_ref, data_hash: dataHash,
    dataset_kind: "ohlcv", symbol: boundRequest.symbol, timeframe: boundRequest.timeframe, interval_ms: 14_400_000,
    row_count: bars.length, first_open_time: bars[0].open_time, last_close_time: bars.at(-1)!.close_time,
    observed_through: bars.at(-1)!.close_time, closed_candles_only: true,
    bar_final_availability: "close_time", funding_availability: "event_time",
    instrument: {
      listed_at: "2020-01-01T00:00:00Z", trading_enabled_at: "2020-01-01T00:00:00Z", delisted_at: null, status_history: "complete",
      accounting: { spec_version: REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION, product_type: "linear_derivative", base_asset: "BTC", quote_asset: "USDT", settlement_asset: "USDT", contract_multiplier: "1", price_increment: "0.01", quantity_increment: "0.001", settlement_increment: "0.00000001" },
    },
    universe: { selected_at: "2026-07-13T00:00:00Z", survivorship: "point_in_time" },
  }
  return { request: boundRequest, dataset_manifest: datasetManifest, bars, funding_events: fundingEvents }
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
  expect(first.fills.at(-1)?.order_role).toBe("end_of_data")
  expect(first.order_events.map((event) => event.kind)).toEqual([
    "submitted", "activated", "filled",
    "submitted", "activated", "submitted", "activated",
    "cancelled", "cancelled", "submitted", "activated", "filled",
  ])
  expect(first.order_events.map((event) => event.sequence)).toEqual(first.order_events.map((_, index) => index + 1))
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
