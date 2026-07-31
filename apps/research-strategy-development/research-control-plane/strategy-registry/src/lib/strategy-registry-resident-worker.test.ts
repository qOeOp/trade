import { randomUUID } from "node:crypto"
import { mkdirSync, rmSync } from "node:fs"
import { dirname } from "node:path"
import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import {
  buildDatabaseIdentity,
  ensureDatabaseIdentity,
} from "../../../../../contracts/runtime-core/src/database-identity"
import { resolveRepoPath } from "../../../../../contracts/runtime-core/src/paths"
import { runStrategyRegistryResidentCycle } from "./strategy-registry-resident-worker"

test("Strategy Registry resident starts against the authoritative store and idles safely", () => {
  const dbPath = `tmp/strategy-registry-test/${randomUUID()}/rd_state.db`
  const absolute = resolveRepoPath(dbPath)
  mkdirSync(dirname(absolute), { recursive: true })
  const db = new Database(absolute)
  ensureDatabaseIdentity(
    db,
    buildDatabaseIdentity("test:strategy-registry", "research_state_store"),
  )
  createOwnerSourceSchema(db)
  db.close()
  try {
    const result = runStrategyRegistryResidentCycle({
      db_path: dbPath,
      config: {
        environment_id: "test:strategy-registry",
        worker_id: "registry-test-1",
        candidate_root: "tmp/strategy-registry-test/candidates",
        lease_duration_ms: 1_000,
        max_attempts: 3,
      },
    })
    expect(result.status).toBe("idle")
    expect(result.release_authority).toBe("none")
    expect(result.deployment_authority).toBe("none")
    expect(result.trading_authority).toBe(false)
  } finally {
    rmSync(dirname(absolute), { recursive: true, force: true })
  }
})

function createOwnerSourceSchema(db: Database): void {
  db.exec(`
    CREATE TABLE rd_review_decision(
      decision_id TEXT PRIMARY KEY,
      reviewer_run_id TEXT NOT NULL,
      decision TEXT NOT NULL,
      experiment_id TEXT NOT NULL,
      rationale_ref TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE rd_review_decision_result(
      decision_id TEXT NOT NULL,
      result_id TEXT NOT NULL,
      evidence_role TEXT NOT NULL
    );
    CREATE TABLE rd_experiment_contract(
      experiment_id TEXT PRIMARY KEY,
      proposal_id TEXT NOT NULL,
      proposal_revision INTEGER NOT NULL,
      hypothesis_id TEXT NOT NULL,
      code_family_id TEXT NOT NULL,
      trial_group_id TEXT NOT NULL,
      trial_group_hash TEXT NOT NULL,
      contract_hash TEXT NOT NULL,
      identity_hash_policy_version TEXT NOT NULL,
      lifecycle_state TEXT NOT NULL,
      selected_candidate_id TEXT,
      selected_trial_id TEXT,
      candidate_hash TEXT,
      candidate_frozen_at TEXT
    );
    CREATE TABLE rd_experiment_result(
      result_id TEXT PRIMARY KEY,
      experiment_id TEXT NOT NULL,
      trial_id TEXT,
      run_id TEXT NOT NULL,
      artifact_ref TEXT NOT NULL,
      summary_json TEXT NOT NULL
    );
    CREATE TABLE rd_trial_group_candidate(
      trial_group_id TEXT NOT NULL,
      candidate_id TEXT NOT NULL,
      candidate_identity_hash TEXT NOT NULL,
      parameter_assignment_json TEXT NOT NULL
    );
    CREATE TABLE rd_planner_proposal_revision(
      proposal_id TEXT NOT NULL,
      proposal_revision INTEGER NOT NULL,
      submission_json TEXT NOT NULL
    );
    CREATE TABLE rd_replay_request_registration(
      trial_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      replay_request_json TEXT NOT NULL
    );
    CREATE TABLE rd_developer_contract_freeze(
      validation_id TEXT NOT NULL,
      experiment_id TEXT NOT NULL
    );
    CREATE TABLE rd_developer_contract_draft_validation(
      validation_id TEXT NOT NULL,
      brief_id TEXT NOT NULL,
      draft_revision INTEGER NOT NULL
    );
    CREATE TABLE rd_developer_contract_draft(
      brief_id TEXT NOT NULL,
      draft_revision INTEGER NOT NULL,
      developer_run_id TEXT NOT NULL
    );
    CREATE TABLE rd_developer_agent_draft_provenance(
      brief_id TEXT NOT NULL,
      draft_revision INTEGER NOT NULL,
      developer_run_id TEXT NOT NULL,
      source_revision TEXT NOT NULL,
      provenance_hash TEXT NOT NULL,
      agent_run_request_hash TEXT NOT NULL,
      agent_run_result_hash TEXT NOT NULL
    );
  `)
}
