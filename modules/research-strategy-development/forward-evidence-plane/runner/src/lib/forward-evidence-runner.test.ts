import { expect, test } from "bun:test"
import { CONTROL_PLANE_IDENTITY_SCHEMA_VERSION, DRAFT_AUTHORIZATION_SCHEMA_VERSION, STRATEGY_DRAFT_BINDING_SCHEMA_VERSION } from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import { REPLAY_DATASET_MANIFEST_SCHEMA_VERSION, REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION, REPLAY_REQUEST_SCHEMA_VERSION, REPLAY_SIMULATOR_POLICY_VERSION, replayDatasetHash, type ReplayDatasetManifest, type ReplayMarketBar } from "../../../../replay-execution-plane/contracts/src/lib/replay-contracts"
import { FORWARD_ADMISSION_SCHEMA_VERSION, type ForwardAdmissionRequest } from "../../../contracts/src/lib/forward-evidence-contracts"
import { runForwardEvidenceSession } from "./forward-evidence-runner"

const HASH = "e".repeat(64)

function admission(dataHash: string): ForwardAdmissionRequest {
  const authorization = {
    schema_version: DRAFT_AUTHORIZATION_SCHEMA_VERSION, decision: "accept_for_draft" as const,
    decision_id: "decision-1", reviewer_run_id: "review-1", primary_result_id: "result-1", primary_result_hash: HASH,
    selected_trial_id: "trial-1", selected_candidate_id: "candidate-1", candidate_frozen_at: "2026-07-14T08:00:00Z",
    identity: { schema_version: CONTROL_PLANE_IDENTITY_SCHEMA_VERSION, experiment_id: "experiment-1", trial_group_id: "group-1", trial_group_hash: HASH, trial_id: "trial-1", candidate_id: "candidate-1", candidate_hash: HASH, identity_hash_policy_version: "identity-v1", experiment_contract_hash: HASH },
  }
  return {
    schema_version: FORWARD_ADMISSION_SCHEMA_VERSION, session_id: "session-1", idempotency_key: "forward-1", forward_reservation_id: "reservation-1",
    frozen_at: "2026-07-14T08:00:00Z", data_watermark: "2026-07-14T20:00:00Z", forward_dataset_hash: dataHash,
    draft: { schema_version: STRATEGY_DRAFT_BINDING_SCHEMA_VERSION, draft_id: "draft-1", strategy_id: "S-CANDIDATE-1", strategy_version: "1", strategy_ref: "strategies/candidate-1.md", strategy_policy_hash: HASH, materialization_status: "ready", created_at: "2026-07-14T08:00:00Z", authorization },
    replay_request: {
      schema_version: REPLAY_REQUEST_SCHEMA_VERSION, run_id: "forward-run-1", idempotency_key: "forward-replay-1",
      experiment_id: "experiment-1", trial_group_id: "group-1", trial_group_hash: HASH, trial_id: "trial-1", candidate_id: "candidate-1", candidate_hash: HASH,
      identity_hash_policy_version: "identity-v1", experiment_contract_hash: HASH, dataset_manifest_ref: "dataset://forward", dataset_hash: dataHash,
      harness_hash: HASH, assumptions_hash: HASH, strategy_policy_hash: HASH, symbol: "BTCUSDT", timeframe: "4h", initial_cash: 1000,
      order: { side: "long", quantity: 1, signal_time: "2026-07-14T12:00:00Z", earliest_executable_time: "2026-07-14T16:00:00Z", stop_price: 95, target_price: 110 },
      cost_policy: { policy_id: "fixture", version: "1", fee_bps: 0, slippage_bps: 0 },
      simulator_policy: { version: REPLAY_SIMULATOR_POLICY_VERSION, signal_visibility: "closed_candle", earliest_execution: "next_open", same_bar_policy: "stop_first", gap_fill_policy: "worse_open", position_accounting: "average_cost", funding_timing: "exact_event" }, random_seed: 1,
    },
  }
}

function datasetManifest(bars: ReplayMarketBar[], dataHash: string): ReplayDatasetManifest {
  return {
    schema_version: REPLAY_DATASET_MANIFEST_SCHEMA_VERSION,
    manifest_id: "forward-manifest-1", manifest_ref: "dataset://forward", data_hash: dataHash,
    dataset_kind: "ohlcv", symbol: "BTCUSDT", timeframe: "4h", interval_ms: 14_400_000,
    row_count: bars.length, first_open_time: bars[0].open_time, last_close_time: bars.at(-1)!.close_time,
    observed_through: bars.at(-1)!.close_time, closed_candles_only: true,
    bar_final_availability: "close_time", funding_availability: "event_time",
    instrument: {
      listed_at: "2020-01-01T00:00:00Z", trading_enabled_at: "2020-01-01T00:00:00Z", delisted_at: null, status_history: "complete",
      accounting: { spec_version: REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION, product_type: "linear_derivative", base_asset: "BTC", quote_asset: "USDT", settlement_asset: "USDT", contract_multiplier: "1", price_increment: "0.01", quantity_increment: "0.001", settlement_increment: "0.00000001" },
    },
    universe: { selected_at: "2026-07-14T08:00:00Z", survivorship: "point_in_time" },
  }
}

test("Forward executes only post-freeze closed bars through Replay semantics", () => {
  const bars: ReplayMarketBar[] = [{ open_time: "2026-07-14T16:00:00Z", close_time: "2026-07-14T20:00:00Z", open: 100, high: 111, low: 99, close: 110, volume: 10, closed: true }]
  const dataHash = replayDatasetHash(bars)
  const result = runForwardEvidenceSession({
    admission: admission(dataHash), dataset_manifest: datasetManifest(bars, dataHash), bars,
  })
  expect(result.status).toBe("completed")
  expect(result.replay_result?.fills[1].order_role).toBe("target")
  expect(result.limitations[0]?.code).toBe("rd-forward-evidence-only")
})

test("Forward rejects pre-freeze data instead of silently backfilling", () => {
  const bars: ReplayMarketBar[] = [{ open_time: "2026-07-14T04:00:00Z", close_time: "2026-07-14T08:00:00Z", open: 100, high: 101, low: 99, close: 100, volume: 10, closed: true }]
  const dataHash = replayDatasetHash(bars)
  const result = runForwardEvidenceSession({
    admission: admission(dataHash), dataset_manifest: datasetManifest(bars, dataHash), bars,
  })
  expect(result.status).toBe("failed")
  expect(result.limitations[0]?.detail).toContain("pre-freeze")
})
