import { expect, test } from "bun:test"
import { FORWARD_ADMISSION_SCHEMA_VERSION, assertForwardAdmissionRequest, type ForwardAdmissionRequest } from "./forward-evidence-contracts"
import { CONTROL_PLANE_IDENTITY_SCHEMA_VERSION, DRAFT_AUTHORIZATION_SCHEMA_VERSION, STRATEGY_DRAFT_BINDING_SCHEMA_VERSION } from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import { REPLAY_REQUEST_SCHEMA_VERSION, REPLAY_SIMULATOR_POLICY_VERSION } from "../../../../replay-execution-plane/contracts/src/lib/replay-contracts"

const HASH = "d".repeat(64)

function fixture(): ForwardAdmissionRequest {
  const authorization = {
    schema_version: DRAFT_AUTHORIZATION_SCHEMA_VERSION,
    decision: "accept_for_draft" as const,
    decision_id: "decision-1", reviewer_run_id: "review-1", primary_result_id: "result-1", primary_result_hash: HASH,
    selected_trial_id: "trial-1", selected_candidate_id: "candidate-1", candidate_frozen_at: "2026-07-14T08:00:00Z",
    identity: { schema_version: CONTROL_PLANE_IDENTITY_SCHEMA_VERSION, experiment_id: "experiment-1", trial_group_id: "group-1", trial_group_hash: HASH, trial_id: "trial-1", candidate_id: "candidate-1", candidate_hash: HASH, identity_hash_policy_version: "identity-v1", experiment_contract_hash: HASH },
  }
  const draft = { schema_version: STRATEGY_DRAFT_BINDING_SCHEMA_VERSION, draft_id: "draft-1", strategy_id: "S-CANDIDATE-1", strategy_version: "1", strategy_ref: "strategies/candidate-1.md", strategy_policy_hash: HASH, materialization_status: "ready" as const, created_at: "2026-07-14T08:00:00Z", authorization }
  return {
    schema_version: FORWARD_ADMISSION_SCHEMA_VERSION,
    session_id: "forward-1", idempotency_key: "forward-key-1", forward_reservation_id: "reservation-1",
    frozen_at: "2026-07-14T08:00:00Z", data_watermark: "2026-07-14T16:00:00Z", forward_dataset_hash: HASH, draft,
    replay_request: {
      schema_version: REPLAY_REQUEST_SCHEMA_VERSION, run_id: "forward-run-1", idempotency_key: "forward-replay-1",
      experiment_id: "experiment-1", trial_group_id: "group-1", trial_group_hash: HASH, trial_id: "trial-1",
      candidate_id: "candidate-1", candidate_hash: HASH, identity_hash_policy_version: "identity-v1", experiment_contract_hash: HASH,
      dataset_manifest_ref: "dataset://forward", dataset_hash: HASH, harness_hash: HASH, assumptions_hash: HASH, strategy_policy_hash: HASH,
      symbol: "BTCUSDT", timeframe: "4h", initial_cash: 1000,
      order: { side: "long", quantity: 1, signal_time: "2026-07-14T12:00:00Z", earliest_executable_time: "2026-07-14T16:00:00Z", stop_price: 95, target_price: 110 },
      cost_policy: { policy_id: "fixture", version: "1", fee_bps: 0, slippage_bps: 0 },
      simulator_policy: { version: REPLAY_SIMULATOR_POLICY_VERSION, signal_visibility: "closed_candle", earliest_execution: "next_open", same_bar_policy: "stop_first", gap_fill_policy: "worse_open", position_accounting: "average_cost", funding_timing: "exact_event" }, random_seed: 1,
    },
  }
}

test("Forward admission binds a ready strategy version and post-freeze Replay", () => {
  expect(() => assertForwardAdmissionRequest(fixture())).not.toThrow()
  expect(() => assertForwardAdmissionRequest({ ...fixture(), frozen_at: "2026-07-14T13:00:00Z" })).toThrow()
})
