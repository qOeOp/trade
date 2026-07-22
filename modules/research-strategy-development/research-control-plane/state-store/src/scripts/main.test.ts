import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { parseArgs, run } from "./main"
import {
  PLANNER_PROPOSAL_INTAKE_REQUEST_SCHEMA_VERSION,
  PLANNER_PROPOSAL_SUBMISSION_SCHEMA_VERSION,
  createPlannerProposalSubmission,
} from "../../../contracts/src/lib/planner-proposal-submission"
import type { PlannerControlPlaneContextSnapshot } from "../../../contracts/src/lib/planner-control-plane-context"

test("research state store CLI upserts and reads program", () => {
  const dir = mkdtempSync(join(tmpdir(), "research-state-store-"))
  const dbPath = join(dir, "rd.db")
  try {
    run(parseArgs(["--db", dbPath, "--action", "init"]))
    run(parseArgs([
      "--db",
      dbPath,
      "--action",
      "upsert_program",
      "--json",
      JSON.stringify({
        program_id: "rd-cli",
        objective: "find edge",
        state: { usage: { trials_run: 0 } },
      }),
    ]))
    const result = run(parseArgs([
      "--db",
      dbPath,
      "--action",
      "read_program",
      "--json",
      JSON.stringify({ program_id: "rd-cli" }),
    ])) as { program: { objective: string } }
    assert.equal(result.program.objective, "find edge")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("research state store CLI seeds and reads the authoritative planning context", () => {
  const dir = mkdtempSync(join(tmpdir(), "research-control-plane-"))
  const dbPath = join(dir, "rd.db")
  try {
    const seeded = run(parseArgs([
      "--db", dbPath, "--action", "seed_default_control_plane",
      "--json", JSON.stringify({ now: "2026-07-14T06:00:00Z" }),
    ])) as { nodes: number; data_surfaces: number }
    assert.equal(seeded.nodes > 80, true)
    assert.equal(seeded.data_surfaces, 11)
    const read = run(parseArgs([
      "--db", dbPath, "--action", "read_planning_context", "--json", "{}",
    ])) as { context: { active_canonicals: unknown[]; capabilities: unknown[] } }
    assert.equal(read.context.active_canonicals.length, 7)
    assert.equal(read.context.capabilities.length, 7)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("research state store CLI admits a bounded Planner Proposal without materializing execution", () => {
  const dir = mkdtempSync(join(tmpdir(), "research-planner-intake-cli-"))
  const dbPath = join(dir, "rd.db")
  try {
    run(parseArgs([
      "--db", dbPath, "--action", "seed_default_control_plane",
      "--json", JSON.stringify({ now: "2026-07-22T12:00:00Z" }),
    ]))
    const read = run(parseArgs([
      "--db", dbPath, "--action", "read_planning_context", "--json", "{}",
    ])) as { context: PlannerControlPlaneContextSnapshot }
    const proposal = createPlannerProposalSubmission({
      schema_version: PLANNER_PROPOSAL_SUBMISSION_SCHEMA_VERSION,
      revision: 2,
      proposal_id: "proposal-cli-1",
      hypothesis_id: "hypothesis-cli-1",
      universe_node_id: "canonical:trend/time-series-trend/time-series-momentum",
      objective: "Test one bounded CLI mechanism",
      dataset_requirements: ["ohlcv"],
      candidate_space: { lookback: [20, 40] },
      trial_budget: 2,
      evaluation_protocol_ref: "protocol://historical-v1",
      control_plane_context_hash: read.context.context_hash,
      created_at: "2026-07-22T12:01:00Z",
    })
    const admitted = run(parseArgs([
      "--db", dbPath, "--action", "admit_planner_proposal",
      "--json", JSON.stringify({
        schema_version: PLANNER_PROPOSAL_INTAKE_REQUEST_SCHEMA_VERSION,
        planner_run_id: "planner-run-cli-1",
        proposal_revision: 1,
        idempotency_key: "planner-intake-cli-1",
        submitted_at: "2026-07-22T12:02:00Z",
        recorded_at: "2026-07-22T12:03:00Z",
        proposal,
      }),
    ])) as { admission: { proposal_hash: string; status: string } }
    assert.equal(admitted.admission.proposal_hash, proposal.proposal_hash)
    assert.equal(admitted.admission.status, "accepted")
    const reread = run(parseArgs([
      "--db", dbPath, "--action", "read_planner_proposal_admission",
      "--json", JSON.stringify({ proposal_id: "proposal-cli-1", proposal_revision: 1 }),
    ])) as { admission: { proposal_hash: string } }
    assert.equal(reread.admission.proposal_hash, proposal.proposal_hash)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("research state store CLI routes Replay L2 attachment owner actions fail closed", () => {
  const dir = mkdtempSync(join(tmpdir(), "research-l2-attachment-cli-"))
  const dbPath = join(dir, "rd.db")
  try {
    assert.throws(() => run(parseArgs([
      "--db", dbPath,
      "--action", "read_replay_l2_experiment_attachment",
      "--json", JSON.stringify({ reservation_hash: "a".repeat(64) }),
    ])), /not registered/)
    assert.throws(() => run(parseArgs([
      "--db", dbPath,
      "--action", "issue_replay_l2_experiment_attachment",
      "--json", "{}",
    ])), /authority_snapshot_id is required/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
