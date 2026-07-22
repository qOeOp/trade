import type { JSONRecord } from "../../../../../contracts/runtime-core/src/json"
import { canonicalNfcJson } from "../../../../../contracts/runtime-core/src/canonical-json"
import { canonicalControlPlaneHash } from "./control-plane-contracts"
import { digest, isRecord, positiveInteger, required, utc } from "./developer-contract-draft"

export const DEVELOPER_CONTRACT_FREEZE_REQUEST_SCHEMA_VERSION =
  "trade.rd-developer-contract-freeze-request.v1" as const
export const DEVELOPER_CONTRACT_FREEZE_RECORD_SCHEMA_VERSION =
  "trade.rd-developer-contract-freeze-record.v1" as const
export const DEVELOPER_CONTRACT_FREEZE_COMPATIBILITY_PROJECTION_VERSION =
  "rd-developer-contract-freeze-legacy-proposal-projection-v1" as const
export const DEVELOPER_CONTRACT_FREEZE_COMPILER_VERSION =
  "rd-developer-contract-freeze-compiler-v1" as const

export interface DeveloperContractFreezeRequest extends JSONRecord {
  schema_version: typeof DEVELOPER_CONTRACT_FREEZE_REQUEST_SCHEMA_VERSION
  freeze_id: string
  validation_id: string
  validation_hash: string
  experiment_id: string
  bootstrap_lifecycle_event_id: string
  bootstrap_lifecycle_idempotency_key: string
  idempotency_key: string
  frozen_at: string
}

export interface DeveloperContractFreezeCandidateIdentity extends JSONRecord {
  candidate_id: string
  candidate_identity_hash: string
  candidate_ordinal: number
}

export interface DeveloperContractFreezeRecordSource extends JSONRecord {
  schema_version: typeof DEVELOPER_CONTRACT_FREEZE_RECORD_SCHEMA_VERSION
  freeze_id: string
  validation_id: string
  validation_hash: string
  brief_id: string
  brief_hash: string
  proposal_id: string
  proposal_revision: number
  proposal_hash: string
  draft_revision: number
  submission_hash: string
  contract_draft_hash: string
  candidate_assignment_set_hash: string
  experiment_id: string
  contract_hash: string
  trial_group_id: string
  trial_group_hash: string
  candidates: DeveloperContractFreezeCandidateIdentity[]
  identity_hash_policy_version: string
  contract_validator_version: string
  lifecycle_rule_version: string
  scope_policy_version: string
  freeze_compiler_version: typeof DEVELOPER_CONTRACT_FREEZE_COMPILER_VERSION
  compatibility_projection_version: typeof DEVELOPER_CONTRACT_FREEZE_COMPATIBILITY_PROJECTION_VERSION
  bootstrap_lifecycle_event_id: string
  frozen_at: string
}

export interface DeveloperContractFreezeRecordBody extends DeveloperContractFreezeRecordSource {
  status: "frozen"
  candidate_identity_set_hash: string
}

export interface DeveloperContractFreezeRecord extends DeveloperContractFreezeRecordBody {
  freeze_hash: string
}

export function assertDeveloperContractFreezeRequest(value: DeveloperContractFreezeRequest): void {
  if (!isRecord(value)) throw new Error("Developer Contract Freeze request must be an object")
  const expected: DeveloperContractFreezeRequest = {
    schema_version: DEVELOPER_CONTRACT_FREEZE_REQUEST_SCHEMA_VERSION,
    freeze_id: required(value.freeze_id, "freeze_id"),
    validation_id: required(value.validation_id, "validation_id"),
    validation_hash: digest(value.validation_hash, "validation_hash"),
    experiment_id: required(value.experiment_id, "experiment_id"),
    bootstrap_lifecycle_event_id: required(value.bootstrap_lifecycle_event_id, "bootstrap_lifecycle_event_id"),
    bootstrap_lifecycle_idempotency_key: required(
      value.bootstrap_lifecycle_idempotency_key,
      "bootstrap_lifecycle_idempotency_key",
    ),
    idempotency_key: required(value.idempotency_key, "idempotency_key"),
    frozen_at: utc(value.frozen_at, "frozen_at"),
  }
  if (canonicalNfcJson(value) !== canonicalNfcJson(expected)) {
    throw new Error("Developer Contract Freeze request is non-canonical")
  }
}

export function createDeveloperContractFreezeRecord(
  input: DeveloperContractFreezeRecordSource,
): DeveloperContractFreezeRecord {
  if (input.schema_version !== DEVELOPER_CONTRACT_FREEZE_RECORD_SCHEMA_VERSION
      || input.freeze_compiler_version !== DEVELOPER_CONTRACT_FREEZE_COMPILER_VERSION
      || input.compatibility_projection_version !== DEVELOPER_CONTRACT_FREEZE_COMPATIBILITY_PROJECTION_VERSION) {
    throw new Error("unsupported Developer Contract Freeze Record")
  }
  const candidates = input.candidates
    .map((candidate) => ({
      candidate_id: required(candidate.candidate_id, "candidate_id"),
      candidate_identity_hash: digest(candidate.candidate_identity_hash, "candidate_identity_hash"),
      candidate_ordinal: positiveInteger(candidate.candidate_ordinal, "candidate_ordinal"),
    }))
    .sort((left, right) => left.candidate_ordinal - right.candidate_ordinal)
  if (candidates.length === 0
      || new Set(candidates.map((item) => item.candidate_id)).size !== candidates.length
      || candidates.some((item, index) => item.candidate_ordinal !== index + 1)) {
    throw new Error("Freeze Record candidates must be unique and contiguous from ordinal 1")
  }
  const candidateIdentitySetHash = canonicalControlPlaneHash(candidates)
  const body: DeveloperContractFreezeRecordBody = {
    schema_version: DEVELOPER_CONTRACT_FREEZE_RECORD_SCHEMA_VERSION,
    freeze_id: required(input.freeze_id, "freeze_id"),
    validation_id: required(input.validation_id, "validation_id"),
    validation_hash: digest(input.validation_hash, "validation_hash"),
    brief_id: required(input.brief_id, "brief_id"),
    brief_hash: digest(input.brief_hash, "brief_hash"),
    proposal_id: required(input.proposal_id, "proposal_id"),
    proposal_revision: positiveInteger(input.proposal_revision, "proposal_revision"),
    proposal_hash: digest(input.proposal_hash, "proposal_hash"),
    draft_revision: positiveInteger(input.draft_revision, "draft_revision"),
    submission_hash: digest(input.submission_hash, "submission_hash"),
    contract_draft_hash: digest(input.contract_draft_hash, "contract_draft_hash"),
    candidate_assignment_set_hash: digest(input.candidate_assignment_set_hash, "candidate_assignment_set_hash"),
    experiment_id: required(input.experiment_id, "experiment_id"),
    contract_hash: digest(input.contract_hash, "contract_hash"),
    trial_group_id: required(input.trial_group_id, "trial_group_id"),
    trial_group_hash: digest(input.trial_group_hash, "trial_group_hash"),
    candidates,
    candidate_identity_set_hash: candidateIdentitySetHash,
    identity_hash_policy_version: required(input.identity_hash_policy_version, "identity_hash_policy_version"),
    contract_validator_version: required(input.contract_validator_version, "contract_validator_version"),
    lifecycle_rule_version: required(input.lifecycle_rule_version, "lifecycle_rule_version"),
    scope_policy_version: required(input.scope_policy_version, "scope_policy_version"),
    freeze_compiler_version: DEVELOPER_CONTRACT_FREEZE_COMPILER_VERSION,
    compatibility_projection_version: DEVELOPER_CONTRACT_FREEZE_COMPATIBILITY_PROJECTION_VERSION,
    bootstrap_lifecycle_event_id: required(input.bootstrap_lifecycle_event_id, "bootstrap_lifecycle_event_id"),
    status: "frozen",
    frozen_at: utc(input.frozen_at, "frozen_at"),
  }
  return { ...body, freeze_hash: canonicalControlPlaneHash(body) }
}

export function assertDeveloperContractFreezeRecord(value: DeveloperContractFreezeRecord): void {
  if (!isRecord(value)) throw new Error("Developer Contract Freeze Record must be an object")
  const {
    freeze_hash: _freezeHash,
    status: _status,
    candidate_identity_set_hash: _candidateIdentitySetHash,
    ...source
  } = value
  const expected = createDeveloperContractFreezeRecord(source)
  if (canonicalNfcJson(value) !== canonicalNfcJson(expected)) {
    throw new Error("Developer Contract Freeze Record is non-canonical or hash-drifted")
  }
}
