import { expect, test } from "bun:test"
import { CONTROL_PLANE_IDENTITY_SCHEMA_VERSION } from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import { REPLAY_SIMULATOR_POLICY_VERSION } from "../../../../replay-execution-plane/contracts/src/lib/replay-contracts"
import { buildDeveloperReplayRequest } from "./developer-role"

const HASH = "f".repeat(64)

test("Developer request copies authority identity without inventing it", () => {
  const request = buildDeveloperReplayRequest({
    run_id: "run-1", idempotency_key: "key-1",
    identity: { schema_version: CONTROL_PLANE_IDENTITY_SCHEMA_VERSION, experiment_id: "experiment-1", trial_group_id: "group-1", trial_group_hash: HASH, trial_id: "trial-1", candidate_id: "candidate-1", candidate_hash: HASH, identity_hash_policy_version: "identity-v1", experiment_contract_hash: HASH },
    dataset_manifest_ref: "dataset://fixture", dataset_hash: HASH, harness_hash: HASH, assumptions_hash: HASH,
    symbol: "BTCUSDT", timeframe: "4h", initial_cash: 1000,
    order: { side: "long", quantity: 1, signal_time: "2026-07-14T00:00:00Z", earliest_executable_time: "2026-07-14T04:00:00Z", stop_price: 95, target_price: 110 },
    cost_policy: { policy_id: "fixture", version: "1", fee_bps: 0, slippage_bps: 0 },
    simulator_policy: { version: REPLAY_SIMULATOR_POLICY_VERSION, signal_visibility: "closed_candle", earliest_execution: "next_open", same_bar_policy: "stop_first", gap_fill_policy: "worse_open", position_accounting: "average_cost", funding_timing: "exact_event" }, random_seed: 1,
  })
  expect(request.trial_id).toBe("trial-1")
  expect(request.candidate_hash).toBe(HASH)
})
