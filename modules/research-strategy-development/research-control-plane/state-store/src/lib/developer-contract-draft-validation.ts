import { Database } from "bun:sqlite"
import type { JSONRecord } from "../../../../../contracts/runtime-core/src/json"
import { canonicalControlPlaneHash } from "../../../contracts/src/lib/control-plane-contracts"
import {
  DEVELOPER_CONTRACT_DRAFT_RECONCILIATION_POLICY_VERSION,
  DEVELOPER_CONTRACT_DRAFT_VALIDATION_RECORD_SCHEMA_VERSION,
  assertDeveloperContractDraftValidationRecord,
  assertDeveloperContractDraftValidationRequest,
  createDeveloperContractDraftValidationRecord,
  type DeveloperContractDraftValidationRecord,
  type DeveloperContractDraftValidationRequest,
} from "../../../contracts/src/lib/developer-contract-draft-validation"
import {
  assertDeveloperContractDraftReceipt,
  assertDeveloperContractDraftSubmission,
  assertDeveloperDevelopmentBrief,
  type DeveloperContractDraftReceipt,
  type DeveloperContractDraftSubmission,
  type DeveloperDevelopmentBrief,
} from "../../../contracts/src/lib/developer-contract-draft"
import { RESEARCH_CONTRACT_VALIDATOR_VERSION, validateResearchProposal } from "./research-contract-validator"

export function validateDeveloperContractDraft(
  db: Database,
  request: DeveloperContractDraftValidationRequest,
): DeveloperContractDraftValidationRecord {
  assertDeveloperContractDraftValidationRequest(request)
  const validate = db.transaction(() => {
    const requestHash = canonicalControlPlaneHash(request)
    const replay = db.query(`
      SELECT validation_request_hash, validation_json
      FROM rd_developer_contract_draft_validation
      WHERE idempotency_key = $idempotency_key
    `).get({ $idempotency_key: request.idempotency_key }) as ValidationReplayRow | null
    if (replay) {
      if (replay.validation_request_hash !== requestHash) {
        throw new Error("Contract Draft validation idempotency key already exists with different content")
      }
      return parseValidationRecord(replay.validation_json)
    }

    const row = db.query(`
      SELECT d.submission_json, d.receipt_json, b.brief_json,
             (SELECT MAX(latest.draft_revision)
              FROM rd_developer_contract_draft latest
              WHERE latest.brief_id = d.brief_id) AS latest_draft_revision,
             (SELECT MAX(proposal.proposal_revision)
              FROM rd_planner_proposal_revision proposal
              WHERE proposal.proposal_id = b.proposal_id) AS latest_proposal_revision
      FROM rd_developer_contract_draft d
      JOIN rd_developer_development_brief b ON b.brief_id = d.brief_id
      WHERE d.brief_id = $brief_id AND d.draft_revision = $draft_revision
    `).get({
      $brief_id: request.brief_id,
      $draft_revision: request.draft_revision,
    }) as DraftValidationRow | null
    if (!row) throw new Error("Contract Draft validation requires a received Draft revision")
    if (row.latest_draft_revision !== request.draft_revision) {
      throw new Error("only the latest received Contract Draft revision may be validated")
    }

    const brief = parseBrief(row.brief_json)
    const submission = parseSubmission(row.submission_json)
    const receipt = parseReceipt(row.receipt_json)
    if (Date.parse(request.validated_at) < Date.parse(receipt.recorded_at)) {
      throw new Error("Contract Draft validation cannot predate Draft receipt")
    }
    const result = reconcileDraft(brief, submission, row.latest_proposal_revision)
    const record = createDeveloperContractDraftValidationRecord({
      schema_version: DEVELOPER_CONTRACT_DRAFT_VALIDATION_RECORD_SCHEMA_VERSION,
      validation_id: request.validation_id,
      brief_id: brief.brief_id,
      brief_hash: brief.brief_hash,
      proposal_id: brief.proposal_id,
      proposal_revision: brief.proposal_revision,
      proposal_hash: brief.proposal_hash,
      draft_revision: submission.draft_revision,
      draft_receipt_hash: receipt.receipt_hash,
      submission_hash: submission.submission_hash,
      contract_draft_hash: submission.contract_draft_hash,
      contract_candidate_hash: result.contract_candidate_hash,
      candidate_space_hash: result.candidate_space_hash,
      candidate_assignment_set_hash: result.candidate_assignment_set_hash,
      target_contract_schema_version: submission.target_contract_schema_version,
      contract_validator_version: RESEARCH_CONTRACT_VALIDATOR_VERSION,
      reconciliation_policy_version: DEVELOPER_CONTRACT_DRAFT_RECONCILIATION_POLICY_VERSION,
      errors: result.errors,
      validated_at: request.validated_at,
    })

    const naturalReplay = db.query(`
      SELECT validation_json
      FROM rd_developer_contract_draft_validation
      WHERE brief_id = $brief_id AND draft_revision = $draft_revision
    `).get({
      $brief_id: request.brief_id,
      $draft_revision: request.draft_revision,
    }) as { validation_json: string } | null
    if (naturalReplay) {
      const existing = parseValidationRecord(naturalReplay.validation_json)
      if (existing.validation_hash === record.validation_hash) return existing
      throw new Error("Contract Draft revision already has a different Validation Record")
    }
    const idReplay = db.query(`
      SELECT validation_json
      FROM rd_developer_contract_draft_validation
      WHERE validation_id = $validation_id
    `).get({ $validation_id: request.validation_id }) as { validation_json: string } | null
    if (idReplay) {
      const existing = parseValidationRecord(idReplay.validation_json)
      if (existing.validation_hash === record.validation_hash) return existing
      throw new Error("validation_id already exists with different content")
    }

    db.query(`
      INSERT INTO rd_developer_contract_draft_validation(
        validation_id, brief_id, draft_revision, idempotency_key,
        validation_request_hash, submission_hash, draft_receipt_hash,
        validation_status, contract_validator_version, reconciliation_policy_version,
        validation_hash, validation_json, validated_at
      ) VALUES (
        $validation_id, $brief_id, $draft_revision, $idempotency_key,
        $validation_request_hash, $submission_hash, $draft_receipt_hash,
        $validation_status, $contract_validator_version, $reconciliation_policy_version,
        $validation_hash, $validation_json, $validated_at
      )
    `).run({
      $validation_id: record.validation_id,
      $brief_id: record.brief_id,
      $draft_revision: record.draft_revision,
      $idempotency_key: request.idempotency_key,
      $validation_request_hash: requestHash,
      $submission_hash: record.submission_hash,
      $draft_receipt_hash: record.draft_receipt_hash,
      $validation_status: record.status,
      $contract_validator_version: record.contract_validator_version,
      $reconciliation_policy_version: record.reconciliation_policy_version,
      $validation_hash: record.validation_hash,
      $validation_json: JSON.stringify(record),
      $validated_at: record.validated_at,
    })
    return record
  })
  return validate.immediate()
}

export function readDeveloperContractDraftValidation(
  db: Database,
  validationId: string,
): DeveloperContractDraftValidationRecord {
  if (!validationId.trim()) throw new Error("validation_id is required")
  const row = db.query(`
    SELECT validation_json
    FROM rd_developer_contract_draft_validation
    WHERE validation_id = $validation_id
  `).get({ $validation_id: validationId }) as { validation_json: string } | null
  if (!row) throw new Error("Developer Contract Draft Validation Record is missing")
  return parseValidationRecord(row.validation_json)
}

function reconcileDraft(
  brief: DeveloperDevelopmentBrief,
  submission: DeveloperContractDraftSubmission,
  latestProposalRevision: number,
): ReconciliationResult {
  const errors: string[] = []
  if (latestProposalRevision !== brief.proposal_revision) errors.push("brief.stale_proposal_revision")

  const contractValue = submission.draft_json.contract
  const contract = isRecord(contractValue) ? contractValue : {}
  const validation = validateResearchProposal("experiment", contract)
  errors.push(...validation.errors.map((error) => `contract.${error}`))
  if (!isRecord(contractValue)) errors.push("draft.contract must be an object")
  if (contract.canonical_node_id !== brief.universe_node_id) errors.push("contract.canonical_node_id must match Brief")
  if (!sameStrings(contract.required_data, brief.dataset_requirements)) errors.push("contract.required_data must exactly match Brief")

  const versions = record(contract.contract_versions)
  if (versions.validator !== RESEARCH_CONTRACT_VALIDATOR_VERSION) {
    errors.push(`contract.contract_versions.validator must be ${RESEARCH_CONTRACT_VALIDATOR_VERSION}`)
  }
  const validationPlan = record(contract.validation_plan)
  if (validationPlan.evaluation_protocol_ref !== brief.evaluation_protocol_ref) {
    errors.push("contract.validation_plan.evaluation_protocol_ref must match Brief")
  }

  const candidateSpace = submission.draft_json.candidate_space
  const candidateSpaceHash = canonicalControlPlaneHash(candidateSpace ?? null)
  if (!isRecord(candidateSpace)) errors.push("draft.candidate_space must be an object")
  if (candidateSpaceHash !== brief.allowed_candidate_space_hash) {
    errors.push("draft.candidate_space must exactly match Brief")
  }

  const assignments = normalizeAssignments(submission.draft_json.candidate_assignments)
  const candidateAssignmentSetHash = canonicalControlPlaneHash(assignments.normalized)
  errors.push(...assignments.errors)
  errors.push(...validateAxisEnumerationSpace(candidateSpace, assignments.normalized))
  if (assignments.normalized.length > submission.requested_trial_budget) {
    errors.push("draft.candidate_assignments exceed requested_trial_budget")
  }

  const candidateRegistration = record(contract.candidate_registration)
  const contractCandidateIds = stringItems(candidateRegistration.candidate_ids)
  const assignmentIds = assignments.normalized.map((item) => item.candidate_id)
  if (!sameStringLists(contractCandidateIds, assignmentIds)) {
    errors.push("contract.candidate_registration.candidate_ids must exactly match Draft assignments")
  }
  if (candidateRegistration.candidate_space_hash !== brief.allowed_candidate_space_hash) {
    errors.push("contract.candidate_registration.candidate_space_hash must match Brief")
  }
  if (candidateRegistration.candidate_assignment_set_hash !== candidateAssignmentSetHash) {
    errors.push("contract.candidate_registration.candidate_assignment_set_hash must match Draft assignments")
  }

  const group = record(contract.trial_group_ref)
  if (group.search_space_hash !== brief.allowed_candidate_space_hash) {
    errors.push("contract.trial_group_ref.search_space_hash must match Brief")
  }
  if (group.max_trials !== submission.requested_trial_budget) {
    errors.push("contract.trial_group_ref.max_trials must match requested_trial_budget")
  }

  return {
    contract_candidate_hash: canonicalControlPlaneHash(contractValue ?? null),
    candidate_space_hash: candidateSpaceHash,
    candidate_assignment_set_hash: candidateAssignmentSetHash,
    errors: [...new Set(errors)],
  }
}

function normalizeAssignments(value: unknown): NormalizedAssignments {
  if (!Array.isArray(value)) {
    return { normalized: [], errors: ["draft.candidate_assignments must be a non-empty array"] }
  }
  const errors: string[] = []
  const normalized = value.map((item, index) => {
    const row = record(item)
    const candidateId = typeof row.candidate_id === "string" ? row.candidate_id.trim() : ""
    if (!candidateId) errors.push(`draft.candidate_assignments[${index}].candidate_id is required`)
    const parameters = isRecord(row.parameters) ? row.parameters : {}
    if (!isRecord(row.parameters)) errors.push(`draft.candidate_assignments[${index}].parameters must be an object`)
    return { candidate_id: candidateId, parameters }
  }).sort((left, right) => left.candidate_id.localeCompare(right.candidate_id))
  if (normalized.length === 0) errors.push("draft.candidate_assignments must be a non-empty array")
  if (new Set(normalized.map((item) => item.candidate_id)).size !== normalized.length) {
    errors.push("draft.candidate_assignments candidate_id must be unique")
  }
  return { normalized, errors }
}

function validateAxisEnumerationSpace(
  value: unknown,
  assignments: NormalizedCandidateAssignment[],
): string[] {
  if (!isRecord(value)) return []
  const errors: string[] = []
  const axes = Object.keys(value).sort()
  if (axes.length === 0) return ["draft.candidate_space must not be empty"]
  const allowed = new Map<string, Set<string>>()
  for (const axis of axes) {
    const choices = value[axis]
    if (!Array.isArray(choices) || choices.length === 0 || choices.some((choice) => !isJsonScalar(choice))) {
      errors.push(`draft.candidate_space.${axis} must be a non-empty scalar enumeration`)
      continue
    }
    const hashes = choices.map(canonicalControlPlaneHash)
    if (new Set(hashes).size !== hashes.length) errors.push(`draft.candidate_space.${axis} choices must be unique`)
    allowed.set(axis, new Set(hashes))
  }
  for (const assignment of assignments) {
    const parameterKeys = Object.keys(assignment.parameters).sort()
    if (!sameStringLists(parameterKeys, axes)) {
      errors.push(`candidate ${assignment.candidate_id} parameters must exactly cover candidate_space axes`)
      continue
    }
    for (const axis of axes) {
      if (!allowed.get(axis)?.has(canonicalControlPlaneHash(assignment.parameters[axis]))) {
        errors.push(`candidate ${assignment.candidate_id} parameter ${axis} is outside candidate_space`)
      }
    }
  }
  return errors
}

function parseBrief(value: string): DeveloperDevelopmentBrief {
  const brief = JSON.parse(value) as DeveloperDevelopmentBrief
  assertDeveloperDevelopmentBrief(brief)
  return brief
}

function parseSubmission(value: string): DeveloperContractDraftSubmission {
  const submission = JSON.parse(value) as DeveloperContractDraftSubmission
  assertDeveloperContractDraftSubmission(submission)
  return submission
}

function parseReceipt(value: string): DeveloperContractDraftReceipt {
  const receipt = JSON.parse(value) as DeveloperContractDraftReceipt
  assertDeveloperContractDraftReceipt(receipt)
  return receipt
}

function parseValidationRecord(value: string): DeveloperContractDraftValidationRecord {
  const record = JSON.parse(value) as DeveloperContractDraftValidationRecord
  assertDeveloperContractDraftValidationRecord(record)
  return record
}

function record(value: unknown): JSONRecord {
  return isRecord(value) ? value : {}
}

function isRecord(value: unknown): value is JSONRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function isJsonScalar(value: unknown): boolean {
  return value === null || typeof value === "string" || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value))
}

function stringItems(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()) : []
}

function sameStrings(value: unknown, expected: string[]): boolean {
  return sameStringLists(stringItems(value), expected)
}

function sameStringLists(left: string[], right: string[]): boolean {
  const a = [...left].sort()
  const b = [...right].sort()
  return a.length === b.length && a.every((item, index) => item === b[index])
}

interface ValidationReplayRow { validation_request_hash: string; validation_json: string }
interface DraftValidationRow {
  submission_json: string
  receipt_json: string
  brief_json: string
  latest_draft_revision: number
  latest_proposal_revision: number
}
interface ReconciliationResult {
  contract_candidate_hash: string
  candidate_space_hash: string
  candidate_assignment_set_hash: string
  errors: string[]
}
interface NormalizedCandidateAssignment { candidate_id: string; parameters: JSONRecord }
interface NormalizedAssignments { normalized: NormalizedCandidateAssignment[]; errors: string[] }
