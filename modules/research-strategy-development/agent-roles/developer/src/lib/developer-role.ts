import type { ResearchIdentityBinding } from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import {
  DEVELOPER_CONTRACT_DRAFT_SUBMISSION_SCHEMA_VERSION,
  TARGET_EXPERIMENT_CONTRACT_SCHEMA_VERSION,
  assertDeveloperDevelopmentBrief,
  createDeveloperContractDraftSubmission,
  type DeveloperContractDraftSubmission,
  type DeveloperDevelopmentBrief,
} from "../../../../research-control-plane/contracts/src/lib/developer-contract-draft"
import type { JSONRecord } from "../../../../../contracts/runtime-core/src/json"
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
  instrument_status_provenance_hash: string
  instrument_status_provider_capability_hash: string
  instrument_status_provider_certification_hash: string
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

export interface DeveloperContractDraftPlan {
  brief: DeveloperDevelopmentBrief
  developer_run_id: string
  draft_revision: number
  requested_trial_budget: number
  draft_json: JSONRecord
  created_at: string
}

export function buildDeveloperContractDraftSubmission(
  plan: DeveloperContractDraftPlan,
): DeveloperContractDraftSubmission {
  assertDeveloperDevelopmentBrief(plan.brief)
  if (plan.requested_trial_budget > plan.brief.max_trial_budget) {
    throw new Error("Developer Contract Draft cannot exceed the Brief trial budget")
  }
  if (plan.draft_json.canonical_node_id !== plan.brief.universe_node_id) {
    throw new Error("Developer Contract Draft canonical must match the Brief")
  }
  const requiredData = Array.isArray(plan.draft_json.required_data)
    ? plan.draft_json.required_data.map(String).sort()
    : []
  if (JSON.stringify(requiredData) !== JSON.stringify(plan.brief.dataset_requirements)) {
    throw new Error("Developer Contract Draft required_data must exactly match the Brief")
  }
  return createDeveloperContractDraftSubmission({
    schema_version: DEVELOPER_CONTRACT_DRAFT_SUBMISSION_SCHEMA_VERSION,
    brief_id: plan.brief.brief_id,
    brief_hash: plan.brief.brief_hash,
    proposal_id: plan.brief.proposal_id,
    proposal_revision: plan.brief.proposal_revision,
    proposal_hash: plan.brief.proposal_hash,
    developer_run_id: plan.developer_run_id,
    draft_revision: plan.draft_revision,
    allowed_candidate_space_hash: plan.brief.allowed_candidate_space_hash,
    requested_trial_budget: plan.requested_trial_budget,
    target_contract_schema_version: TARGET_EXPERIMENT_CONTRACT_SCHEMA_VERSION,
    draft_json: plan.draft_json,
    created_at: plan.created_at,
  })
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
    instrument_status_provenance_hash: plan.instrument_status_provenance_hash,
    instrument_status_provider_capability_hash: plan.instrument_status_provider_capability_hash,
    instrument_status_provider_certification_hash: plan.instrument_status_provider_certification_hash,
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
