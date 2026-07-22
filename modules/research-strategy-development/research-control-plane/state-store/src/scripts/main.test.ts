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
import {
  DEVELOPER_CONTRACT_DRAFT_INTAKE_REQUEST_SCHEMA_VERSION,
  DEVELOPER_CONTRACT_DRAFT_SUBMISSION_SCHEMA_VERSION,
  DEVELOPER_DEVELOPMENT_BRIEF_ISSUE_REQUEST_SCHEMA_VERSION,
  DEVELOPER_EXPERIMENT_CONTRACT_DRAFT_PAYLOAD_SCHEMA_VERSION,
  TARGET_EXPERIMENT_CONTRACT_SCHEMA_VERSION,
  createDeveloperContractDraftSubmission,
  type DeveloperDevelopmentBrief,
} from "../../../contracts/src/lib/developer-contract-draft"
import { DEVELOPER_CONTRACT_DRAFT_VALIDATION_REQUEST_SCHEMA_VERSION } from "../../../contracts/src/lib/developer-contract-draft-validation"
import { DEVELOPER_CONTRACT_FREEZE_REQUEST_SCHEMA_VERSION } from "../../../contracts/src/lib/developer-contract-freeze"

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
    const issued = run(parseArgs([
      "--db", dbPath, "--action", "issue_developer_development_brief",
      "--json", JSON.stringify({
        schema_version: DEVELOPER_DEVELOPMENT_BRIEF_ISSUE_REQUEST_SCHEMA_VERSION,
        brief_id: "brief-cli-1",
        proposal_id: proposal.proposal_id,
        proposal_revision: 1,
        idempotency_key: "brief-issue-cli-1",
        issued_at: "2026-07-22T12:04:00Z",
      }),
    ])) as { brief: DeveloperDevelopmentBrief }
    const briefRead = run(parseArgs([
      "--db", dbPath, "--action", "read_developer_development_brief",
      "--json", JSON.stringify({ brief_id: issued.brief.brief_id }),
    ])) as { brief: { brief_hash: string } }
    assert.equal(briefRead.brief.brief_hash, issued.brief.brief_hash)
    const draft = createDeveloperContractDraftSubmission({
      schema_version: DEVELOPER_CONTRACT_DRAFT_SUBMISSION_SCHEMA_VERSION,
      brief_id: issued.brief.brief_id,
      brief_hash: issued.brief.brief_hash,
      proposal_id: issued.brief.proposal_id,
      proposal_revision: issued.brief.proposal_revision,
      proposal_hash: issued.brief.proposal_hash,
      developer_run_id: "developer-run-cli-1",
      draft_revision: 1,
      allowed_candidate_space_hash: issued.brief.allowed_candidate_space_hash,
      requested_trial_budget: 2,
      target_contract_schema_version: TARGET_EXPERIMENT_CONTRACT_SCHEMA_VERSION,
      draft_json: {
        schema_version: DEVELOPER_EXPERIMENT_CONTRACT_DRAFT_PAYLOAD_SCHEMA_VERSION,
        canonical_node_id: issued.brief.universe_node_id,
        required_data: ["ohlcv"],
      },
      created_at: "2026-07-22T12:05:00Z",
    })
    const received = run(parseArgs([
      "--db", dbPath, "--action", "receive_developer_contract_draft",
      "--json", JSON.stringify({
        schema_version: DEVELOPER_CONTRACT_DRAFT_INTAKE_REQUEST_SCHEMA_VERSION,
        idempotency_key: "draft-intake-cli-1",
        recorded_at: "2026-07-22T12:06:00Z",
        submission: draft,
      }),
    ])) as { receipt: { status: string; submission_hash: string } }
    assert.equal(received.receipt.status, "received_unvalidated")
    assert.equal(received.receipt.submission_hash, draft.submission_hash)
    const receiptRead = run(parseArgs([
      "--db", dbPath, "--action", "read_developer_contract_draft_receipt",
      "--json", JSON.stringify({ brief_id: issued.brief.brief_id, draft_revision: 1 }),
    ])) as { receipt: { submission_hash: string } }
    assert.equal(receiptRead.receipt.submission_hash, draft.submission_hash)
    const validated = run(parseArgs([
      "--db", dbPath, "--action", "validate_developer_contract_draft",
      "--json", JSON.stringify({
        schema_version: DEVELOPER_CONTRACT_DRAFT_VALIDATION_REQUEST_SCHEMA_VERSION,
        validation_id: "draft-validation-cli-1",
        brief_id: issued.brief.brief_id,
        draft_revision: 1,
        idempotency_key: "draft-validation-cli-key-1",
        validated_at: "2026-07-22T12:07:00Z",
      }),
    ])) as { validation: { status: string; validation_hash: string } }
    assert.equal(validated.validation.status, "invalid")
    const validationRead = run(parseArgs([
      "--db", dbPath, "--action", "read_developer_contract_draft_validation",
      "--json", JSON.stringify({ validation_id: "draft-validation-cli-1" }),
    ])) as { validation: { validation_hash: string } }
    assert.equal(validationRead.validation.validation_hash, validated.validation.validation_hash)
    assert.throws(() => run(parseArgs([
      "--db", dbPath, "--action", "freeze_developer_experiment_contract",
      "--json", JSON.stringify({
        schema_version: DEVELOPER_CONTRACT_FREEZE_REQUEST_SCHEMA_VERSION,
        freeze_id: "freeze-cli-1",
        validation_id: "draft-validation-cli-1",
        validation_hash: validated.validation.validation_hash,
        experiment_id: "experiment-cli-1",
        bootstrap_lifecycle_event_id: "event-cli-register-1",
        bootstrap_lifecycle_idempotency_key: "event-cli-register-key-1",
        idempotency_key: "freeze-cli-key-1",
        frozen_at: "2026-07-22T12:08:00Z",
      }),
    ])), /only a valid/)
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
