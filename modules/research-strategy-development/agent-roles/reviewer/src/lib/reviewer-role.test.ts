import { expect, test } from "bun:test"
import { CONTROL_PLANE_IDENTITY_SCHEMA_VERSION } from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import { REPLAY_RESULT_SCHEMA_VERSION, type ReplayResult } from "../../../../replay-execution-plane/contracts/src/lib/replay-contracts"
import { buildDraftAuthorization } from "./reviewer-role"

const HASH = "1".repeat(64)
const identity = { schema_version: CONTROL_PLANE_IDENTITY_SCHEMA_VERSION, experiment_id: "experiment-1", trial_group_id: "group-1", trial_group_hash: HASH, trial_id: "trial-1", candidate_id: "candidate-1", candidate_hash: HASH, identity_hash_policy_version: "identity-v1", experiment_contract_hash: HASH }
const result: ReplayResult = {
  schema_version: REPLAY_RESULT_SCHEMA_VERSION, run_id: "run-1", status: "completed", started_at: "2026-07-14T04:00:00Z", completed_at: "2026-07-14T08:00:00Z", fills: [], ledger: [],
  metrics: { initial_cash: 1000, ending_equity: 1010, net_pnl: 10, return_fraction: 0.01, realized_pnl: 10, total_fees: 0, total_funding: 0, trade_count: 1 }, limitations: [],
  fingerprint: { experiment_contract_hash: HASH, trial_group_hash: HASH, candidate_hash: HASH, identity_hash_policy_version: "identity-v1", dataset_hash: HASH, harness_hash: HASH, assumptions_hash: HASH, cost_policy_hash: HASH, simulator_policy_version: "sim-v1", request_hash: HASH, result_hash: HASH, random_seed: 1 },
}

test("Reviewer produces authorization but does not write strategy or lifecycle", () => {
  const authorization = buildDraftAuthorization({ decision_id: "decision-1", reviewer_run_id: "review-1", primary_result_id: "result-1", selected_trial_id: "trial-1", selected_candidate_id: "candidate-1", candidate_frozen_at: "2026-07-14T08:00:00Z", explicit_decision: "accept_for_draft", identity, result })
  expect(authorization.decision).toBe("accept_for_draft")
  expect(authorization.primary_result_hash).toBe(HASH)
})
