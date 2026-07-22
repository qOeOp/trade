import { Database } from "bun:sqlite"
import type { JSONRecord } from "../../../../../contracts/runtime-core/src/json"
import { canonicalControlPlaneHash } from "../../../contracts/src/lib/control-plane-contracts"
import {
  DEVELOPER_CONTRACT_FREEZE_COMPATIBILITY_PROJECTION_VERSION,
  DEVELOPER_CONTRACT_FREEZE_COMPILER_VERSION,
  DEVELOPER_CONTRACT_FREEZE_RECORD_SCHEMA_VERSION,
  assertDeveloperContractFreezeRecord,
  assertDeveloperContractFreezeRequest,
  createDeveloperContractFreezeRecord,
  type DeveloperContractFreezeRecord,
  type DeveloperContractFreezeRequest,
} from "../../../contracts/src/lib/developer-contract-freeze"
import {
  assertDeveloperContractDraftSubmission,
  assertDeveloperDevelopmentBrief,
  type DeveloperContractDraftSubmission,
  type DeveloperDevelopmentBrief,
} from "../../../contracts/src/lib/developer-contract-draft"
import {
  assertDeveloperContractDraftValidationRecord,
  type DeveloperContractDraftValidationRecord,
} from "../../../contracts/src/lib/developer-contract-draft-validation"
import { compileDeveloperContractFreezeTrialGroup } from "./developer-contract-freeze-compiler"
import {
  normalizeDeveloperContractCandidateAssignments,
  reconcileDeveloperContractDraft,
} from "./developer-contract-draft-validation"
import { RESEARCH_CONTRACT_VALIDATOR_VERSION, validateResearchProposal } from "./research-contract-validator"
import { registerExperiment, registerTrialGroup } from "./research-control-plane"
import { RESEARCH_LIFECYCLE_RULE_VERSION } from "./research-control-plane-schema"
import { IDENTITY_HASH_POLICY_VERSION, hashIdentityPayload } from "./research-identity-hash"

export function freezeDeveloperExperimentContract(
  db: Database,
  request: DeveloperContractFreezeRequest,
): DeveloperContractFreezeRecord {
  assertDeveloperContractFreezeRequest(request)
  const freeze = db.transaction(() => {
    const requestHash = canonicalControlPlaneHash(request)
    const replay = db.query(`
      SELECT freeze_request_hash, freeze_json
      FROM rd_developer_contract_freeze
      WHERE idempotency_key = $idempotency_key
    `).get({ $idempotency_key: request.idempotency_key }) as FreezeReplayRow | null
    if (replay) {
      if (replay.freeze_request_hash !== requestHash) {
        throw new Error("Contract Freeze idempotency key already exists with different content")
      }
      return parseFreezeRecord(replay.freeze_json)
    }

    const row = db.query(`
      SELECT v.validation_json, d.submission_json, b.brief_json,
             proposal.planner_run_id, proposal_header.created_at AS proposal_created_at,
             (SELECT MAX(latest.draft_revision)
              FROM rd_developer_contract_draft latest
              WHERE latest.brief_id = d.brief_id) AS latest_draft_revision,
             (SELECT MAX(latest_proposal.proposal_revision)
              FROM rd_planner_proposal_revision latest_proposal
              WHERE latest_proposal.proposal_id = b.proposal_id) AS latest_proposal_revision
      FROM rd_developer_contract_draft_validation v
      JOIN rd_developer_contract_draft d
        ON d.brief_id = v.brief_id AND d.draft_revision = v.draft_revision
      JOIN rd_developer_development_brief b ON b.brief_id = d.brief_id
      JOIN rd_planner_proposal_revision proposal
        ON proposal.proposal_id = b.proposal_id AND proposal.proposal_revision = b.proposal_revision
      JOIN rd_planner_proposal proposal_header ON proposal_header.proposal_id = b.proposal_id
      WHERE v.validation_id = $validation_id
    `).get({ $validation_id: request.validation_id }) as FreezeSourceRow | null
    if (!row) throw new Error("Contract Freeze requires a persisted Draft Validation Record")
    const validation = parseValidationRecord(row.validation_json)
    const brief = parseBrief(row.brief_json)
    const submission = parseSubmission(row.submission_json)
    if (validation.validation_hash !== request.validation_hash) {
      throw new Error("Contract Freeze validation_hash does not match the authoritative Validation Record")
    }
    if (validation.status !== "valid" || validation.errors.length !== 0) {
      throw new Error("only a valid Draft Validation Record may be frozen")
    }
    if (validation.contract_validator_version !== RESEARCH_CONTRACT_VALIDATOR_VERSION) {
      throw new Error("Contract Freeze requires the current Contract validator version")
    }
    if (row.latest_draft_revision !== validation.draft_revision
        || row.latest_proposal_revision !== validation.proposal_revision) {
      throw new Error("Contract Freeze requires the current Proposal and latest Draft revision")
    }
    if (Date.parse(request.frozen_at) < Date.parse(validation.validated_at)) {
      throw new Error("Contract Freeze cannot predate Draft validation")
    }
    assertSourceBindings(validation, brief, submission)
    const reconciliation = reconcileDeveloperContractDraft(brief, submission, row.latest_proposal_revision)
    if (reconciliation.errors.length !== 0
        || reconciliation.contract_candidate_hash !== validation.contract_candidate_hash
        || reconciliation.candidate_space_hash !== validation.candidate_space_hash
        || reconciliation.candidate_assignment_set_hash !== validation.candidate_assignment_set_hash) {
      throw new Error(`Contract Freeze revalidation failed: ${reconciliation.errors.join("; ") || "identity drift"}`)
    }

    const contract = requireRecord(submission.draft_json.contract, "Draft contract")
    const contractValidation = validateResearchProposal("experiment", contract)
    if (!contractValidation.valid) {
      throw new Error(`Contract Freeze candidate is invalid: ${contractValidation.errors.join("; ")}`)
    }
    const versions = requireRecord(contract.contract_versions, "Contract versions")
    if (versions.identity_hash_policy !== IDENTITY_HASH_POLICY_VERSION
        || versions.validator !== RESEARCH_CONTRACT_VALIDATOR_VERSION
        || versions.lifecycle_rule !== RESEARCH_LIFECYCLE_RULE_VERSION
        || typeof versions.scope_policy !== "string" || !versions.scope_policy.trim()) {
      throw new Error("Contract Freeze version bindings are unsupported")
    }
    const contractGroup = requireRecord(contract.trial_group_ref, "Contract Trial Group")
    const trialGroupId = requiredString(contractGroup.trial_group_id, "trial_group_ref.trial_group_id")
    const assignments = normalizeDeveloperContractCandidateAssignments(submission.draft_json.candidate_assignments)
    if (assignments.errors.length !== 0) {
      throw new Error(`Contract Freeze candidate assignments are invalid: ${assignments.errors.join("; ")}`)
    }
    const candidateSpace = requireRecord(submission.draft_json.candidate_space, "Draft candidate_space")
    const trialGroup = compileDeveloperContractFreezeTrialGroup({
      trial_group_id: trialGroupId,
      hypothesis_id: brief.hypothesis_id,
      candidate_space: candidateSpace,
      candidate_assignments: assignments.normalized,
      max_trials: submission.requested_trial_budget,
      compiled_at: request.frozen_at,
    })
    if (contractGroup.group_hash !== trialGroup.group_hash) {
      throw new Error("Contract Freeze Trial Group hash no longer matches the compiled identity")
    }
    const contractHash = hashIdentityPayload(contract)
    if (contractHash !== validation.contract_candidate_hash) {
      throw new Error("Contract Freeze contract hash does not match validated candidate identity")
    }

    rejectPreexistingFormalFacts(db, request, brief, trialGroupId)
    const candidateIdentities = trialGroup.candidates.map((candidate) => ({
      candidate_id: candidate.candidate_id,
      candidate_identity_hash: candidate.candidate_identity_hash,
      candidate_ordinal: candidate.candidate_ordinal,
    }))
    const record = createDeveloperContractFreezeRecord({
      schema_version: DEVELOPER_CONTRACT_FREEZE_RECORD_SCHEMA_VERSION,
      freeze_id: request.freeze_id,
      validation_id: validation.validation_id,
      validation_hash: validation.validation_hash,
      brief_id: brief.brief_id,
      brief_hash: brief.brief_hash,
      proposal_id: brief.proposal_id,
      proposal_revision: brief.proposal_revision,
      proposal_hash: brief.proposal_hash,
      draft_revision: submission.draft_revision,
      submission_hash: submission.submission_hash,
      contract_draft_hash: submission.contract_draft_hash,
      candidate_assignment_set_hash: validation.candidate_assignment_set_hash,
      experiment_id: request.experiment_id,
      contract_hash: contractHash,
      trial_group_id: trialGroup.trial_group_id,
      trial_group_hash: trialGroup.group_hash,
      candidates: candidateIdentities,
      identity_hash_policy_version: IDENTITY_HASH_POLICY_VERSION,
      contract_validator_version: RESEARCH_CONTRACT_VALIDATOR_VERSION,
      lifecycle_rule_version: RESEARCH_LIFECYCLE_RULE_VERSION,
      scope_policy_version: versions.scope_policy,
      freeze_compiler_version: DEVELOPER_CONTRACT_FREEZE_COMPILER_VERSION,
      compatibility_projection_version: DEVELOPER_CONTRACT_FREEZE_COMPATIBILITY_PROJECTION_VERSION,
      bootstrap_lifecycle_event_id: request.bootstrap_lifecycle_event_id,
      frozen_at: request.frozen_at,
    })

    writeCompatibilityProposalProjection(db, {
      brief,
      contract,
      contractHash,
      plannerRunId: row.planner_run_id,
      proposalCreatedAt: row.proposal_created_at,
      frozenAt: request.frozen_at,
      validation,
    })
    registerTrialGroup(db, trialGroup)
    registerExperiment(db, {
      experiment_id: request.experiment_id,
      proposal_id: brief.proposal_id,
      proposal_revision: brief.proposal_revision,
      canonical_node_id: brief.universe_node_id,
      hypothesis_id: brief.hypothesis_id,
      code_family_id: requiredString(contract.code_family_id, "contract.code_family_id"),
      trial_group_id: trialGroup.trial_group_id,
      trial_group_hash: trialGroup.group_hash,
      parent_experiment_id: typeof contract.parent_experiment_id === "string" ? contract.parent_experiment_id : undefined,
      contract_hash: contractHash,
      identity_hash_policy_version: IDENTITY_HASH_POLICY_VERSION,
      contract_validator_version: RESEARCH_CONTRACT_VALIDATOR_VERSION,
      lifecycle_rule_version: RESEARCH_LIFECYCLE_RULE_VERSION,
      scope_policy_version: versions.scope_policy,
      contract_json: contract,
      bootstrap_event_id: request.bootstrap_lifecycle_event_id,
      bootstrap_idempotency_key: request.bootstrap_lifecycle_idempotency_key,
      registered_at: request.frozen_at,
    })
    db.query(`
      INSERT INTO rd_developer_contract_freeze(
        freeze_id, validation_id, idempotency_key, freeze_request_hash,
        validation_hash, experiment_id, contract_hash, trial_group_id,
        trial_group_hash, candidate_identity_set_hash, freeze_compiler_version,
        compatibility_projection_version, freeze_hash, freeze_json, frozen_at
      ) VALUES (
        $freeze_id, $validation_id, $idempotency_key, $freeze_request_hash,
        $validation_hash, $experiment_id, $contract_hash, $trial_group_id,
        $trial_group_hash, $candidate_identity_set_hash, $freeze_compiler_version,
        $compatibility_projection_version, $freeze_hash, $freeze_json, $frozen_at
      )
    `).run({
      $freeze_id: record.freeze_id,
      $validation_id: record.validation_id,
      $idempotency_key: request.idempotency_key,
      $freeze_request_hash: requestHash,
      $validation_hash: record.validation_hash,
      $experiment_id: record.experiment_id,
      $contract_hash: record.contract_hash,
      $trial_group_id: record.trial_group_id,
      $trial_group_hash: record.trial_group_hash,
      $candidate_identity_set_hash: record.candidate_identity_set_hash,
      $freeze_compiler_version: record.freeze_compiler_version,
      $compatibility_projection_version: record.compatibility_projection_version,
      $freeze_hash: record.freeze_hash,
      $freeze_json: JSON.stringify(record),
      $frozen_at: record.frozen_at,
    })
    return record
  })
  return freeze.immediate()
}

export function readDeveloperContractFreeze(db: Database, freezeId: string): DeveloperContractFreezeRecord {
  if (!freezeId.trim()) throw new Error("freeze_id is required")
  const row = db.query(`
    SELECT freeze_json FROM rd_developer_contract_freeze WHERE freeze_id = $freeze_id
  `).get({ $freeze_id: freezeId }) as { freeze_json: string } | null
  if (!row) throw new Error("Developer Contract Freeze Record is missing")
  return parseFreezeRecord(row.freeze_json)
}

function assertSourceBindings(
  validation: DeveloperContractDraftValidationRecord,
  brief: DeveloperDevelopmentBrief,
  submission: DeveloperContractDraftSubmission,
): void {
  if (validation.brief_id !== brief.brief_id || validation.brief_hash !== brief.brief_hash
      || validation.proposal_id !== brief.proposal_id || validation.proposal_revision !== brief.proposal_revision
      || validation.proposal_hash !== brief.proposal_hash || validation.draft_revision !== submission.draft_revision
      || validation.submission_hash !== submission.submission_hash
      || validation.contract_draft_hash !== submission.contract_draft_hash) {
    throw new Error("Contract Freeze source bindings drifted from the Validation Record")
  }
}

function rejectPreexistingFormalFacts(
  db: Database,
  request: DeveloperContractFreezeRequest,
  brief: DeveloperDevelopmentBrief,
  trialGroupId: string,
): void {
  const naturalFreeze = db.query(`
    SELECT freeze_id FROM rd_developer_contract_freeze WHERE validation_id = $validation_id
  `).get({ $validation_id: request.validation_id })
  if (naturalFreeze) throw new Error("Draft Validation Record is already frozen by another request")
  const freezeId = db.query("SELECT freeze_id FROM rd_developer_contract_freeze WHERE freeze_id=$id")
    .get({ $id: request.freeze_id })
  if (freezeId) throw new Error("freeze_id already exists")
  const experiment = db.query("SELECT experiment_id FROM rd_experiment_contract WHERE experiment_id=$id")
    .get({ $id: request.experiment_id })
  if (experiment) throw new Error("Contract Freeze will not adopt a pre-existing Experiment")
  const group = db.query("SELECT trial_group_id FROM rd_trial_group WHERE trial_group_id=$id")
    .get({ $id: trialGroupId })
  if (group) throw new Error("Contract Freeze will not adopt a pre-existing Trial Group")
  const projection = db.query("SELECT proposal_id FROM rd_proposal WHERE proposal_id=$id")
    .get({ $id: brief.proposal_id })
  if (projection) throw new Error("Contract Freeze compatibility Proposal projection already exists")
}

function writeCompatibilityProposalProjection(db: Database, input: {
  brief: DeveloperDevelopmentBrief
  contract: JSONRecord
  contractHash: string
  plannerRunId: string
  proposalCreatedAt: string
  frozenAt: string
  validation: DeveloperContractDraftValidationRecord
}): void {
  db.query(`
    INSERT INTO rd_proposal(proposal_id, planner_run_id, proposal_kind, created_at)
    VALUES ($proposal_id, $planner_run_id, 'experiment', $created_at)
  `).run({
    $proposal_id: input.brief.proposal_id,
    $planner_run_id: input.plannerRunId,
    $created_at: input.proposalCreatedAt,
  })
  db.query(`
    INSERT INTO rd_proposal_revision(
      proposal_id, revision, proposal_hash, identity_hash_policy_version,
      proposal_json, validation_status, validation_ref, created_at
    ) VALUES (
      $proposal_id, $revision, $proposal_hash, $identity_hash_policy_version,
      $proposal_json, 'valid', $validation_ref, $created_at
    )
  `).run({
    $proposal_id: input.brief.proposal_id,
    $revision: input.brief.proposal_revision,
    $proposal_hash: input.contractHash,
    $identity_hash_policy_version: IDENTITY_HASH_POLICY_VERSION,
    $proposal_json: JSON.stringify(input.contract),
    $validation_ref: `developer-contract-validation://${input.validation.validation_id}/${input.validation.validation_hash}/${RESEARCH_CONTRACT_VALIDATOR_VERSION}`,
    $created_at: input.frozenAt,
  })
}

function parseValidationRecord(value: string): DeveloperContractDraftValidationRecord {
  const record = JSON.parse(value) as DeveloperContractDraftValidationRecord
  assertDeveloperContractDraftValidationRecord(record)
  return record
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

function parseFreezeRecord(value: string): DeveloperContractFreezeRecord {
  const record = JSON.parse(value) as DeveloperContractFreezeRecord
  assertDeveloperContractFreezeRecord(record)
  return record
}

function requireRecord(value: unknown, field: string): JSONRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object`)
  return value as JSONRecord
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`)
  return value.trim()
}

interface FreezeReplayRow { freeze_request_hash: string; freeze_json: string }
interface FreezeSourceRow {
  validation_json: string
  submission_json: string
  brief_json: string
  planner_run_id: string
  proposal_created_at: string
  latest_draft_revision: number
  latest_proposal_revision: number
}
