import type { ResearchIdentityBinding } from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import {
  REPLAY_REQUEST_SCHEMA_VERSION,
  assertReplayExecutionRequest,
  type ReplayExecutionRequest,
} from "../../../../replay-execution-plane/contracts/src/lib/replay-contracts"

export interface DeveloperReplayPlan {
  run_id: string
  idempotency_key: string
  identity: ResearchIdentityBinding
  dataset_manifest_ref: string
  dataset_hash: string
  harness_hash: string
  assumptions_hash: string
  symbol: string
  timeframe: string
  initial_cash: number
  order: ReplayExecutionRequest["order"]
  cost_policy: ReplayExecutionRequest["cost_policy"]
  simulator_policy: ReplayExecutionRequest["simulator_policy"]
  random_seed: number
}

export function buildDeveloperReplayRequest(plan: DeveloperReplayPlan): ReplayExecutionRequest {
  const request: ReplayExecutionRequest = {
    schema_version: REPLAY_REQUEST_SCHEMA_VERSION,
    run_id: plan.run_id,
    idempotency_key: plan.idempotency_key,
    experiment_id: plan.identity.experiment_id,
    trial_group_id: plan.identity.trial_group_id,
    trial_group_hash: plan.identity.trial_group_hash,
    trial_id: plan.identity.trial_id,
    candidate_id: plan.identity.candidate_id,
    candidate_hash: plan.identity.candidate_hash,
    identity_hash_policy_version: plan.identity.identity_hash_policy_version,
    experiment_contract_hash: plan.identity.experiment_contract_hash,
    dataset_manifest_ref: plan.dataset_manifest_ref,
    dataset_hash: plan.dataset_hash,
    harness_hash: plan.harness_hash,
    assumptions_hash: plan.assumptions_hash,
    symbol: plan.symbol,
    timeframe: plan.timeframe,
    initial_cash: plan.initial_cash,
    order: plan.order,
    cost_policy: plan.cost_policy,
    simulator_policy: plan.simulator_policy,
    random_seed: plan.random_seed,
  }
  assertReplayExecutionRequest(request)
  return request
}
