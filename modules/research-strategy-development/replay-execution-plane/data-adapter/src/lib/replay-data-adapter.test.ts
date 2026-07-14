import { expect, test } from "bun:test"
import {
  REPLAY_DATASET_MANIFEST_SCHEMA_VERSION,
  REPLAY_REQUEST_SCHEMA_VERSION,
  REPLAY_SIMULATOR_POLICY_VERSION,
  replayDatasetHash,
  type ReplayDatasetManifest,
  type ReplayExecutionRequest,
  type ReplayFundingEvent,
  type ReplayMarketBar,
} from "../../../contracts/src/lib/replay-contracts"
import { fundingEventsInWindow, prepareReplayInputData } from "./replay-data-adapter"

const HASH = "a".repeat(64)
const bars: ReplayMarketBar[] = [
  { open_time: "2026-07-14T00:00:00Z", close_time: "2026-07-14T04:00:00Z", open: 100, high: 105, low: 95, close: 101, volume: 1, closed: true },
  { open_time: "2026-07-14T04:00:00Z", close_time: "2026-07-14T08:00:00Z", open: 101, high: 106, low: 96, close: 102, volume: 1, closed: true },
]
const fundingEvents: ReplayFundingEvent[] = [
  { timestamp: "2026-07-14T03:00:00Z", rate: 0.001, mark_price: 100 },
  { timestamp: "2026-07-14T06:00:00Z", rate: 0.002, mark_price: 102 },
]

function request(dataHash = replayDatasetHash(bars, fundingEvents)): ReplayExecutionRequest {
  return {
    schema_version: REPLAY_REQUEST_SCHEMA_VERSION,
    run_id: "run-1", idempotency_key: "key-1", experiment_id: "experiment-1",
    trial_group_id: "group-1", trial_group_hash: HASH, trial_id: "trial-1",
    candidate_id: "candidate-1", candidate_hash: HASH, identity_hash_policy_version: "identity-v1",
    experiment_contract_hash: HASH, dataset_manifest_ref: "dataset://fixture", dataset_hash: dataHash,
    harness_hash: HASH, assumptions_hash: HASH, symbol: "BTCUSDT", timeframe: "4h", initial_cash: 1000,
    order: { side: "long", quantity: 1, signal_time: "2026-07-14T00:00:00Z", earliest_executable_time: "2026-07-14T04:00:00Z", stop_price: 95, target_price: 110 },
    cost_policy: { policy_id: "fixture", version: "1", fee_bps: 0, slippage_bps: 0 },
    simulator_policy: { version: REPLAY_SIMULATOR_POLICY_VERSION, signal_visibility: "closed_candle", earliest_execution: "next_open", same_bar_policy: "stop_first", gap_fill_policy: "worse_open", position_accounting: "average_cost", funding_timing: "exact_event" },
    random_seed: 1,
  }
}

function manifest(dataHash = replayDatasetHash(bars, fundingEvents)): ReplayDatasetManifest {
  return {
    schema_version: REPLAY_DATASET_MANIFEST_SCHEMA_VERSION,
    manifest_id: "manifest-1", manifest_ref: "dataset://fixture", data_hash: dataHash,
    dataset_kind: "ohlcv", symbol: "BTCUSDT", timeframe: "4h", interval_ms: 14_400_000,
    row_count: bars.length, first_open_time: bars[0].open_time, last_close_time: bars.at(-1)!.close_time,
    observed_through: "2026-07-14T08:00:00Z", closed_candles_only: true,
    bar_final_availability: "close_time", funding_availability: "event_time",
    instrument: { listed_at: "2020-01-01T00:00:00Z", trading_enabled_at: "2020-01-01T00:00:00Z", delisted_at: null, status_history: "complete" },
    universe: { selected_at: "2026-07-13T00:00:00Z", survivorship: "point_in_time" },
  }
}

test("data adapter verifies manifest binding and selects the first executable bar", () => {
  const prepared = prepareReplayInputData({ request: request(), dataset_manifest: manifest(), bars, funding_events: fundingEvents })
  expect(prepared.entry_index).toBe(1)
  expect(prepared.limitations).toEqual([])
  expect(fundingEventsInWindow(prepared.funding_events, "2026-07-14T04:00:00Z", "2026-07-14T08:00:00Z")).toHaveLength(1)
})

test("data adapter rejects unordered funding instead of sorting silently", () => {
  const unordered = [...fundingEvents].reverse()
  expect(() => prepareReplayInputData({ request: request(replayDatasetHash(bars, unordered)), dataset_manifest: manifest(replayDatasetHash(bars, unordered)), bars, funding_events: unordered })).toThrow("funding events must be ordered")
})

test("data adapter rejects content hash drift and bars outside instrument lifecycle", () => {
  expect(() => prepareReplayInputData({ request: request(), dataset_manifest: { ...manifest(), data_hash: HASH }, bars, funding_events: fundingEvents })).toThrow("hash binding")
  expect(() => prepareReplayInputData({
    request: request(), dataset_manifest: { ...manifest(), instrument: { ...manifest().instrument, delisted_at: "2026-07-14T06:00:00Z" } }, bars, funding_events: fundingEvents,
  })).toThrow("post-delisting")
})

test("data adapter preserves grid gaps and emits survivorship limitations", () => {
  const gapBars = [bars[0], { ...bars[1], open_time: "2026-07-14T08:00:00Z", close_time: "2026-07-14T12:00:00Z" }]
  const dataHash = replayDatasetHash(gapBars, [])
  const gapManifest: ReplayDatasetManifest = {
    ...manifest(dataHash), row_count: gapBars.length, last_close_time: gapBars[1].close_time, observed_through: gapBars[1].close_time,
    instrument: { ...manifest().instrument, status_history: "current_snapshot_only" },
    universe: { selected_at: "2026-07-13T00:00:00Z", survivorship: "survivor_only" },
  }
  const prepared = prepareReplayInputData({ request: request(dataHash), dataset_manifest: gapManifest, bars: gapBars })
  expect(prepared.limitations.map((item) => item.code)).toEqual(["dataset-grid-gap", "instrument-history-incomplete", "survivor-only-universe"])
})
