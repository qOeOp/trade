import type { JSONRecord } from "../../../../../contracts/runtime-core/src/json"
import { canonicalNfcJson } from "../../../../../contracts/runtime-core/src/canonical-json"
import { canonicalControlPlaneHash } from "./control-plane-contracts"
import { digest, isRecord, positiveInteger, required, utc } from "./developer-contract-draft"

export const DEVELOPER_CONTRACT_DRAFT_VALIDATION_REQUEST_SCHEMA_VERSION =
  "trade.rd-developer-contract-draft-validation-request.v1" as const
export const DEVELOPER_CONTRACT_DRAFT_VALIDATION_RECORD_SCHEMA_VERSION =
  "trade.rd-developer-contract-draft-validation-record.v1" as const
export const DEVELOPER_CONTRACT_DRAFT_RECONCILIATION_POLICY_VERSION =
  "rd-developer-contract-draft-reconciliation-v1" as const

export interface DeveloperContractDraftValidationRequest extends JSONRecord {
  schema_version: typeof DEVELOPER_CONTRACT_DRAFT_VALIDATION_REQUEST_SCHEMA_VERSION
  validation_id: string
  brief_id: string
  draft_revision: number
  idempotency_key: string
  validated_at: string
}

export interface DeveloperContractDraftValidationRecordSource extends JSONRecord {
  schema_version: typeof DEVELOPER_CONTRACT_DRAFT_VALIDATION_RECORD_SCHEMA_VERSION
  validation_id: string
  brief_id: string
  brief_hash: string
  proposal_id: string
  proposal_revision: number
  proposal_hash: string
  draft_revision: number
  draft_receipt_hash: string
  submission_hash: string
  contract_draft_hash: string
  contract_candidate_hash: string
  candidate_space_hash: string
  candidate_assignment_set_hash: string
  target_contract_schema_version: string
  contract_validator_version: string
  reconciliation_policy_version: typeof DEVELOPER_CONTRACT_DRAFT_RECONCILIATION_POLICY_VERSION
  errors: string[]
  validated_at: string
}

export interface DeveloperContractDraftValidationRecordBody extends DeveloperContractDraftValidationRecordSource {
  status: "valid" | "invalid"
}

export interface DeveloperContractDraftValidationRecord extends DeveloperContractDraftValidationRecordBody {
  validation_hash: string
}

export function assertDeveloperContractDraftValidationRequest(
  value: DeveloperContractDraftValidationRequest,
): void {
  if (!isRecord(value)) throw new Error("Developer Contract Draft validation request must be an object")
  const expected: DeveloperContractDraftValidationRequest = {
    schema_version: DEVELOPER_CONTRACT_DRAFT_VALIDATION_REQUEST_SCHEMA_VERSION,
    validation_id: required(value.validation_id, "validation_id"),
    brief_id: required(value.brief_id, "brief_id"),
    draft_revision: positiveInteger(value.draft_revision, "draft_revision"),
    idempotency_key: required(value.idempotency_key, "idempotency_key"),
    validated_at: utc(value.validated_at, "validated_at"),
  }
  if (canonicalNfcJson(value) !== canonicalNfcJson(expected)) {
    throw new Error("Developer Contract Draft validation request is non-canonical")
  }
}

export function createDeveloperContractDraftValidationRecord(
  input: DeveloperContractDraftValidationRecordSource,
): DeveloperContractDraftValidationRecord {
  if (input.schema_version !== DEVELOPER_CONTRACT_DRAFT_VALIDATION_RECORD_SCHEMA_VERSION
      || input.reconciliation_policy_version !== DEVELOPER_CONTRACT_DRAFT_RECONCILIATION_POLICY_VERSION) {
    throw new Error("unsupported Developer Contract Draft validation record")
  }
  const errors = input.errors.map((item) => required(item, "validation error")).sort()
  if (new Set(errors).size !== errors.length) throw new Error("validation errors must be unique")
  const body: DeveloperContractDraftValidationRecordBody = {
    schema_version: DEVELOPER_CONTRACT_DRAFT_VALIDATION_RECORD_SCHEMA_VERSION,
    validation_id: required(input.validation_id, "validation_id"),
    brief_id: required(input.brief_id, "brief_id"),
    brief_hash: digest(input.brief_hash, "brief_hash"),
    proposal_id: required(input.proposal_id, "proposal_id"),
    proposal_revision: positiveInteger(input.proposal_revision, "proposal_revision"),
    proposal_hash: digest(input.proposal_hash, "proposal_hash"),
    draft_revision: positiveInteger(input.draft_revision, "draft_revision"),
    draft_receipt_hash: digest(input.draft_receipt_hash, "draft_receipt_hash"),
    submission_hash: digest(input.submission_hash, "submission_hash"),
    contract_draft_hash: digest(input.contract_draft_hash, "contract_draft_hash"),
    contract_candidate_hash: digest(input.contract_candidate_hash, "contract_candidate_hash"),
    candidate_space_hash: digest(input.candidate_space_hash, "candidate_space_hash"),
    candidate_assignment_set_hash: digest(input.candidate_assignment_set_hash, "candidate_assignment_set_hash"),
    target_contract_schema_version: required(input.target_contract_schema_version, "target_contract_schema_version"),
    contract_validator_version: required(input.contract_validator_version, "contract_validator_version"),
    reconciliation_policy_version: DEVELOPER_CONTRACT_DRAFT_RECONCILIATION_POLICY_VERSION,
    status: errors.length === 0 ? "valid" : "invalid",
    errors,
    validated_at: utc(input.validated_at, "validated_at"),
  }
  return { ...body, validation_hash: canonicalControlPlaneHash(body) }
}

export function assertDeveloperContractDraftValidationRecord(
  value: DeveloperContractDraftValidationRecord,
): void {
  if (!isRecord(value)) throw new Error("Developer Contract Draft validation record must be an object")
  const { validation_hash: _validationHash, status: _status, ...source } = value
  const expected = createDeveloperContractDraftValidationRecord(source)
  if (canonicalNfcJson(value) !== canonicalNfcJson(expected)) {
    throw new Error("Developer Contract Draft validation record is non-canonical or hash-drifted")
  }
}
