import { expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  REPLAY_DATASET_MANIFEST_SCHEMA_VERSION,
  REPLAY_REQUEST_SCHEMA_VERSION,
  REPLAY_SIMULATOR_POLICY_VERSION,
  replayDatasetHash,
  type ReplayDatasetManifest,
  type ReplayExecutionRequest,
} from "../../../contracts/src/lib/replay-contracts"
import { runReplayTrial } from "./replay-trial-runner"

const HASH = "b".repeat(64)

function request(): ReplayExecutionRequest {
  return {
    schema_version: REPLAY_REQUEST_SCHEMA_VERSION,
    run_id: "run-1", idempotency_key: "idem-1", experiment_id: "exp-1",
    trial_group_id: "group-1", trial_group_hash: HASH, trial_id: "trial-1",
    candidate_id: "candidate-1", candidate_hash: HASH, identity_hash_policy_version: "identity-v1",
    experiment_contract_hash: HASH, dataset_manifest_ref: "dataset://fixture", dataset_hash: HASH,
    harness_hash: HASH, assumptions_hash: HASH, symbol: "BTCUSDT", timeframe: "4h", initial_cash: 1000,
    order: { side: "long", quantity: 1, signal_time: "2026-07-14T00:00:00Z", earliest_executable_time: "2026-07-14T04:00:00Z", stop_price: 95, target_price: 110 },
    cost_policy: { policy_id: "fixture", version: "1", fee_bps: 0, slippage_bps: 0 },
    simulator_policy: { version: REPLAY_SIMULATOR_POLICY_VERSION, signal_visibility: "closed_candle", earliest_execution: "next_open", same_bar_policy: "stop_first", gap_fill_policy: "worse_open", position_accounting: "average_cost", funding_timing: "exact_event" },
    random_seed: 1,
  }
}

const bars = [{ open_time: "2026-07-14T04:00:00Z", close_time: "2026-07-14T08:00:00Z", open: 100, high: 111, low: 99, close: 110, volume: 10, closed: true as const }]
const DATA_HASH = replayDatasetHash(bars)

function boundRequest(): ReplayExecutionRequest { return { ...request(), dataset_hash: DATA_HASH } }

function datasetManifest(): ReplayDatasetManifest {
  return {
    schema_version: REPLAY_DATASET_MANIFEST_SCHEMA_VERSION,
    manifest_id: "manifest-1", manifest_ref: "dataset://fixture", data_hash: DATA_HASH,
    dataset_kind: "ohlcv", symbol: "BTCUSDT", timeframe: "4h", interval_ms: 14_400_000,
    row_count: 1, first_open_time: bars[0].open_time, last_close_time: bars[0].close_time,
    observed_through: bars[0].close_time, closed_candles_only: true,
    bar_final_availability: "close_time", funding_availability: "event_time",
    instrument: { listed_at: "2020-01-01T00:00:00Z", trading_enabled_at: "2020-01-01T00:00:00Z", delisted_at: null, status_history: "complete" },
    universe: { selected_at: "2026-07-13T00:00:00Z", survivorship: "point_in_time" },
  }
}

test("runner atomically commits artifacts and retries idempotently", () => {
  const root = mkdtempSync(join(tmpdir(), "rd-replay-runner-"))
  const first = runReplayTrial({ request: boundRequest(), dataset_manifest: datasetManifest(), bars, artifact_root: root })
  const second = runReplayTrial({ request: boundRequest(), dataset_manifest: datasetManifest(), bars, artifact_root: root })
  expect(first.status).toBe("completed")
  expect(first.artifact_manifest?.files.map((file) => file.role)).toEqual(["request", "dataset_manifest", "result", "fills", "ledger"])
  expect(second.status).toBe("completed")
  expect(second.idempotent_replay).toBe(true)
})

test("runner represents early cancellation without publishing partial evidence", () => {
  const result = runReplayTrial({ request: boundRequest(), dataset_manifest: datasetManifest(), bars, cancel_requested: true })
  expect(result.status).toBe("cancelled")
  expect(result.failure?.partial_result_published).toBe(false)
})
