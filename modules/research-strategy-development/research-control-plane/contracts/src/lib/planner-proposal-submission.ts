import type { JSONRecord } from "../../../../../contracts/runtime-core/src/json"
import { canonicalNfcJson } from "../../../../../contracts/runtime-core/src/canonical-json"
import { canonicalControlPlaneHash } from "./control-plane-contracts"

export const PLANNER_PROPOSAL_SUBMISSION_SCHEMA_VERSION =
  "trade.rd-planner-proposal-submission.v2" as const
export const PLANNER_PROPOSAL_INTAKE_REQUEST_SCHEMA_VERSION =
  "trade.rd-planner-proposal-intake-request.v1" as const
export const PLANNER_PROPOSAL_ADMISSION_SCHEMA_VERSION =
  "trade.rd-planner-proposal-admission.v1" as const
export const PLANNER_PROPOSAL_INTAKE_POLICY_VERSION =
  "rd-planner-proposal-intake-v1" as const

export interface PlannerProposalSubmissionBody extends JSONRecord {
  schema_version: typeof PLANNER_PROPOSAL_SUBMISSION_SCHEMA_VERSION
  revision: 2
  proposal_id: string
  hypothesis_id: string
  universe_node_id: string
  objective: string
  dataset_requirements: string[]
  candidate_space: JSONRecord
  trial_budget: number
  evaluation_protocol_ref: string
  control_plane_context_hash: string
  created_at: string
}

export interface PlannerProposalSubmission extends PlannerProposalSubmissionBody {
  proposal_hash: string
}

export interface PlannerProposalIntakeRequest extends JSONRecord {
  schema_version: typeof PLANNER_PROPOSAL_INTAKE_REQUEST_SCHEMA_VERSION
  planner_run_id: string
  proposal_revision: number
  idempotency_key: string
  submitted_at: string
  recorded_at: string
  proposal: PlannerProposalSubmission
}

export interface PlannerProposalAdmissionBody extends JSONRecord {
  schema_version: typeof PLANNER_PROPOSAL_ADMISSION_SCHEMA_VERSION
  proposal_id: string
  proposal_revision: number
  proposal_hash: string
  planner_run_id: string
  hypothesis_id: string
  universe_node_id: string
  control_plane_context_hash: string
  intake_policy_version: typeof PLANNER_PROPOSAL_INTAKE_POLICY_VERSION
  status: "accepted"
  recorded_at: string
}

export interface PlannerProposalAdmission extends PlannerProposalAdmissionBody {
  admission_hash: string
}

export function createPlannerProposalSubmission(
  input: PlannerProposalSubmissionBody,
): PlannerProposalSubmission {
  if (input.schema_version !== PLANNER_PROPOSAL_SUBMISSION_SCHEMA_VERSION || input.revision !== 2) {
    throw new Error("unsupported Planner Proposal submission schema")
  }
  const datasetRequirements = input.dataset_requirements.map((item) => required(item, "dataset requirement")).sort()
  assertUnique(datasetRequirements, "dataset requirement")
  if (datasetRequirements.length === 0) throw new Error("dataset_requirements cannot be empty")
  if (!isRecord(input.candidate_space) || Object.keys(input.candidate_space).length === 0) {
    throw new Error("candidate_space must be a non-empty JSON object")
  }
  if (!Number.isSafeInteger(input.trial_budget) || input.trial_budget <= 0) {
    throw new Error("trial_budget must be a positive integer")
  }
  const body: PlannerProposalSubmissionBody = {
    schema_version: PLANNER_PROPOSAL_SUBMISSION_SCHEMA_VERSION,
    revision: 2,
    proposal_id: required(input.proposal_id, "proposal_id"),
    hypothesis_id: required(input.hypothesis_id, "hypothesis_id"),
    universe_node_id: required(input.universe_node_id, "universe_node_id"),
    objective: required(input.objective, "objective"),
    dataset_requirements: datasetRequirements,
    candidate_space: structuredClone(input.candidate_space),
    trial_budget: input.trial_budget,
    evaluation_protocol_ref: required(input.evaluation_protocol_ref, "evaluation_protocol_ref"),
    control_plane_context_hash: digest(input.control_plane_context_hash, "control_plane_context_hash"),
    created_at: utc(input.created_at, "created_at"),
  }
  return { ...body, proposal_hash: canonicalControlPlaneHash(body) }
}

export function assertPlannerProposalSubmission(value: PlannerProposalSubmission): void {
  if (!isRecord(value)) throw new Error("Planner Proposal submission must be an object")
  const { proposal_hash: _proposalHash, ...body } = value
  const expected = createPlannerProposalSubmission(body)
  if (canonicalNfcJson(value) !== canonicalNfcJson(expected)) {
    throw new Error("Planner Proposal submission is non-canonical or hash-drifted")
  }
}

export function assertPlannerProposalIntakeRequest(value: PlannerProposalIntakeRequest): void {
  if (!isRecord(value)) throw new Error("Planner Proposal intake request must be an object")
  if (value.schema_version !== PLANNER_PROPOSAL_INTAKE_REQUEST_SCHEMA_VERSION) {
    throw new Error("unsupported Planner Proposal intake request schema")
  }
  if (!isRecord(value.proposal)) throw new Error("Planner Proposal intake request requires proposal")
  assertPlannerProposalSubmission(value.proposal as PlannerProposalSubmission)
  if (!Number.isSafeInteger(value.proposal_revision) || value.proposal_revision < 1) {
    throw new Error("proposal_revision must be a positive integer")
  }
  const expected: PlannerProposalIntakeRequest = {
    schema_version: PLANNER_PROPOSAL_INTAKE_REQUEST_SCHEMA_VERSION,
    planner_run_id: required(value.planner_run_id, "planner_run_id"),
    proposal_revision: value.proposal_revision,
    idempotency_key: required(value.idempotency_key, "idempotency_key"),
    submitted_at: utc(value.submitted_at, "submitted_at"),
    recorded_at: utc(value.recorded_at, "recorded_at"),
    proposal: value.proposal,
  }
  if (Date.parse(expected.proposal.created_at) > Date.parse(expected.submitted_at)
      || Date.parse(expected.submitted_at) > Date.parse(expected.recorded_at)) {
    throw new Error("Planner Proposal timestamps must satisfy created_at <= submitted_at <= recorded_at")
  }
  if (canonicalNfcJson(value) !== canonicalNfcJson(expected)) {
    throw new Error("Planner Proposal intake request is non-canonical")
  }
}

export function createPlannerProposalAdmission(
  input: PlannerProposalAdmissionBody,
): PlannerProposalAdmission {
  if (input.schema_version !== PLANNER_PROPOSAL_ADMISSION_SCHEMA_VERSION
      || input.intake_policy_version !== PLANNER_PROPOSAL_INTAKE_POLICY_VERSION
      || input.status !== "accepted") {
    throw new Error("unsupported Planner Proposal admission contract")
  }
  if (!Number.isSafeInteger(input.proposal_revision) || input.proposal_revision < 1) {
    throw new Error("proposal_revision must be a positive integer")
  }
  const body: PlannerProposalAdmissionBody = {
    schema_version: PLANNER_PROPOSAL_ADMISSION_SCHEMA_VERSION,
    proposal_id: required(input.proposal_id, "proposal_id"),
    proposal_revision: input.proposal_revision,
    proposal_hash: digest(input.proposal_hash, "proposal_hash"),
    planner_run_id: required(input.planner_run_id, "planner_run_id"),
    hypothesis_id: required(input.hypothesis_id, "hypothesis_id"),
    universe_node_id: required(input.universe_node_id, "universe_node_id"),
    control_plane_context_hash: digest(input.control_plane_context_hash, "control_plane_context_hash"),
    intake_policy_version: PLANNER_PROPOSAL_INTAKE_POLICY_VERSION,
    status: "accepted",
    recorded_at: utc(input.recorded_at, "recorded_at"),
  }
  return { ...body, admission_hash: canonicalControlPlaneHash(body) }
}

export function assertPlannerProposalAdmission(value: PlannerProposalAdmission): void {
  if (!isRecord(value)) throw new Error("Planner Proposal admission must be an object")
  const { admission_hash: _admissionHash, ...body } = value
  const expected = createPlannerProposalAdmission(body)
  if (canonicalNfcJson(value) !== canonicalNfcJson(expected)) {
    throw new Error("Planner Proposal admission is non-canonical or hash-drifted")
  }
}

function required(value: string, field: string): string {
  const normalized = value?.trim()
  if (!normalized) throw new Error(`${field} is required`)
  return normalized
}

function digest(value: string, field: string): string {
  const normalized = required(value, field)
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error(`${field} must be a lowercase sha256 digest`)
  return normalized
}

function utc(value: string, field: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)
      || Number.isNaN(Date.parse(value))) {
    throw new Error(`${field} must be an RFC 3339 UTC timestamp`)
  }
  return value
}

function assertUnique(values: string[], field: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${field} must be unique`)
}

function isRecord(value: unknown): value is JSONRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
