import { expect, test } from "bun:test"
import {
  REPLAY_REQUEST_SCHEMA_VERSION,
  REPLAY_SIMULATOR_POLICY_VERSION,
  type ReplayExecutionRequest,
  type ReplayLimitation,
  type ReplayMarketBar,
} from "../../../contracts/src/lib/replay-contracts"
import { createReplayEventKey } from "./replay-event-key"
import { reduceReplaySourceEvents } from "./replay-source-reducer"

const HASH = "c".repeat(64)

function request(): ReplayExecutionRequest {
  return {
    schema_version: REPLAY_REQUEST_SCHEMA_VERSION,
    run_id: "run-reducer", idempotency_key: "key-reducer", experiment_id: "experiment-1",
    trial_group_id: "group-1", trial_group_hash: HASH, trial_id: "trial-1",
    candidate_id: "candidate-1", candidate_hash: HASH, identity_hash_policy_version: "identity-v1",
    experiment_contract_hash: HASH, dataset_manifest_ref: "dataset://fixture", dataset_hash: HASH,
    harness_hash: HASH, assumptions_hash: HASH, symbol: "BTCUSDT", timeframe: "4h", initial_cash: 10_000,
    order: {
      side: "long", quantity: 1, signal_time: "2026-07-14T00:00:00Z",
      earliest_executable_time: "2026-07-14T04:00:00Z", stop_price: 95, target_price: 110,
    },
    cost_policy: { policy_id: "fixture", version: "1", fee_bps: 0, slippage_bps: 0 },
    simulator_policy: {
      version: REPLAY_SIMULATOR_POLICY_VERSION, signal_visibility: "closed_candle", earliest_execution: "next_open",
      same_bar_policy: "stop_first", gap_fill_policy: "worse_open", position_accounting: "average_cost", funding_timing: "exact_event",
    },
    random_seed: 1,
  }
}

function bar(openTime: string, closeTime: string, open: number, high: number, low: number, close: number): ReplayMarketBar {
  return { open_time: openTime, close_time: closeTime, open, high, low, close, volume: 100, closed: true }
}

test("source reducer stops at the terminal market event and keeps only in-position funding", () => {
  const limitations: ReplayLimitation[] = []
  const result = reduceReplaySourceEvents({
    request: request(),
    bars: [
      bar("2026-07-14T04:00:00Z", "2026-07-14T08:00:00Z", 100, 109, 98, 108),
      bar("2026-07-14T08:00:00Z", "2026-07-14T12:00:00Z", 108, 111, 106, 110),
      bar("2026-07-14T12:00:00Z", "2026-07-14T16:00:00Z", 110, 115, 108, 114),
    ],
    funding_events: [
      { timestamp: "2026-07-14T04:00:00Z", rate: 0.001, mark_price: 100 },
      { timestamp: "2026-07-14T12:00:00Z", rate: 0.001, mark_price: 110 },
      { timestamp: "2026-07-14T16:00:00Z", rate: 0.001, mark_price: 114 },
    ],
    entry_index: 0,
    delisted_at: null,
    limitations,
    activate_entry: (source) => ({
      source_event_id: source.source_event_id,
      fill_key: createReplayEventKey({
        event_time: "2026-07-14T04:00:00Z", boundary_phase: 20, source_sequence: 1,
        event_subphase: 3, stable_event_id: "entry-fill",
      }),
    }),
    get_entry_fill_event_key: (entry) => entry.fill_key,
    complete_exit: (exit) => `${exit.role}:${exit.timestamp}`,
  })

  expect(result.exit.role).toBe("target")
  expect(result.exit.timestamp).toBe("2026-07-14T12:00:00Z")
  expect(result.entry_transition.source_event_id).toContain("source:bar_open:1")
  expect(result.terminal_transition).toBe("target:2026-07-14T12:00:00Z")
  expect(result.source_events.at(-1)?.kind).toBe("bar_range")
  expect(result.applied_funding_sources.map((event) => event.event_key.event_time)).toEqual(["2026-07-14T12:00:00Z"])
  expect(result.source_events.some((event) => event.event_key.event_time === "2026-07-14T16:00:00Z")).toBe(false)
  expect(limitations).toEqual([])
})
