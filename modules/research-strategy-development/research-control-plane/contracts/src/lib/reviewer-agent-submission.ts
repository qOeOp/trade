import { canonicalNfcJson } from "../../../../../contracts/runtime-core/src/canonical-json"
import { canonicalControlPlaneHash } from "./control-plane-contracts"

export const REVIEWER_AGENT_SUBMISSION_SCHEMA =
  "trade.rd-reviewer-agent-submission.v1" as const

export type ReviewerAgentDecision =
  | "reject"
  | "modify"
  | "accept_for_draft"
  | "accept_for_forward"
  | "accept_for_shadow_candidate"

export type ReviewerEvidenceRole =
  | "primary"
  | "supporting"
  | "negative_control"
  | "cost"
  | "stability"
  | "holdout"

export interface ReviewerAgentEvidence {
  result_id: string
  evidence_role: ReviewerEvidenceRole
}

export interface ReviewerAgentSubmissionBody {
  schema_version: typeof REVIEWER_AGENT_SUBMISSION_SCHEMA
  reviewer_run_id: string
  experiment_id: string
  expected_version: number
  stage_id: string
  decision: ReviewerAgentDecision
  evidence: ReviewerAgentEvidence[]
  selected_trial_id: string | null
  rationale: string
  created_at: string
}

export interface ReviewerAgentSubmission extends ReviewerAgentSubmissionBody {
  submission_hash: string
}

export function createReviewerAgentSubmission(
  input: ReviewerAgentSubmissionBody,
): ReviewerAgentSubmission {
  if (input.schema_version !== REVIEWER_AGENT_SUBMISSION_SCHEMA) {
    throw new Error("Reviewer Agent submission schema is unsupported")
  }
  const evidence = input.evidence.map((item) => ({
    result_id: identifier(item.result_id, "result_id"),
    evidence_role: evidenceRole(item.evidence_role),
  })).sort((left, right) => (
    left.result_id.localeCompare(right.result_id)
      || left.evidence_role.localeCompare(right.evidence_role)
  ))
  if (evidence.length < 1 || evidence.length > 32) {
    throw new Error("Reviewer evidence must be a bounded non-empty array")
  }
  if (new Set(evidence.map((item) => item.result_id)).size !== evidence.length) {
    throw new Error("Reviewer evidence result ids must be unique")
  }
  if (evidence.filter((item) => item.evidence_role === "primary").length !== 1) {
    throw new Error("Reviewer submission requires exactly one primary result")
  }
  const decision = reviewerDecision(input.decision)
  const selectedTrialId = input.selected_trial_id == null
    ? null
    : identifier(input.selected_trial_id, "selected_trial_id")
  if ((decision === "accept_for_draft") !== (selectedTrialId != null)) {
    throw new Error("selected_trial_id is required only for accept_for_draft")
  }
  const rationale = input.rationale?.trim()
  if (!rationale || rationale.length > 8_000) throw new Error("Reviewer rationale is invalid")
  const body: ReviewerAgentSubmissionBody = {
    schema_version: REVIEWER_AGENT_SUBMISSION_SCHEMA,
    reviewer_run_id: identifier(input.reviewer_run_id, "reviewer_run_id"),
    experiment_id: identifier(input.experiment_id, "experiment_id"),
    expected_version: positiveInteger(input.expected_version, "expected_version"),
    stage_id: identifier(input.stage_id, "stage_id"),
    decision,
    evidence,
    selected_trial_id: selectedTrialId,
    rationale,
    created_at: utc(input.created_at),
  }
  return { ...body, submission_hash: canonicalControlPlaneHash(body) }
}

export function assertReviewerAgentSubmission(value: ReviewerAgentSubmission): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Reviewer Agent submission must be an object")
  }
  const { submission_hash: _submissionHash, ...body } = value
  const expected = createReviewerAgentSubmission(body)
  if (canonicalNfcJson(value) !== canonicalNfcJson(expected)) {
    throw new Error("Reviewer Agent submission is non-canonical or hash-drifted")
  }
}

function reviewerDecision(value: string): ReviewerAgentDecision {
  if (!["reject", "modify", "accept_for_draft", "accept_for_forward", "accept_for_shadow_candidate"].includes(value)) {
    throw new Error("Reviewer Agent decision is unsupported")
  }
  return value as ReviewerAgentDecision
}

function evidenceRole(value: string): ReviewerEvidenceRole {
  if (!["primary", "supporting", "negative_control", "cost", "stability", "holdout"].includes(value)) {
    throw new Error("Reviewer evidence role is unsupported")
  }
  return value as ReviewerEvidenceRole
}

function identifier(value: string, field: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)) throw new Error(`${field} is invalid`)
  return value
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${field} must be a positive integer`)
  return value
}

function utc(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new Error("created_at must be canonical UTC")
  }
  return value
}
