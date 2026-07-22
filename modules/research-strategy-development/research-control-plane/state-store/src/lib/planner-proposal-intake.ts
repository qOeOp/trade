import { Database } from "bun:sqlite"
import { canonicalControlPlaneHash } from "../../../contracts/src/lib/control-plane-contracts"
import {
  PLANNER_PROPOSAL_ADMISSION_SCHEMA_VERSION,
  PLANNER_PROPOSAL_INTAKE_POLICY_VERSION,
  assertPlannerProposalAdmission,
  assertPlannerProposalIntakeRequest,
  createPlannerProposalAdmission,
  type PlannerProposalAdmission,
  type PlannerProposalIntakeRequest,
} from "../../../contracts/src/lib/planner-proposal-submission"
import { readPlannerControlPlaneContext } from "./research-control-plane-operations"

export function admitPlannerProposal(
  db: Database,
  request: PlannerProposalIntakeRequest,
): PlannerProposalAdmission {
  assertPlannerProposalIntakeRequest(request)
  const issue = db.transaction(() => {
    const replay = db.query(`
      SELECT intake_request_hash, admission_json
      FROM rd_planner_proposal_revision
      WHERE idempotency_key = $idempotency_key
    `).get({ $idempotency_key: request.idempotency_key }) as IntakeReplayRow | null
    const intakeRequestHash = canonicalControlPlaneHash(request)
    if (replay) {
      if (replay.intake_request_hash !== intakeRequestHash) {
        throw new Error("Planner Proposal intake idempotency key already exists with different content")
      }
      return parseAdmission(replay.admission_json)
    }

    const currentContext = readPlannerControlPlaneContext(db)
    validateCurrentGovernance(request, currentContext)

    const proposal = request.proposal
    const naturalReplay = db.query(`
      SELECT planner_run_id, proposal_hash, control_plane_context_hash, admission_json
      FROM rd_planner_proposal_revision
      WHERE proposal_id = $proposal_id AND proposal_revision = $proposal_revision
    `).get({
      $proposal_id: proposal.proposal_id,
      $proposal_revision: request.proposal_revision,
    }) as NaturalReplayRow | null
    if (naturalReplay) {
      if (naturalReplay.planner_run_id === request.planner_run_id
          && naturalReplay.proposal_hash === proposal.proposal_hash
          && naturalReplay.control_plane_context_hash === proposal.control_plane_context_hash) {
        return parseAdmission(naturalReplay.admission_json)
      }
      throw new Error("Planner Proposal revision already exists with different content or provenance")
    }

    const header = db.query(`
      SELECT hypothesis_id, canonical_node_id
      FROM rd_planner_proposal
      WHERE proposal_id = $proposal_id
    `).get({ $proposal_id: proposal.proposal_id }) as PlannerProposalHeaderRow | null
    if (!header) {
      db.query(`
        INSERT INTO rd_planner_proposal(proposal_id, hypothesis_id, canonical_node_id, created_at)
        VALUES ($proposal_id, $hypothesis_id, $canonical_node_id, $created_at)
      `).run({
        $proposal_id: proposal.proposal_id,
        $hypothesis_id: proposal.hypothesis_id,
        $canonical_node_id: proposal.universe_node_id,
        $created_at: proposal.created_at,
      })
    } else if (header.hypothesis_id !== proposal.hypothesis_id
        || header.canonical_node_id !== proposal.universe_node_id) {
      throw new Error("Planner Proposal identity cannot change hypothesis or canonical across revisions")
    }

    const latest = db.query(`
      SELECT COALESCE(MAX(proposal_revision), 0) AS latest_revision
      FROM rd_planner_proposal_revision
      WHERE proposal_id = $proposal_id
    `).get({ $proposal_id: proposal.proposal_id }) as { latest_revision: number }
    if (request.proposal_revision !== latest.latest_revision + 1) {
      throw new Error(`Planner Proposal revision must be ${latest.latest_revision + 1}`)
    }

    const admission = createPlannerProposalAdmission({
      schema_version: PLANNER_PROPOSAL_ADMISSION_SCHEMA_VERSION,
      proposal_id: proposal.proposal_id,
      proposal_revision: request.proposal_revision,
      proposal_hash: proposal.proposal_hash,
      planner_run_id: request.planner_run_id,
      hypothesis_id: proposal.hypothesis_id,
      universe_node_id: proposal.universe_node_id,
      control_plane_context_hash: proposal.control_plane_context_hash,
      intake_policy_version: PLANNER_PROPOSAL_INTAKE_POLICY_VERSION,
      status: "accepted",
      recorded_at: request.recorded_at,
    })
    db.query(`
      INSERT INTO rd_planner_proposal_revision(
        proposal_id, proposal_revision, planner_run_id, proposal_hash,
        control_plane_context_hash, idempotency_key, intake_request_hash,
        submission_json, intake_policy_version, admission_hash, admission_json,
        submitted_at, recorded_at
      ) VALUES (
        $proposal_id, $proposal_revision, $planner_run_id, $proposal_hash,
        $control_plane_context_hash, $idempotency_key, $intake_request_hash,
        $submission_json, $intake_policy_version, $admission_hash, $admission_json,
        $submitted_at, $recorded_at
      )
    `).run({
      $proposal_id: proposal.proposal_id,
      $proposal_revision: request.proposal_revision,
      $planner_run_id: request.planner_run_id,
      $proposal_hash: proposal.proposal_hash,
      $control_plane_context_hash: proposal.control_plane_context_hash,
      $idempotency_key: request.idempotency_key,
      $intake_request_hash: intakeRequestHash,
      $submission_json: JSON.stringify(proposal),
      $intake_policy_version: PLANNER_PROPOSAL_INTAKE_POLICY_VERSION,
      $admission_hash: admission.admission_hash,
      $admission_json: JSON.stringify(admission),
      $submitted_at: request.submitted_at,
      $recorded_at: request.recorded_at,
    })
    return admission
  })
  return issue.immediate()
}

export function readPlannerProposalAdmission(
  db: Database,
  proposalId: string,
  proposalRevision: number,
): PlannerProposalAdmission {
  if (!proposalId.trim() || !Number.isSafeInteger(proposalRevision) || proposalRevision < 1) {
    throw new Error("proposal_id and positive proposal_revision are required")
  }
  const row = db.query(`
    SELECT admission_json
    FROM rd_planner_proposal_revision
    WHERE proposal_id = $proposal_id AND proposal_revision = $proposal_revision
  `).get({ $proposal_id: proposalId, $proposal_revision: proposalRevision }) as { admission_json: string } | null
  if (!row) throw new Error("Planner Proposal admission is missing")
  return parseAdmission(row.admission_json)
}

function validateCurrentGovernance(
  request: PlannerProposalIntakeRequest,
  context: ReturnType<typeof readPlannerControlPlaneContext>,
): void {
  const proposal = request.proposal
  if (proposal.control_plane_context_hash !== context.context_hash) {
    throw new Error("Planner Proposal context is stale; rebuild against the current Control Plane context")
  }
  const canonical = context.active_canonicals.find((item) => item.node_id === proposal.universe_node_id)
  if (!canonical) throw new Error("Planner Proposal canonical is not currently active")
  for (const slug of proposal.dataset_requirements) {
    const surface = context.data_surfaces.find((item) => item.slug === slug)
    if (!surface || surface.coverage_status !== "ready") {
      throw new Error(`Planner Proposal data surface is not currently ready: ${slug}`)
    }
    const requirement = canonical.data_surface_requirements.find((item) => item.surface_id === surface.surface_id)
    if (!requirement || requirement.coverage_status !== "ready") {
      throw new Error(`Planner Proposal data surface is not ready for the selected canonical: ${slug}`)
    }
  }
}

function parseAdmission(value: string): PlannerProposalAdmission {
  const admission = JSON.parse(value) as PlannerProposalAdmission
  assertPlannerProposalAdmission(admission)
  return admission
}

interface IntakeReplayRow {
  intake_request_hash: string
  admission_json: string
}

interface NaturalReplayRow {
  planner_run_id: string
  proposal_hash: string
  control_plane_context_hash: string
  admission_json: string
}

interface PlannerProposalHeaderRow {
  hypothesis_id: string
  canonical_node_id: string
}
