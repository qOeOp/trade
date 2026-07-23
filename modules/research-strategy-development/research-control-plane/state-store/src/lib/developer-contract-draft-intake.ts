import { Database } from "bun:sqlite"
import { readFamilyEvaluationProtocol } from "../../../../../contracts/rd-agent-capability-contract/src/rd-agent-capability-contract"
import { canonicalControlPlaneHash } from "../../../contracts/src/lib/control-plane-contracts"
import {
  DEVELOPER_CONTRACT_DRAFT_INTAKE_POLICY_VERSION,
  DEVELOPER_CONTRACT_DRAFT_RECEIPT_SCHEMA_VERSION,
  DEVELOPER_DEVELOPMENT_BRIEF_SCHEMA_VERSION,
  TARGET_EXPERIMENT_CONTRACT_SCHEMA_VERSION,
  assertDeveloperContractDraftIntakeRequest,
  assertDeveloperAgentDraftProvenance,
  assertDeveloperContractDraftReceipt,
  assertDeveloperDevelopmentBrief,
  assertDeveloperDevelopmentBriefIssueRequest,
  createDeveloperContractDraftReceipt,
  createDeveloperDevelopmentBrief,
  type DeveloperContractDraftIntakeRequest,
  type DeveloperContractDraftReceipt,
  type DeveloperDevelopmentBrief,
  type DeveloperDevelopmentBriefIssueRequest,
} from "../../../contracts/src/lib/developer-contract-draft"
import {
  assertPlannerProposalAdmission,
  assertPlannerProposalSubmission,
  type PlannerProposalAdmission,
  type PlannerProposalSubmission,
} from "../../../contracts/src/lib/planner-proposal-submission"

export function issueDeveloperDevelopmentBrief(
  db: Database,
  request: DeveloperDevelopmentBriefIssueRequest,
): DeveloperDevelopmentBrief {
  assertDeveloperDevelopmentBriefIssueRequest(request)
  const issue = db.transaction(() => {
    const requestHash = canonicalControlPlaneHash(request)
    const replay = db.query(`
      SELECT issue_request_hash, brief_json
      FROM rd_developer_development_brief
      WHERE idempotency_key = $idempotency_key
    `).get({ $idempotency_key: request.idempotency_key }) as BriefReplayRow | null
    if (replay) {
      if (replay.issue_request_hash !== requestHash) {
        throw new Error("Developer Development Brief idempotency key already exists with different content")
      }
      return parseBrief(replay.brief_json)
    }

    const proposalRow = db.query(`
      SELECT r.proposal_hash, r.submission_json, r.admission_json,
             (SELECT MAX(latest.proposal_revision)
              FROM rd_planner_proposal_revision latest
              WHERE latest.proposal_id = r.proposal_id) AS latest_revision
      FROM rd_planner_proposal_revision r
      WHERE r.proposal_id = $proposal_id AND r.proposal_revision = $proposal_revision
    `).get({
      $proposal_id: request.proposal_id,
      $proposal_revision: request.proposal_revision,
    }) as ProposalRevisionRow | null
    if (!proposalRow) throw new Error("Developer Development Brief requires an admitted Planner Proposal revision")
    if (proposalRow.latest_revision !== request.proposal_revision) {
      throw new Error("Developer Development Brief may be issued only for the latest Proposal revision")
    }
    const proposal = parseProposal(proposalRow.submission_json)
    const admission = parseProposalAdmission(proposalRow.admission_json)
    const protocol = readFamilyEvaluationProtocol(proposal.universe_node_id)
    if (!protocol
        || protocol.protocol_ref !== proposal.evaluation_protocol_ref
        || proposal.trial_budget > protocol.discovery_policy.max_candidates) {
      throw new Error("Developer Development Brief requires a capability-valid Planner Proposal")
    }
    if (proposal.proposal_hash !== proposalRow.proposal_hash
        || admission.proposal_hash !== proposal.proposal_hash
        || admission.proposal_revision !== request.proposal_revision) {
      throw new Error("Planner Proposal admission binding is inconsistent")
    }
    if (Date.parse(request.issued_at) < Date.parse(admission.recorded_at)) {
      throw new Error("Developer Development Brief cannot predate Proposal admission")
    }

    const brief = createDeveloperDevelopmentBrief({
      schema_version: DEVELOPER_DEVELOPMENT_BRIEF_SCHEMA_VERSION,
      brief_id: request.brief_id,
      proposal_id: proposal.proposal_id,
      proposal_revision: request.proposal_revision,
      proposal_hash: proposal.proposal_hash,
      proposal_admission_hash: admission.admission_hash,
      hypothesis_id: proposal.hypothesis_id,
      universe_node_id: proposal.universe_node_id,
      objective: proposal.objective,
      dataset_requirements: proposal.dataset_requirements,
      candidate_space: proposal.candidate_space,
      max_trial_budget: proposal.trial_budget,
      evaluation_protocol_ref: proposal.evaluation_protocol_ref,
      target_contract_schema_version: TARGET_EXPERIMENT_CONTRACT_SCHEMA_VERSION,
      authority_scope: "contract_draft_only",
      issued_at: request.issued_at,
    })

    const naturalReplay = db.query(`
      SELECT brief_json
      FROM rd_developer_development_brief
      WHERE proposal_id = $proposal_id AND proposal_revision = $proposal_revision
    `).get({
      $proposal_id: request.proposal_id,
      $proposal_revision: request.proposal_revision,
    }) as { brief_json: string } | null
    if (naturalReplay) {
      const existing = parseBrief(naturalReplay.brief_json)
      if (existing.brief_hash === brief.brief_hash) return existing
      throw new Error("Proposal revision already has a different Developer Development Brief")
    }
    const idReplay = db.query(`
      SELECT brief_json FROM rd_developer_development_brief WHERE brief_id = $brief_id
    `).get({ $brief_id: request.brief_id }) as { brief_json: string } | null
    if (idReplay) {
      const existing = parseBrief(idReplay.brief_json)
      if (existing.brief_hash === brief.brief_hash) return existing
      throw new Error("brief_id already exists with different content")
    }

    db.query(`
      INSERT INTO rd_developer_development_brief(
        brief_id, proposal_id, proposal_revision, proposal_hash,
        proposal_admission_hash, idempotency_key, issue_request_hash,
        brief_hash, brief_json, issued_at
      ) VALUES (
        $brief_id, $proposal_id, $proposal_revision, $proposal_hash,
        $proposal_admission_hash, $idempotency_key, $issue_request_hash,
        $brief_hash, $brief_json, $issued_at
      )
    `).run({
      $brief_id: brief.brief_id,
      $proposal_id: brief.proposal_id,
      $proposal_revision: brief.proposal_revision,
      $proposal_hash: brief.proposal_hash,
      $proposal_admission_hash: brief.proposal_admission_hash,
      $idempotency_key: request.idempotency_key,
      $issue_request_hash: requestHash,
      $brief_hash: brief.brief_hash,
      $brief_json: JSON.stringify(brief),
      $issued_at: brief.issued_at,
    })
    return brief
  })
  return issue.immediate()
}

export function receiveDeveloperContractDraft(
  db: Database,
  request: DeveloperContractDraftIntakeRequest,
): DeveloperContractDraftReceipt {
  assertDeveloperContractDraftIntakeRequest(request)
  const receive = db.transaction(() => {
    const requestHash = canonicalControlPlaneHash(request)
    const replay = db.query(`
      SELECT intake_request_hash, receipt_json
      FROM rd_developer_contract_draft
      WHERE idempotency_key = $idempotency_key
    `).get({ $idempotency_key: request.idempotency_key }) as DraftReplayRow | null
    if (replay) {
      if (replay.intake_request_hash !== requestHash) {
        throw new Error("Developer Contract Draft idempotency key already exists with different content")
      }
      return parseReceipt(replay.receipt_json)
    }

    const submission = request.submission
    const briefRow = db.query(`
      SELECT brief_json,
             (SELECT MAX(latest.proposal_revision)
              FROM rd_planner_proposal_revision latest
              WHERE latest.proposal_id = b.proposal_id) AS latest_proposal_revision
      FROM rd_developer_development_brief b
      WHERE b.brief_id = $brief_id
    `).get({ $brief_id: submission.brief_id }) as BriefForDraftRow | null
    if (!briefRow) throw new Error("Developer Contract Draft requires a registered Development Brief")
    const brief = parseBrief(briefRow.brief_json)
    if (briefRow.latest_proposal_revision !== brief.proposal_revision) {
      throw new Error("Developer Development Brief is stale after a newer Proposal revision")
    }
    validateDraftBinding(submission, brief)
    if (Date.parse(submission.created_at) < Date.parse(brief.issued_at)) {
      throw new Error("Developer Contract Draft cannot predate its Development Brief")
    }

    const naturalReplay = db.query(`
      SELECT draft.developer_run_id, draft.submission_hash, draft.receipt_json,
             provenance.provenance_hash
      FROM rd_developer_contract_draft AS draft
      LEFT JOIN rd_developer_agent_draft_provenance AS provenance
        ON provenance.brief_id=draft.brief_id
        AND provenance.draft_revision=draft.draft_revision
      WHERE draft.brief_id = $brief_id
        AND draft.draft_revision = $draft_revision
    `).get({
      $brief_id: submission.brief_id,
      $draft_revision: submission.draft_revision,
    }) as NaturalDraftReplayRow | null
    if (naturalReplay) {
      if (naturalReplay.developer_run_id === submission.developer_run_id
          && naturalReplay.submission_hash === submission.submission_hash
          && naturalReplay.provenance_hash
            === (request.agent_provenance?.provenance_hash ?? null)) {
        return parseReceipt(naturalReplay.receipt_json)
      }
      throw new Error("Developer Contract Draft revision already exists with different content or provenance")
    }
    const latest = db.query(`
      SELECT COALESCE(MAX(draft_revision), 0) AS latest_revision
      FROM rd_developer_contract_draft
      WHERE brief_id = $brief_id
    `).get({ $brief_id: submission.brief_id }) as { latest_revision: number }
    if (submission.draft_revision !== latest.latest_revision + 1) {
      throw new Error(`Developer Contract Draft revision must be ${latest.latest_revision + 1}`)
    }

    const receipt = createDeveloperContractDraftReceipt({
      schema_version: DEVELOPER_CONTRACT_DRAFT_RECEIPT_SCHEMA_VERSION,
      brief_id: submission.brief_id,
      brief_hash: submission.brief_hash,
      proposal_id: submission.proposal_id,
      proposal_revision: submission.proposal_revision,
      proposal_hash: submission.proposal_hash,
      developer_run_id: submission.developer_run_id,
      draft_revision: submission.draft_revision,
      submission_hash: submission.submission_hash,
      contract_draft_hash: submission.contract_draft_hash,
      intake_policy_version: DEVELOPER_CONTRACT_DRAFT_INTAKE_POLICY_VERSION,
      status: "received_unvalidated",
      recorded_at: request.recorded_at,
    })
    db.query(`
      INSERT INTO rd_developer_contract_draft(
        brief_id, draft_revision, developer_run_id, idempotency_key,
        intake_request_hash, submission_hash, contract_draft_hash,
        submission_json, intake_policy_version, receipt_hash, receipt_json,
        created_at, recorded_at
      ) VALUES (
        $brief_id, $draft_revision, $developer_run_id, $idempotency_key,
        $intake_request_hash, $submission_hash, $contract_draft_hash,
        $submission_json, $intake_policy_version, $receipt_hash, $receipt_json,
        $created_at, $recorded_at
      )
    `).run({
      $brief_id: submission.brief_id,
      $draft_revision: submission.draft_revision,
      $developer_run_id: submission.developer_run_id,
      $idempotency_key: request.idempotency_key,
      $intake_request_hash: requestHash,
      $submission_hash: submission.submission_hash,
      $contract_draft_hash: submission.contract_draft_hash,
      $submission_json: JSON.stringify(submission),
      $intake_policy_version: DEVELOPER_CONTRACT_DRAFT_INTAKE_POLICY_VERSION,
      $receipt_hash: receipt.receipt_hash,
      $receipt_json: JSON.stringify(receipt),
      $created_at: submission.created_at,
      $recorded_at: request.recorded_at,
    })
    if (request.agent_provenance) {
      const provenance = assertDeveloperAgentDraftProvenance(
        request.agent_provenance,
      )
      if (provenance.developer_run_id !== submission.developer_run_id
          || provenance.contract_draft_submission_hash
            !== submission.submission_hash
          || provenance.recorded_at !== request.recorded_at) {
        throw new Error(
          "Developer Agent Draft provenance drifted from intake",
        )
      }
      db.query(`
        INSERT INTO rd_developer_agent_draft_provenance(
          brief_id, draft_revision, developer_run_id, source_revision,
          agent_run_request_hash, agent_run_result_hash, agent_submission_hash,
          contract_draft_submission_hash, provenance_hash, provenance_json,
          recorded_at
        ) VALUES (
          $brief_id, $draft_revision, $developer_run_id, $source_revision,
          $agent_run_request_hash, $agent_run_result_hash, $agent_submission_hash,
          $contract_draft_submission_hash, $provenance_hash, $provenance_json,
          $recorded_at
        )
      `).run({
        $brief_id: submission.brief_id,
        $draft_revision: submission.draft_revision,
        $developer_run_id: provenance.developer_run_id,
        $source_revision: provenance.source_revision,
        $agent_run_request_hash: provenance.agent_run_request_hash,
        $agent_run_result_hash: provenance.agent_run_result_hash,
        $agent_submission_hash: provenance.agent_submission_hash,
        $contract_draft_submission_hash:
          provenance.contract_draft_submission_hash,
        $provenance_hash: provenance.provenance_hash,
        $provenance_json: JSON.stringify(provenance),
        $recorded_at: provenance.recorded_at,
      })
    }
    return receipt
  })
  return receive.immediate()
}

export function readDeveloperDevelopmentBrief(db: Database, briefId: string): DeveloperDevelopmentBrief {
  if (!briefId.trim()) throw new Error("brief_id is required")
  const row = db.query(`
    SELECT brief_json FROM rd_developer_development_brief WHERE brief_id = $brief_id
  `).get({ $brief_id: briefId }) as { brief_json: string } | null
  if (!row) throw new Error("Developer Development Brief is missing")
  return parseBrief(row.brief_json)
}

export function readDeveloperContractDraftReceipt(
  db: Database,
  briefId: string,
  draftRevision: number,
): DeveloperContractDraftReceipt {
  if (!briefId.trim() || !Number.isSafeInteger(draftRevision) || draftRevision < 1) {
    throw new Error("brief_id and positive draft_revision are required")
  }
  const row = db.query(`
    SELECT receipt_json FROM rd_developer_contract_draft
    WHERE brief_id = $brief_id AND draft_revision = $draft_revision
  `).get({ $brief_id: briefId, $draft_revision: draftRevision }) as { receipt_json: string } | null
  if (!row) throw new Error("Developer Contract Draft receipt is missing")
  return parseReceipt(row.receipt_json)
}

function validateDraftBinding(
  submission: DeveloperContractDraftIntakeRequest["submission"],
  brief: DeveloperDevelopmentBrief,
): void {
  if (submission.brief_hash !== brief.brief_hash
      || submission.proposal_id !== brief.proposal_id
      || submission.proposal_revision !== brief.proposal_revision
      || submission.proposal_hash !== brief.proposal_hash) {
    throw new Error("Developer Contract Draft does not match the registered Brief/Proposal binding")
  }
  if (submission.allowed_candidate_space_hash !== brief.allowed_candidate_space_hash) {
    throw new Error("Developer Contract Draft must declare the exact Brief candidate-space hash")
  }
  if (submission.requested_trial_budget > brief.max_trial_budget) {
    throw new Error("Developer Contract Draft cannot exceed the Brief trial budget")
  }
  if (submission.draft_json.canonical_node_id !== brief.universe_node_id) {
    throw new Error("Developer Contract Draft canonical must match the Brief")
  }
  const requiredData = Array.isArray(submission.draft_json.required_data)
    ? submission.draft_json.required_data.map(String).sort()
    : []
  if (JSON.stringify(requiredData) !== JSON.stringify(brief.dataset_requirements)) {
    throw new Error("Developer Contract Draft required_data must exactly match the Brief")
  }
}

function parseBrief(value: string): DeveloperDevelopmentBrief {
  const brief = JSON.parse(value) as DeveloperDevelopmentBrief
  assertDeveloperDevelopmentBrief(brief)
  return brief
}

function parseProposal(value: string): PlannerProposalSubmission {
  const proposal = JSON.parse(value) as PlannerProposalSubmission
  assertPlannerProposalSubmission(proposal)
  return proposal
}

function parseProposalAdmission(value: string): PlannerProposalAdmission {
  const admission = JSON.parse(value) as PlannerProposalAdmission
  assertPlannerProposalAdmission(admission)
  return admission
}

function parseReceipt(value: string): DeveloperContractDraftReceipt {
  const receipt = JSON.parse(value) as DeveloperContractDraftReceipt
  assertDeveloperContractDraftReceipt(receipt)
  return receipt
}

interface BriefReplayRow { issue_request_hash: string; brief_json: string }
interface DraftReplayRow { intake_request_hash: string; receipt_json: string }
interface ProposalRevisionRow {
  proposal_hash: string
  submission_json: string
  admission_json: string
  latest_revision: number
}
interface BriefForDraftRow { brief_json: string; latest_proposal_revision: number }
interface NaturalDraftReplayRow {
  developer_run_id: string
  submission_hash: string
  receipt_json: string
  provenance_hash: string | null
}
