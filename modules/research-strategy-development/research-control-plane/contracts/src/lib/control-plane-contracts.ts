export const CONTROL_PLANE_IDENTITY_SCHEMA_VERSION = "trade.rd-identity-binding.v1" as const
export const DRAFT_AUTHORIZATION_SCHEMA_VERSION = "trade.rd-draft-authorization.v1" as const
export const STRATEGY_DRAFT_BINDING_SCHEMA_VERSION = "trade.rd-strategy-draft-binding.v1" as const

export interface ResearchIdentityBinding {
  schema_version: typeof CONTROL_PLANE_IDENTITY_SCHEMA_VERSION
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  trial_id: string
  candidate_id: string
  candidate_hash: string
  identity_hash_policy_version: string
  experiment_contract_hash: string
}

export interface DraftStrategyAuthorization {
  schema_version: typeof DRAFT_AUTHORIZATION_SCHEMA_VERSION
  decision: "accept_for_draft"
  decision_id: string
  reviewer_run_id: string
  primary_result_id: string
  primary_result_hash: string
  selected_trial_id: string
  selected_candidate_id: string
  candidate_frozen_at: string
  identity: ResearchIdentityBinding
}

export interface StrategyDraftBinding {
  schema_version: typeof STRATEGY_DRAFT_BINDING_SCHEMA_VERSION
  draft_id: string
  strategy_id: string
  strategy_version: string
  strategy_ref: string
  strategy_policy_hash: string
  materialization_status: "ready"
  created_at: string
  authorization: DraftStrategyAuthorization
}

export function assertResearchIdentityBinding(value: ResearchIdentityBinding): void {
  assertIdentityFields(value)
}

export function assertDraftStrategyAuthorization(value: DraftStrategyAuthorization): void {
  if (value.schema_version !== DRAFT_AUTHORIZATION_SCHEMA_VERSION) fail("authorization schema_version")
  if (value.decision !== "accept_for_draft") fail("authorization decision")
  requireText(value.decision_id, "authorization.decision_id")
  requireText(value.reviewer_run_id, "authorization.reviewer_run_id")
  requireText(value.primary_result_id, "authorization.primary_result_id")
  requireHash(value.primary_result_hash, "authorization.primary_result_hash")
  requireText(value.selected_trial_id, "authorization.selected_trial_id")
  requireText(value.selected_candidate_id, "authorization.selected_candidate_id")
  requireTimestamp(value.candidate_frozen_at, "authorization.candidate_frozen_at")
  assertIdentityFields(value.identity)
  if (value.selected_trial_id !== value.identity.trial_id) fail("selected Trial does not match identity")
  if (value.selected_candidate_id !== value.identity.candidate_id) fail("selected Candidate does not match identity")
}

export function assertStrategyDraftBinding(value: StrategyDraftBinding): void {
  if (value.schema_version !== STRATEGY_DRAFT_BINDING_SCHEMA_VERSION) fail("draft binding schema_version")
  requireText(value.draft_id, "draft_id")
  requireText(value.strategy_id, "strategy_id")
  requireText(value.strategy_version, "strategy_version")
  requireText(value.strategy_ref, "strategy_ref")
  requireHash(value.strategy_policy_hash, "strategy_policy_hash")
  if (value.materialization_status !== "ready") fail("draft is not ready")
  requireTimestamp(value.created_at, "created_at")
  assertDraftStrategyAuthorization(value.authorization)
}

function assertIdentityFields(value: ResearchIdentityBinding): void {
  if (value.schema_version !== CONTROL_PLANE_IDENTITY_SCHEMA_VERSION) fail("identity schema_version")
  requireText(value.experiment_id, "identity.experiment_id")
  requireText(value.trial_group_id, "identity.trial_group_id")
  requireHash(value.trial_group_hash, "identity.trial_group_hash")
  requireText(value.trial_id, "identity.trial_id")
  requireText(value.candidate_id, "identity.candidate_id")
  requireHash(value.candidate_hash, "identity.candidate_hash")
  requireText(value.identity_hash_policy_version, "identity.identity_hash_policy_version")
  requireHash(value.experiment_contract_hash, "identity.experiment_contract_hash")
}

function requireHash(value: unknown, field: string): void {
  const text = requireText(value, field)
  if (!/^[a-f0-9]{64}$/.test(text)) fail(`${field} must be a lowercase sha256 hex digest`)
}

function requireTimestamp(value: unknown, field: string): void {
  const text = requireText(value, field)
  if (!Number.isFinite(Date.parse(text))) fail(`${field} must be an ISO timestamp`)
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") fail(`${field} is required`)
  return value.trim()
}

function fail(message: string): never {
  throw new Error(message)
}
