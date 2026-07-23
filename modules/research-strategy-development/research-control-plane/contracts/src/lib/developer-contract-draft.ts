import type { JSONRecord } from "../../../../../contracts/runtime-core/src/json"
import { canonicalNfcJson } from "../../../../../contracts/runtime-core/src/canonical-json"
import { canonicalControlPlaneHash } from "./control-plane-contracts"

export const DEVELOPER_DEVELOPMENT_BRIEF_ISSUE_REQUEST_SCHEMA_VERSION =
  "trade.rd-developer-development-brief-issue-request.v1" as const
export const DEVELOPER_DEVELOPMENT_BRIEF_SCHEMA_VERSION =
  "trade.rd-developer-development-brief.v1" as const
export const DEVELOPER_CONTRACT_DRAFT_SUBMISSION_SCHEMA_VERSION =
  "trade.rd-developer-contract-draft-submission.v1" as const
export const DEVELOPER_CONTRACT_DRAFT_INTAKE_REQUEST_SCHEMA_VERSION =
  "trade.rd-developer-contract-draft-intake-request.v1" as const
export const DEVELOPER_CONTRACT_DRAFT_RECEIPT_SCHEMA_VERSION =
  "trade.rd-developer-contract-draft-receipt.v1" as const
export const DEVELOPER_CONTRACT_DRAFT_INTAKE_POLICY_VERSION =
  "rd-developer-contract-draft-intake-v1" as const
export const DEVELOPER_AGENT_DRAFT_PROVENANCE_SCHEMA_VERSION =
  "trade.rd-developer-agent-draft-provenance.v1" as const
export const DEVELOPER_EXPERIMENT_CONTRACT_DRAFT_PAYLOAD_SCHEMA_VERSION =
  "trade.rd-experiment-contract-draft-payload.v1" as const
export const TARGET_EXPERIMENT_CONTRACT_SCHEMA_VERSION =
  "trade-flow.rd-experiment-contract.v3" as const

export interface DeveloperDevelopmentBriefIssueRequest extends JSONRecord {
  schema_version: typeof DEVELOPER_DEVELOPMENT_BRIEF_ISSUE_REQUEST_SCHEMA_VERSION
  brief_id: string
  proposal_id: string
  proposal_revision: number
  idempotency_key: string
  issued_at: string
}

export interface DeveloperDevelopmentBriefSource extends JSONRecord {
  schema_version: typeof DEVELOPER_DEVELOPMENT_BRIEF_SCHEMA_VERSION
  brief_id: string
  proposal_id: string
  proposal_revision: number
  proposal_hash: string
  proposal_admission_hash: string
  hypothesis_id: string
  universe_node_id: string
  objective: string
  dataset_requirements: string[]
  candidate_space: JSONRecord
  max_trial_budget: number
  evaluation_protocol_ref: string
  target_contract_schema_version: typeof TARGET_EXPERIMENT_CONTRACT_SCHEMA_VERSION
  authority_scope: "contract_draft_only"
  issued_at: string
}

export interface DeveloperDevelopmentBriefBody extends DeveloperDevelopmentBriefSource {
  allowed_candidate_space_hash: string
}

export interface DeveloperDevelopmentBrief extends DeveloperDevelopmentBriefBody {
  brief_hash: string
}

export interface DeveloperContractDraftSubmissionSource extends JSONRecord {
  schema_version: typeof DEVELOPER_CONTRACT_DRAFT_SUBMISSION_SCHEMA_VERSION
  brief_id: string
  brief_hash: string
  proposal_id: string
  proposal_revision: number
  proposal_hash: string
  developer_run_id: string
  draft_revision: number
  allowed_candidate_space_hash: string
  requested_trial_budget: number
  target_contract_schema_version: typeof TARGET_EXPERIMENT_CONTRACT_SCHEMA_VERSION
  draft_json: JSONRecord
  created_at: string
}

export interface DeveloperContractDraftSubmissionBody extends DeveloperContractDraftSubmissionSource {
  contract_draft_hash: string
}

export interface DeveloperContractDraftSubmission extends DeveloperContractDraftSubmissionBody {
  submission_hash: string
}

export interface DeveloperContractDraftIntakeRequest extends JSONRecord {
  schema_version: typeof DEVELOPER_CONTRACT_DRAFT_INTAKE_REQUEST_SCHEMA_VERSION
  idempotency_key: string
  recorded_at: string
  submission: DeveloperContractDraftSubmission
  agent_provenance?: DeveloperAgentDraftProvenance
}

export interface DeveloperAgentDraftProvenanceBody extends JSONRecord {
  schema_version: typeof DEVELOPER_AGENT_DRAFT_PROVENANCE_SCHEMA_VERSION
  developer_run_id: string
  agent_run_request_hash: string
  agent_run_result_hash: string
  agent_submission_hash: string
  contract_draft_submission_hash: string
  source_revision: string
  authority_scope: "source_binding_only"
  recorded_at: string
}

export interface DeveloperAgentDraftProvenance
  extends DeveloperAgentDraftProvenanceBody {
  provenance_hash: string
}

export interface DeveloperContractDraftReceiptBody extends JSONRecord {
  schema_version: typeof DEVELOPER_CONTRACT_DRAFT_RECEIPT_SCHEMA_VERSION
  brief_id: string
  brief_hash: string
  proposal_id: string
  proposal_revision: number
  proposal_hash: string
  developer_run_id: string
  draft_revision: number
  submission_hash: string
  contract_draft_hash: string
  intake_policy_version: typeof DEVELOPER_CONTRACT_DRAFT_INTAKE_POLICY_VERSION
  status: "received_unvalidated"
  recorded_at: string
}

export interface DeveloperContractDraftReceipt extends DeveloperContractDraftReceiptBody {
  receipt_hash: string
}

export function assertDeveloperDevelopmentBriefIssueRequest(
  value: DeveloperDevelopmentBriefIssueRequest,
): void {
  if (!isRecord(value)) throw new Error("Developer Development Brief issue request must be an object")
  const expected: DeveloperDevelopmentBriefIssueRequest = {
    schema_version: DEVELOPER_DEVELOPMENT_BRIEF_ISSUE_REQUEST_SCHEMA_VERSION,
    brief_id: required(value.brief_id, "brief_id"),
    proposal_id: required(value.proposal_id, "proposal_id"),
    proposal_revision: positiveInteger(value.proposal_revision, "proposal_revision"),
    idempotency_key: required(value.idempotency_key, "idempotency_key"),
    issued_at: utc(value.issued_at, "issued_at"),
  }
  if (canonicalNfcJson(value) !== canonicalNfcJson(expected)) {
    throw new Error("Developer Development Brief issue request is non-canonical")
  }
}

export function createDeveloperDevelopmentBrief(
  input: DeveloperDevelopmentBriefSource,
): DeveloperDevelopmentBrief {
  if (input.schema_version !== DEVELOPER_DEVELOPMENT_BRIEF_SCHEMA_VERSION
      || input.target_contract_schema_version !== TARGET_EXPERIMENT_CONTRACT_SCHEMA_VERSION
      || input.authority_scope !== "contract_draft_only") {
    throw new Error("unsupported Developer Development Brief contract")
  }
  const datasetRequirements = input.dataset_requirements.map((item) => required(item, "dataset requirement")).sort()
  if (datasetRequirements.length === 0 || new Set(datasetRequirements).size !== datasetRequirements.length) {
    throw new Error("Developer Development Brief dataset requirements must be non-empty and unique")
  }
  if (!isRecord(input.candidate_space) || Object.keys(input.candidate_space).length === 0) {
    throw new Error("Developer Development Brief candidate_space must be a non-empty JSON object")
  }
  const candidateSpace = structuredClone(input.candidate_space)
  const body: DeveloperDevelopmentBriefBody = {
    schema_version: DEVELOPER_DEVELOPMENT_BRIEF_SCHEMA_VERSION,
    brief_id: required(input.brief_id, "brief_id"),
    proposal_id: required(input.proposal_id, "proposal_id"),
    proposal_revision: positiveInteger(input.proposal_revision, "proposal_revision"),
    proposal_hash: digest(input.proposal_hash, "proposal_hash"),
    proposal_admission_hash: digest(input.proposal_admission_hash, "proposal_admission_hash"),
    hypothesis_id: required(input.hypothesis_id, "hypothesis_id"),
    universe_node_id: required(input.universe_node_id, "universe_node_id"),
    objective: required(input.objective, "objective"),
    dataset_requirements: datasetRequirements,
    candidate_space: candidateSpace,
    allowed_candidate_space_hash: canonicalControlPlaneHash(candidateSpace),
    max_trial_budget: positiveInteger(input.max_trial_budget, "max_trial_budget"),
    evaluation_protocol_ref: required(input.evaluation_protocol_ref, "evaluation_protocol_ref"),
    target_contract_schema_version: TARGET_EXPERIMENT_CONTRACT_SCHEMA_VERSION,
    authority_scope: "contract_draft_only",
    issued_at: utc(input.issued_at, "issued_at"),
  }
  return { ...body, brief_hash: canonicalControlPlaneHash(body) }
}

export function assertDeveloperDevelopmentBrief(value: DeveloperDevelopmentBrief): void {
  if (!isRecord(value)) throw new Error("Developer Development Brief must be an object")
  const { brief_hash: _briefHash, allowed_candidate_space_hash: _candidateHash, ...source } = value
  const expected = createDeveloperDevelopmentBrief(source)
  if (canonicalNfcJson(value) !== canonicalNfcJson(expected)) {
    throw new Error("Developer Development Brief is non-canonical or hash-drifted")
  }
}

export function createDeveloperContractDraftSubmission(
  input: DeveloperContractDraftSubmissionSource,
): DeveloperContractDraftSubmission {
  if (input.schema_version !== DEVELOPER_CONTRACT_DRAFT_SUBMISSION_SCHEMA_VERSION
      || input.target_contract_schema_version !== TARGET_EXPERIMENT_CONTRACT_SCHEMA_VERSION) {
    throw new Error("unsupported Developer Contract Draft submission contract")
  }
  if (!isRecord(input.draft_json) || Object.keys(input.draft_json).length === 0) {
    throw new Error("draft_json must be a non-empty JSON object")
  }
  if (input.draft_json.schema_version !== DEVELOPER_EXPERIMENT_CONTRACT_DRAFT_PAYLOAD_SCHEMA_VERSION) {
    throw new Error(`draft_json.schema_version must be ${DEVELOPER_EXPERIMENT_CONTRACT_DRAFT_PAYLOAD_SCHEMA_VERSION}`)
  }
  const draftJson = structuredClone(input.draft_json)
  const body: DeveloperContractDraftSubmissionBody = {
    schema_version: DEVELOPER_CONTRACT_DRAFT_SUBMISSION_SCHEMA_VERSION,
    brief_id: required(input.brief_id, "brief_id"),
    brief_hash: digest(input.brief_hash, "brief_hash"),
    proposal_id: required(input.proposal_id, "proposal_id"),
    proposal_revision: positiveInteger(input.proposal_revision, "proposal_revision"),
    proposal_hash: digest(input.proposal_hash, "proposal_hash"),
    developer_run_id: required(input.developer_run_id, "developer_run_id"),
    draft_revision: positiveInteger(input.draft_revision, "draft_revision"),
    allowed_candidate_space_hash: digest(input.allowed_candidate_space_hash, "allowed_candidate_space_hash"),
    requested_trial_budget: positiveInteger(input.requested_trial_budget, "requested_trial_budget"),
    target_contract_schema_version: TARGET_EXPERIMENT_CONTRACT_SCHEMA_VERSION,
    draft_json: draftJson,
    contract_draft_hash: canonicalControlPlaneHash(draftJson),
    created_at: utc(input.created_at, "created_at"),
  }
  return { ...body, submission_hash: canonicalControlPlaneHash(body) }
}

export function assertDeveloperContractDraftSubmission(value: DeveloperContractDraftSubmission): void {
  if (!isRecord(value)) throw new Error("Developer Contract Draft submission must be an object")
  const { submission_hash: _submissionHash, contract_draft_hash: _draftHash, ...source } = value
  const expected = createDeveloperContractDraftSubmission(source)
  if (canonicalNfcJson(value) !== canonicalNfcJson(expected)) {
    throw new Error("Developer Contract Draft submission is non-canonical or hash-drifted")
  }
}

export function assertDeveloperContractDraftIntakeRequest(value: DeveloperContractDraftIntakeRequest): void {
  if (!isRecord(value)) throw new Error("Developer Contract Draft intake request must be an object")
  if (value.schema_version !== DEVELOPER_CONTRACT_DRAFT_INTAKE_REQUEST_SCHEMA_VERSION) {
    throw new Error("unsupported Developer Contract Draft intake request schema")
  }
  if (!isRecord(value.submission)) throw new Error("Developer Contract Draft intake requires submission")
  assertDeveloperContractDraftSubmission(value.submission as DeveloperContractDraftSubmission)
  const provenance = value.agent_provenance == null
    ? undefined
    : assertDeveloperAgentDraftProvenance(value.agent_provenance)
  const expected: DeveloperContractDraftIntakeRequest = {
    schema_version: DEVELOPER_CONTRACT_DRAFT_INTAKE_REQUEST_SCHEMA_VERSION,
    idempotency_key: required(value.idempotency_key, "idempotency_key"),
    recorded_at: utc(value.recorded_at, "recorded_at"),
    submission: value.submission,
    ...(provenance == null ? {} : { agent_provenance: provenance }),
  }
  if (Date.parse(value.submission.created_at) > Date.parse(expected.recorded_at)) {
    throw new Error("Developer Contract Draft timestamps must satisfy created_at <= recorded_at")
  }
  if (canonicalNfcJson(value) !== canonicalNfcJson(expected)) {
    throw new Error("Developer Contract Draft intake request is non-canonical")
  }
}

export function createDeveloperAgentDraftProvenance(
  input: DeveloperAgentDraftProvenanceBody,
): DeveloperAgentDraftProvenance {
  if (input.schema_version !== DEVELOPER_AGENT_DRAFT_PROVENANCE_SCHEMA_VERSION
      || input.authority_scope !== "source_binding_only") {
    throw new Error("unsupported Developer Agent Draft provenance")
  }
  const body: DeveloperAgentDraftProvenanceBody = {
    schema_version: DEVELOPER_AGENT_DRAFT_PROVENANCE_SCHEMA_VERSION,
    developer_run_id: required(input.developer_run_id, "developer_run_id"),
    agent_run_request_hash: digest(
      input.agent_run_request_hash,
      "agent_run_request_hash",
    ),
    agent_run_result_hash: digest(
      input.agent_run_result_hash,
      "agent_run_result_hash",
    ),
    agent_submission_hash: digest(
      input.agent_submission_hash,
      "agent_submission_hash",
    ),
    contract_draft_submission_hash: digest(
      input.contract_draft_submission_hash,
      "contract_draft_submission_hash",
    ),
    source_revision: revision(input.source_revision),
    authority_scope: "source_binding_only",
    recorded_at: utc(input.recorded_at, "recorded_at"),
  }
  return {
    ...body,
    provenance_hash: canonicalControlPlaneHash(body),
  }
}

export function assertDeveloperAgentDraftProvenance(
  value: DeveloperAgentDraftProvenance,
): DeveloperAgentDraftProvenance {
  if (!isRecord(value)) {
    throw new Error("Developer Agent Draft provenance must be an object")
  }
  const { provenance_hash: _hash, ...body } = value
  const expected = createDeveloperAgentDraftProvenance(
    body as DeveloperAgentDraftProvenanceBody,
  )
  if (canonicalNfcJson(value) !== canonicalNfcJson(expected)) {
    throw new Error(
      "Developer Agent Draft provenance is non-canonical or hash-drifted",
    )
  }
  return expected
}

export function createDeveloperContractDraftReceipt(
  input: DeveloperContractDraftReceiptBody,
): DeveloperContractDraftReceipt {
  if (input.schema_version !== DEVELOPER_CONTRACT_DRAFT_RECEIPT_SCHEMA_VERSION
      || input.intake_policy_version !== DEVELOPER_CONTRACT_DRAFT_INTAKE_POLICY_VERSION
      || input.status !== "received_unvalidated") {
    throw new Error("unsupported Developer Contract Draft receipt")
  }
  const body: DeveloperContractDraftReceiptBody = {
    schema_version: DEVELOPER_CONTRACT_DRAFT_RECEIPT_SCHEMA_VERSION,
    brief_id: required(input.brief_id, "brief_id"),
    brief_hash: digest(input.brief_hash, "brief_hash"),
    proposal_id: required(input.proposal_id, "proposal_id"),
    proposal_revision: positiveInteger(input.proposal_revision, "proposal_revision"),
    proposal_hash: digest(input.proposal_hash, "proposal_hash"),
    developer_run_id: required(input.developer_run_id, "developer_run_id"),
    draft_revision: positiveInteger(input.draft_revision, "draft_revision"),
    submission_hash: digest(input.submission_hash, "submission_hash"),
    contract_draft_hash: digest(input.contract_draft_hash, "contract_draft_hash"),
    intake_policy_version: DEVELOPER_CONTRACT_DRAFT_INTAKE_POLICY_VERSION,
    status: "received_unvalidated",
    recorded_at: utc(input.recorded_at, "recorded_at"),
  }
  return { ...body, receipt_hash: canonicalControlPlaneHash(body) }
}

export function assertDeveloperContractDraftReceipt(value: DeveloperContractDraftReceipt): void {
  if (!isRecord(value)) throw new Error("Developer Contract Draft receipt must be an object")
  const { receipt_hash: _receiptHash, ...body } = value
  const expected = createDeveloperContractDraftReceipt(body)
  if (canonicalNfcJson(value) !== canonicalNfcJson(expected)) {
    throw new Error("Developer Contract Draft receipt is non-canonical or hash-drifted")
  }
}

export function required(value: string, field: string): string {
  const normalized = value?.trim()
  if (!normalized) throw new Error(`${field} is required`)
  return normalized
}

export function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${field} must be a positive integer`)
  return value
}

export function digest(value: string, field: string): string {
  const normalized = required(value, field)
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error(`${field} must be a lowercase sha256 digest`)
  return normalized
}

function revision(value: string): string {
  const normalized = required(value, "source_revision")
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(normalized)) {
    throw new Error("source_revision is invalid")
  }
  return normalized
}

export function utc(value: string, field: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)
      || Number.isNaN(Date.parse(value))) {
    throw new Error(`${field} must be an RFC 3339 UTC timestamp`)
  }
  return value
}

export function isRecord(value: unknown): value is JSONRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
