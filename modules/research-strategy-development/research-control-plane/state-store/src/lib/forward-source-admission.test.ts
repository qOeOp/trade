import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import {
  CERTIFIED_STRATEGY_SOURCE_BINDING_SCHEMA_VERSION,
  createCertifiedStrategySourceBinding,
} from "../../../contracts/src/lib/certified-strategy-source-binding"
import {
  admitCertifiedStrategySourceForForward,
  readForwardSourceAdmission,
} from "./forward-source-admission"
import { applySystemTransition } from "./research-control-plane-operations"
import { applyReviewerDecision } from "./research-control-plane"

const HASH = "a".repeat(64)

test("certified source admission transitions Draft to Forward exactly once", () => {
  const db = fixtureDb()
  const binding = fixtureBinding()
  expect(readForwardSourceAdmission(db, binding.admission_id)).toBeUndefined()
  expect(() => applySystemTransition(db, {
    experiment_id: "experiment-1",
    expected_version: 4,
    trigger_type: "system",
    trigger_value: "certified_source_admitted",
    trigger_ref: `forward-source://${binding.binding_hash}`,
    event_id: "bypass-event",
    idempotency_key: "bypass-key",
    created_at: "2026-07-23T00:00:30.000Z",
  })).toThrow("immutable Forward admission")
  expect(() => applyReviewerDecision(db, {
    decision_id: "legacy-forward-decision",
    experiment_id: "experiment-1",
    reviewer_run_id: "reviewer-1",
    idempotency_key: "legacy-forward-key",
    expected_version: 4,
    stage_id: "historical_validation",
    decision: "accept_for_forward",
    rationale_ref: "artifact://legacy-forward",
    evidence: [{ result_id: "result-1", evidence_role: "primary" }],
    lifecycle_event_id: "legacy-forward-event",
    lifecycle_idempotency_key: "legacy-forward-lifecycle",
    created_at: "2026-07-23T00:00:30.000Z",
  })).toThrow("superseded")
  const admitted = admitCertifiedStrategySourceForForward(db, {
    binding,
    admitted_at: "2026-07-23T00:01:00.000Z",
  })
  expect(admitted).toEqual(binding)
  expect(readForwardSourceAdmission(db, binding.admission_id)).toEqual(binding)
  expect(db.query(`
    SELECT lifecycle_state, lifecycle_version
    FROM rd_experiment_contract WHERE experiment_id='experiment-1'
  `).get()).toEqual({
    lifecycle_state: "forward_observation",
    lifecycle_version: 5,
  })
  expect(Number((db.query(`
    SELECT COUNT(*) AS count FROM rd_lifecycle_event
  `).get() as { count: number }).count)).toBe(1)

  expect(admitCertifiedStrategySourceForForward(db, {
    binding,
    admitted_at: "2026-07-23T00:02:00.000Z",
  })).toEqual(binding)
  expect(Number((db.query(`
    SELECT COUNT(*) AS count FROM rd_lifecycle_event
  `).get() as { count: number }).count)).toBe(1)
  expect(() => db.query(`
    UPDATE rd_forward_source_admission SET admitted_at='2026-07-24T00:00:00Z'
  `).run()).toThrow()
  db.close()
})

test("source admission rolls back when Registry provenance drifts", () => {
  const db = fixtureDb()
  db.query(`
    UPDATE rd_strategy_registry_job
    SET candidate_manifest_hash=$hash
  `).run({ $hash: "b".repeat(64) })
  expect(() => admitCertifiedStrategySourceForForward(db, {
    binding: fixtureBinding(),
    admitted_at: "2026-07-23T00:01:00.000Z",
  })).toThrow("Registry facts")
  expect(Number((db.query(`
    SELECT COUNT(*) AS count FROM rd_forward_source_admission
  `).get() as { count: number }).count)).toBe(0)
  expect((db.query(`
    SELECT lifecycle_state FROM rd_experiment_contract
  `).get() as { lifecycle_state: string }).lifecycle_state)
    .toBe("draft_frozen")
  db.close()
})

function fixtureDb(): Database {
  const db = new Database(":memory:")
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE rd_experiment_contract(
      experiment_id TEXT PRIMARY KEY,
      lifecycle_state TEXT NOT NULL,
      lifecycle_version INTEGER NOT NULL,
      lifecycle_rule_version TEXT NOT NULL,
      suspended_from_state TEXT,
      last_lifecycle_event_id TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE rd_review_decision(
      decision_id TEXT PRIMARY KEY,
      experiment_id TEXT NOT NULL,
      decision TEXT NOT NULL
    );
    CREATE TABLE rd_strategy_draft(
      draft_id TEXT PRIMARY KEY,
      strategy_id TEXT NOT NULL,
      strategy_version TEXT NOT NULL,
      strategy_ref TEXT NOT NULL,
      strategy_policy_hash TEXT NOT NULL,
      materialization_status TEXT NOT NULL
    );
    CREATE TABLE rd_strategy_registry_job(
      job_id TEXT PRIMARY KEY,
      decision_id TEXT NOT NULL,
      status TEXT NOT NULL,
      draft_id TEXT,
      strategy_ref TEXT,
      strategy_policy_hash TEXT,
      candidate_manifest_ref TEXT,
      candidate_manifest_hash TEXT
    );
    CREATE TABLE rd_lifecycle_transition_rule(
      rule_id TEXT PRIMARY KEY,
      rule_version TEXT NOT NULL,
      current_state TEXT NOT NULL,
      trigger_type TEXT NOT NULL,
      trigger_value TEXT NOT NULL,
      next_state TEXT NOT NULL,
      requires_result_stage_id TEXT NOT NULL,
      requires_fresh_fingerprint INTEGER NOT NULL
    );
    CREATE TABLE rd_lifecycle_event(
      event_id TEXT PRIMARY KEY,
      experiment_id TEXT NOT NULL,
      sequence_no INTEGER NOT NULL,
      transition_rule_id TEXT NOT NULL,
      trigger_ref TEXT NOT NULL,
      current_state TEXT NOT NULL,
      next_state TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
    INSERT INTO rd_experiment_contract VALUES(
      'experiment-1', 'draft_frozen', 4, 'trade-flow.rd-lifecycle-rules.v1',
      NULL, NULL, '2026-07-22T00:00:00.000Z'
    );
    INSERT INTO rd_review_decision VALUES(
      'decision-1', 'experiment-1', 'accept_for_draft'
    );
    INSERT INTO rd_strategy_draft VALUES(
      'draft-1', 'S-1', 'draft-1',
      '/candidate/strategies/candidate-1.md', '${HASH}', 'ready'
    );
    INSERT INTO rd_strategy_registry_job VALUES(
      'registry:decision-1', 'decision-1', 'completed', 'draft-1',
      '/candidate/strategies/candidate-1.md', '${HASH}',
      '/repo/data/release-candidates/strategy-drafts/decision-1/candidate.json',
      '${HASH}'
    );
    INSERT INTO rd_lifecycle_transition_rule VALUES(
      'trade-flow.rd-lifecycle-rules.v1:start-forward-certified-source',
      'trade-flow.rd-lifecycle-rules.v1', 'draft_frozen', 'system',
      'certified_source_admitted', 'forward_observation', '__any__', 0
    );
  `)
  return db
}

function fixtureBinding() {
  return createCertifiedStrategySourceBinding({
    schema_version: CERTIFIED_STRATEGY_SOURCE_BINDING_SCHEMA_VERSION,
    admission_id: "forward-source-1",
    experiment_id: "experiment-1",
    decision_id: "decision-1",
    draft_id: "draft-1",
    strategy_id: "S-1",
    strategy_version: "draft-1",
    strategy_source_ref: "strategies/candidate-1.md",
    strategy_source_hash: HASH,
    source_candidate_manifest_ref:
      "data/release-candidates/strategy-drafts/decision-1/candidate.json",
    source_candidate_manifest_hash: HASH,
    source_adoption_id: "strategy:adoption-1",
    source_adoption_manifest_ref:
      "data/release-candidates/strategy-adoptions/adoption-1/manifest.json",
    source_adoption_manifest_hash: HASH,
    candidate_source_revision: "b".repeat(40),
    source_archive_ref:
      "data/release-candidates/strategy-adoptions/adoption-1/source.tar",
    source_archive_hash: HASH,
    historical_replay_build_artifact_hash: HASH,
    historical_replay_runtime_executable_hash: HASH,
    certified_at: "2026-07-23T00:00:00.000Z",
    authority: {
      forward_evidence_authority: "source_binding_only",
      deployment_authority: "none",
      trading_authority: false,
    },
  })
}
