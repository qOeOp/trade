import type { JSONRecord } from "../../../../../contracts/runtime-core/src/json"

export const RESEARCH_CONTRACT_VALIDATOR_VERSION = "trade-flow.rd-contract-validator.v2"

const EXPERIMENT_FIELDS = [
  "schema_version", "canonical_node_id", "code_family_id", "implementation_version",
  "contract_versions", "hypothesis", "economic_rationale", "asset_universe_definition",
  "timeframe", "sampling_and_alignment", "required_data", "feature_definition",
  "target_definition", "forecast_definition", "signal_definition", "position_rule",
  "portfolio_construction", "risk_rule", "execution_rule", "transaction_cost_model",
  "expected_holding_period", "benchmark", "validation_plan", "rejection_criteria",
  "trial_group_ref", "candidate_registration", "parent_experiment_id", "random_seed",
  "code_commit_ref", "harness_commit_ref", "data_snapshot_ref", "assumptions_ref",
  "replay_execution_input",
] as const

const BACKLOG_FIELDS = [
  "schema_version", "canonical_node_id", "hypothesis", "economic_rationale",
  "required_data", "required_semantics", "expected_input_contract",
  "expected_output_contract", "negative_controls", "fixture_requirements", "proposal_ref",
] as const

export interface ContractValidationResult {
  valid: boolean
  validator_version: string
  errors: string[]
}

export function validateResearchProposal(kind: "experiment" | "family_backlog", value: JSONRecord): ContractValidationResult {
  const errors: string[] = []
  const expectedVersion = kind === "experiment"
    ? "trade-flow.rd-experiment-contract.v3"
    : "trade-flow.rd-family-backlog-contract.v1"
  if (value.schema_version !== expectedVersion) errors.push(`schema_version must be ${expectedVersion}`)
  const requiredFields = kind === "experiment" ? EXPERIMENT_FIELDS : BACKLOG_FIELDS
  for (const field of requiredFields) if (!(field in value)) errors.push(`${field} is required`)
  requireString(value, "canonical_node_id", errors)
  requireNonEmptyObject(value, "economic_rationale", errors)
  requireStringArray(value, "required_data", errors)
  if (kind === "family_backlog") validateBacklog(value, errors)
  else validateExperiment(value, errors)
  return { valid: errors.length === 0, validator_version: RESEARCH_CONTRACT_VALIDATOR_VERSION, errors }
}

function validateBacklog(value: JSONRecord, errors: string[]): void {
  requireString(value, "hypothesis", errors)
  requireString(value, "proposal_ref", errors)
  requireStringArray(value, "required_semantics", errors, true)
  requireStringArray(value, "fixture_requirements", errors, true)
  const semantics = new Set(["feature", "forecast", "signal", "position", "portfolio", "risk", "execution"])
  for (const item of array(value.required_semantics)) if (!semantics.has(String(item))) errors.push(`unsupported required_semantics item: ${String(item)}`)
}

function validateExperiment(value: JSONRecord, errors: string[]): void {
  for (const field of [
    "code_family_id", "implementation_version", "code_commit_ref", "harness_commit_ref",
    "data_snapshot_ref", "assumptions_ref",
  ]) requireString(value, field, errors)
  for (const field of [
    "contract_versions", "hypothesis", "asset_universe_definition", "timeframe",
    "sampling_and_alignment", "feature_definition", "target_definition", "forecast_definition",
    "signal_definition", "position_rule", "portfolio_construction", "risk_rule",
    "execution_rule", "transaction_cost_model", "expected_holding_period", "benchmark",
    "validation_plan", "trial_group_ref", "candidate_registration",
    "replay_execution_input",
  ]) requireObject(value, field, errors)
  requireStringArray(value, "rejection_criteria", errors, true)
  const versions = record(value.contract_versions)
  for (const field of ["identity_hash_policy", "validator", "lifecycle_rule", "scope_policy"]) requireString(versions, field, errors, "contract_versions")
  const group = record(value.trial_group_ref)
  requireString(group, "trial_group_id", errors, "trial_group_ref")
  requireString(group, "group_hash", errors, "trial_group_ref")
  const candidates = record(value.candidate_registration)
  requireStringArray(candidates, "candidate_ids", errors, true, "candidate_registration")
  const replayInput = record(value.replay_execution_input)
  if (replayInput.supplemental_requirement_set_schema_version !== "trade.rd-replay-supplemental-requirement-set.v1") {
    errors.push("replay_execution_input.supplemental_requirement_set_schema_version must be trade.rd-replay-supplemental-requirement-set.v1")
  }
  if (typeof replayInput.supplemental_requirement_set_hash !== "string"
      || !/^[a-f0-9]{64}$/.test(replayInput.supplemental_requirement_set_hash)) {
    errors.push("replay_execution_input.supplemental_requirement_set_hash must be a lowercase sha256 digest")
  }
  if (!Number.isInteger(value.random_seed)) errors.push("random_seed must be an integer")
}

function requireString(value: JSONRecord, field: string, errors: string[], prefix = ""): void {
  if (typeof value[field] !== "string" || !(value[field] as string).trim()) errors.push(`${prefix ? `${prefix}.` : ""}${field} must be a non-empty string`)
}

function requireObject(value: JSONRecord, field: string, errors: string[]): void {
  if (!isRecord(value[field])) errors.push(`${field} must be an object`)
}

function requireNonEmptyObject(value: JSONRecord, field: string, errors: string[]): void {
  if (!isRecord(value[field]) || Object.keys(value[field] as JSONRecord).length === 0) errors.push(`${field} must be a non-empty object`)
}

function requireStringArray(value: JSONRecord, field: string, errors: string[], nonEmpty = false, prefix = ""): void {
  const items = array(value[field])
  const label = `${prefix ? `${prefix}.` : ""}${field}`
  if (!Array.isArray(value[field]) || (nonEmpty && items.length === 0) || items.some((item) => typeof item !== "string" || !item.trim())) {
    errors.push(`${label} must be ${nonEmpty ? "a non-empty" : "an"} array of non-empty strings`)
  }
  if (new Set(items).size !== items.length) errors.push(`${label} must not contain duplicates`)
}

function record(value: unknown): JSONRecord {
  return isRecord(value) ? value : {}
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function isRecord(value: unknown): value is JSONRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
