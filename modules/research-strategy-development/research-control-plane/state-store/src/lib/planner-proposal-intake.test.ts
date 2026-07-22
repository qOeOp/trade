import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import {
  PLANNER_PROPOSAL_INTAKE_REQUEST_SCHEMA_VERSION,
  PLANNER_PROPOSAL_SUBMISSION_SCHEMA_VERSION,
  createPlannerProposalSubmission,
  type PlannerProposalSubmissionBody,
} from "../../../contracts/src/lib/planner-proposal-submission"
import { admitPlannerProposal, readPlannerProposalAdmission } from "./planner-proposal-intake"
import { readPlannerControlPlaneContext } from "./research-control-plane-operations"
import { ensureResearchStateSchema } from "./research-state-store"
import { seedDefaultResearchControlPlane } from "./research-universe-default-seed"

const NOW = "2026-07-22T12:00:00Z"

function openDb(): Database {
  const db = new Database(":memory:")
  ensureResearchStateSchema(db)
  seedDefaultResearchControlPlane(db, NOW)
  return db
}

function proposal(db: Database, overrides: Partial<PlannerProposalSubmissionBody> = {}) {
  const context = readPlannerControlPlaneContext(db)
  return createPlannerProposalSubmission({
    schema_version: PLANNER_PROPOSAL_SUBMISSION_SCHEMA_VERSION,
    revision: 2,
    proposal_id: "proposal-1",
    hypothesis_id: "hypothesis-1",
    universe_node_id: "canonical:trend/time-series-trend/time-series-momentum",
    objective: "Test one bounded time-series trend mechanism",
    dataset_requirements: ["ohlcv"],
    candidate_space: { lookback: [20, 40] },
    trial_budget: 2,
    evaluation_protocol_ref: "protocol://historical-v1",
    control_plane_context_hash: context.context_hash,
    created_at: "2026-07-22T12:01:00Z",
    ...overrides,
  })
}

function request(db: Database, overrides: Record<string, unknown> = {}) {
  return {
    schema_version: PLANNER_PROPOSAL_INTAKE_REQUEST_SCHEMA_VERSION,
    planner_run_id: "planner-run-1",
    proposal_revision: 1,
    idempotency_key: "planner-intake-1",
    submitted_at: "2026-07-22T12:02:00Z",
    recorded_at: "2026-07-22T12:03:00Z",
    proposal: proposal(db),
    ...overrides,
  }
}

test("Control Plane admits one immutable bounded Planner Proposal revision idempotently", () => {
  const db = openDb()
  try {
    const input = request(db)
    const admission = admitPlannerProposal(db, input)
    expect(admitPlannerProposal(db, input)).toEqual(admission)
    expect(readPlannerProposalAdmission(db, "proposal-1", 1)).toEqual(admission)
    expect(admission.status).toBe("accepted")
    expect(admission.admission_hash).toHaveLength(64)
    expect(count(db, "rd_planner_proposal")).toBe(1)
    expect(count(db, "rd_planner_proposal_revision")).toBe(1)
    expect(count(db, "rd_experiment_contract")).toBe(0)
    expect(count(db, "rd_trial_group")).toBe(0)
    expect(count(db, "rd_trial")).toBe(0)
    expect(() => db.query("UPDATE rd_planner_proposal_revision SET planner_run_id='drift'").run())
      .toThrow("append-only")
    expect(() => db.query("DELETE FROM rd_planner_proposal WHERE proposal_id='proposal-1'").run())
      .toThrow("immutable")
  } finally {
    db.close()
  }
})

test("Control Plane enforces contiguous revisions and frozen Proposal scope", () => {
  const db = openDb()
  try {
    admitPlannerProposal(db, request(db))
    const revised = proposal(db, {
      objective: "Test the same mechanism with a narrower bounded candidate space",
      candidate_space: { lookback: [20] },
      created_at: "2026-07-22T12:04:00Z",
    })
    expect(() => admitPlannerProposal(db, request(db, {
      planner_run_id: "planner-run-2",
      proposal_revision: 3,
      idempotency_key: "planner-intake-3",
      submitted_at: "2026-07-22T12:05:00Z",
      recorded_at: "2026-07-22T12:06:00Z",
      proposal: revised,
    }))).toThrow("revision must be 2")
    const revision2 = admitPlannerProposal(db, request(db, {
      planner_run_id: "planner-run-2",
      proposal_revision: 2,
      idempotency_key: "planner-intake-2",
      submitted_at: "2026-07-22T12:05:00Z",
      recorded_at: "2026-07-22T12:06:00Z",
      proposal: revised,
    }))
    expect(revision2.proposal_revision).toBe(2)

    const changedScope = proposal(db, {
      proposal_id: "proposal-1",
      hypothesis_id: "hypothesis-drift",
      created_at: "2026-07-22T12:07:00Z",
    })
    expect(() => admitPlannerProposal(db, request(db, {
      planner_run_id: "planner-run-3",
      proposal_revision: 3,
      idempotency_key: "planner-intake-scope-drift",
      submitted_at: "2026-07-22T12:08:00Z",
      recorded_at: "2026-07-22T12:09:00Z",
      proposal: changedScope,
    }))).toThrow("cannot change hypothesis or canonical")
  } finally {
    db.close()
  }
})

test("Control Plane rejects stale context, tamper, and idempotency drift without partial writes", () => {
  const db = openDb()
  try {
    const stale = request(db)
    db.query("UPDATE rd_data_surface SET coverage_status='blocked' WHERE slug='ohlcv'").run()
    expect(() => admitPlannerProposal(db, stale)).toThrow("context is stale")
    expect(count(db, "rd_planner_proposal_revision")).toBe(0)

    db.query("UPDATE rd_data_surface SET coverage_status='ready' WHERE slug='ohlcv'").run()
    const accepted = request(db)
    admitPlannerProposal(db, accepted)
    const changed = proposal(db, { objective: "Different content" })
    expect(() => admitPlannerProposal(db, { ...accepted, proposal: changed }))
      .toThrow("idempotency key already exists with different content")
    expect(() => admitPlannerProposal(db, {
      ...accepted,
      idempotency_key: "tampered",
      proposal: { ...accepted.proposal, objective: "tampered" },
    })).toThrow("hash-drifted")
    expect(count(db, "rd_planner_proposal_revision")).toBe(1)
  } finally {
    db.close()
  }
})

function count(db: Database, table: string): number {
  return (db.query(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count
}
