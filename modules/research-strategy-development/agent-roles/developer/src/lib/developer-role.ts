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
  trial_reservation_ref: string
  trial_reservation_hash: string
  dataset_manifest_ref: string
  dataset_hash: string
  supplemental_facts_hash: string
  supplemental_requirement_set: ReplayExecutionRequest["supplemental_requirement_set"]
  supplemental_requirement_set_hash: string
  decision_market_input_requirement: ReplayExecutionRequest["decision_market_input_requirement"]
  decision_market_input_requirement_hash: string
  decision_schedule: ReplayExecutionRequest["decision_schedule"]
  decision_schedule_hash: string
  venue_risk_policy_schedule_hash: string
  instrument_spec_schedule_hash: string
  instrument_status_schedule_hash: string
  harness_hash: string
  assumptions_hash: string
  symbol: string
  timeframe: string
  initial_cash: number
  order: ReplayExecutionRequest["order"]
  cost_policy: ReplayExecutionRequest["cost_policy"]
  simulator_policy: ReplayExecutionRequest["simulator_policy"]
  margin_policy: ReplayExecutionRequest["margin_policy"]
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
    trial_reservation_ref: plan.trial_reservation_ref,
    trial_reservation_hash: plan.trial_reservation_hash,
    dataset_manifest_ref: plan.dataset_manifest_ref,
    dataset_hash: plan.dataset_hash,
    supplemental_facts_hash: plan.supplemental_facts_hash,
    supplemental_requirement_set: plan.supplemental_requirement_set,
    supplemental_requirement_set_hash: plan.supplemental_requirement_set_hash,
    decision_market_input_requirement: plan.decision_market_input_requirement,
    decision_market_input_requirement_hash: plan.decision_market_input_requirement_hash,
    decision_schedule: plan.decision_schedule,
    decision_schedule_hash: plan.decision_schedule_hash,
    venue_risk_policy_schedule_hash: plan.venue_risk_policy_schedule_hash,
    instrument_spec_schedule_hash: plan.instrument_spec_schedule_hash,
    instrument_status_schedule_hash: plan.instrument_status_schedule_hash,
    harness_hash: plan.harness_hash,
    assumptions_hash: plan.assumptions_hash,
    symbol: plan.symbol,
    timeframe: plan.timeframe,
    initial_cash: plan.initial_cash,
    order: plan.order,
    cost_policy: plan.cost_policy,
    simulator_policy: plan.simulator_policy,
    margin_policy: plan.margin_policy,
    random_seed: plan.random_seed,
  }
  assertReplayExecutionRequest(request)
  return request
}
