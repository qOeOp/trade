import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import {
  DEVELOPER_CONTRACT_DRAFT_INTAKE_REQUEST_SCHEMA_VERSION,
  DEVELOPER_CONTRACT_DRAFT_SUBMISSION_SCHEMA_VERSION,
  DEVELOPER_DEVELOPMENT_BRIEF_ISSUE_REQUEST_SCHEMA_VERSION,
  DEVELOPER_EXPERIMENT_CONTRACT_DRAFT_PAYLOAD_SCHEMA_VERSION,
  TARGET_EXPERIMENT_CONTRACT_SCHEMA_VERSION,
  createDeveloperContractDraftSubmission,
} from "../../../contracts/src/lib/developer-contract-draft"
import {
  PLANNER_PROPOSAL_INTAKE_REQUEST_SCHEMA_VERSION,
  PLANNER_PROPOSAL_SUBMISSION_SCHEMA_VERSION,
  createPlannerProposalSubmission,
} from "../../../contracts/src/lib/planner-proposal-submission"
import {
  issueDeveloperDevelopmentBrief,
  readDeveloperContractDraftReceipt,
  readDeveloperDevelopmentBrief,
  receiveDeveloperContractDraft,
} from "./developer-contract-draft-intake"
import { admitPlannerProposal } from "./planner-proposal-intake"
import { readPlannerControlPlaneContext } from "./research-control-plane-operations"
import { ensureResearchStateSchema } from "./research-state-store"
import { seedDefaultResearchControlPlane } from "./research-universe-default-seed"

function openDb(): Database {
  const db = new Database(":memory:")
  ensureResearchStateSchema(db)
  seedDefaultResearchControlPlane(db, "2026-07-22T12:00:00Z")
  return db
}

function admitProposal(db: Database, proposalRevision = 1, objective = "Test one bounded mechanism") {
  const context = readPlannerControlPlaneContext(db)
  const proposal = createPlannerProposalSubmission({
    schema_version: PLANNER_PROPOSAL_SUBMISSION_SCHEMA_VERSION,
    revision: 2,
    proposal_id: "proposal-1",
    hypothesis_id: "hypothesis-1",
    universe_node_id: "canonical:trend/time-series-trend/time-series-momentum",
    objective,
    dataset_requirements: ["ohlcv"],
    candidate_space: proposalRevision === 1 ? { lookback: [20, 40] } : { lookback: [20] },
    trial_budget: 2,
    evaluation_protocol_ref: "protocol://historical-v1",
    control_plane_context_hash: context.context_hash,
    created_at: proposalRevision === 1 ? "2026-07-22T12:01:00Z" : "2026-07-22T12:07:00Z",
  })
  admitPlannerProposal(db, {
    schema_version: PLANNER_PROPOSAL_INTAKE_REQUEST_SCHEMA_VERSION,
    planner_run_id: `planner-run-${proposalRevision}`,
    proposal_revision: proposalRevision,
    idempotency_key: `planner-intake-${proposalRevision}`,
    submitted_at: proposalRevision === 1 ? "2026-07-22T12:02:00Z" : "2026-07-22T12:08:00Z",
    recorded_at: proposalRevision === 1 ? "2026-07-22T12:03:00Z" : "2026-07-22T12:09:00Z",
    proposal,
  })
  return proposal
}

function issueBrief(db: Database, proposalRevision = 1, overrides: Record<string, unknown> = {}) {
  return issueDeveloperDevelopmentBrief(db, {
    schema_version: DEVELOPER_DEVELOPMENT_BRIEF_ISSUE_REQUEST_SCHEMA_VERSION,
    brief_id: `brief-${proposalRevision}`,
    proposal_id: "proposal-1",
    proposal_revision: proposalRevision,
    idempotency_key: `brief-issue-${proposalRevision}`,
    issued_at: proposalRevision === 1 ? "2026-07-22T12:04:00Z" : "2026-07-22T12:10:00Z",
    ...overrides,
  })
}

function draft(brief: ReturnType<typeof issueBrief>, overrides: Record<string, unknown> = {}) {
  return createDeveloperContractDraftSubmission({
    schema_version: DEVELOPER_CONTRACT_DRAFT_SUBMISSION_SCHEMA_VERSION,
    brief_id: brief.brief_id,
    brief_hash: brief.brief_hash,
    proposal_id: brief.proposal_id,
    proposal_revision: brief.proposal_revision,
    proposal_hash: brief.proposal_hash,
    developer_run_id: "developer-run-1",
    draft_revision: 1,
    allowed_candidate_space_hash: brief.allowed_candidate_space_hash,
    requested_trial_budget: 2,
    target_contract_schema_version: TARGET_EXPERIMENT_CONTRACT_SCHEMA_VERSION,
    draft_json: {
      schema_version: DEVELOPER_EXPERIMENT_CONTRACT_DRAFT_PAYLOAD_SCHEMA_VERSION,
      canonical_node_id: brief.universe_node_id,
      required_data: ["ohlcv"],
    },
    created_at: "2026-07-22T12:05:00Z",
    ...overrides,
  })
}

function receive(db: Database, submission: ReturnType<typeof draft>, overrides: Record<string, unknown> = {}) {
  return receiveDeveloperContractDraft(db, {
    schema_version: DEVELOPER_CONTRACT_DRAFT_INTAKE_REQUEST_SCHEMA_VERSION,
    idempotency_key: `draft-intake-${submission.draft_revision}`,
    recorded_at: "2026-07-22T12:06:00Z",
    submission,
    ...overrides,
  })
}

test("Control Plane issues one immutable Brief and receives an unvalidated Draft idempotently", () => {
  const db = openDb()
  try {
    admitProposal(db)
    const brief = issueBrief(db)
    expect(issueBrief(db)).toEqual(brief)
    expect(readDeveloperDevelopmentBrief(db, brief.brief_id)).toEqual(brief)
    expect(brief.authority_scope).toBe("contract_draft_only")

    const submission = draft(brief)
    const receipt = receive(db, submission)
    expect(receive(db, submission)).toEqual(receipt)
    expect(readDeveloperContractDraftReceipt(db, brief.brief_id, 1)).toEqual(receipt)
    expect(receipt.status).toBe("received_unvalidated")
    expect(count(db, "rd_developer_development_brief")).toBe(1)
    expect(count(db, "rd_developer_contract_draft")).toBe(1)
    expect(count(db, "rd_experiment_contract")).toBe(0)
    expect(count(db, "rd_trial_group")).toBe(0)
    expect(count(db, "rd_trial")).toBe(0)
    expect(() => db.query("UPDATE rd_developer_contract_draft SET developer_run_id='drift'").run())
      .toThrow("append-only")
    expect(() => db.query("DELETE FROM rd_developer_development_brief WHERE brief_id='brief-1'").run())
      .toThrow("immutable")
  } finally {
    db.close()
  }
})

test("Control Plane rejects Draft declared-scope drift, excess budget, and revision gaps", () => {
  const db = openDb()
  try {
    admitProposal(db)
    const brief = issueBrief(db)
    expect(() => receive(db, draft(brief, { allowed_candidate_space_hash: "a".repeat(64) })))
      .toThrow("exact Brief candidate-space hash")
    expect(() => receive(db, draft(brief, { requested_trial_budget: 3 })))
      .toThrow("cannot exceed")
    expect(() => receive(db, draft(brief, {
      draft_revision: 2,
      developer_run_id: "developer-run-2",
      created_at: "2026-07-22T12:05:30Z",
    }), { idempotency_key: "draft-intake-gap" })).toThrow("revision must be 1")
    expect(count(db, "rd_developer_contract_draft")).toBe(0)
  } finally {
    db.close()
  }
})

test("a newer Proposal revision makes an unconsumed Brief stale without rewriting history", () => {
  const db = openDb()
  try {
    admitProposal(db)
    const oldBrief = issueBrief(db)
    const oldDraft = draft(oldBrief)
    admitProposal(db, 2, "Narrow the same mechanism")
    expect(() => receive(db, oldDraft)).toThrow("Brief is stale")
    expect(() => issueBrief(db, 1, {
      brief_id: "brief-old-retry",
      idempotency_key: "brief-old-retry",
      issued_at: "2026-07-22T12:10:00Z",
    })).toThrow("latest Proposal revision")
    const currentBrief = issueBrief(db, 2)
    expect(currentBrief.proposal_revision).toBe(2)
    expect(readDeveloperDevelopmentBrief(db, oldBrief.brief_id)).toEqual(oldBrief)
    expect(count(db, "rd_developer_contract_draft")).toBe(0)
  } finally {
    db.close()
  }
})

function count(db: Database, table: string): number {
  return (db.query(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count
}
