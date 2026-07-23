import assert from "node:assert/strict"
import test from "node:test"
import { Database } from "bun:sqlite"
import {
  buildAgentRunEvent,
  buildAgentRunResult,
  type AgentArtifactRef,
} from "../../../../../contracts/agent-run-contract/src/agent-run-contract"
import { canonicalJson } from "../../../../../contracts/runtime-core/src/canonical-json"
import {
  EVALUATION_EVIDENCE_CLASSIFICATION_SCHEMA,
  EVALUATION_EVIDENCE_POLICY_VERSION,
  createEvaluationEvidenceClassification,
} from "../../../contracts/src/lib/evaluation-evidence-classification"
import {
  REVIEWER_AGENT_SUBMISSION_SCHEMA,
  createReviewerAgentSubmission,
} from "../../../contracts/src/lib/reviewer-agent-submission"
import {
  admitReviewerAgentResult,
  prepareReviewerAgentRun,
} from "./reviewer-agent-run"
import { memoryArtifacts } from "./agent-artifact-port.test-fixture"

test("Reviewer Agent cannot promote agent-assisted historical evidence", () => {
  const db = reviewerFixture()
  const artifacts = memoryArtifacts()
  try {
    assert.throws(() => prepareReviewerAgentRun({
      db,
      reviewer_run_id: "reviewer-unclassified",
      trace_id: "trace-unclassified",
      idempotency_key: "reviewer-key-unclassified",
      source_revision: "0123456789abcdef",
      requested_at: "2026-07-23T11:00:00.000Z",
      deadline_at: "2026-07-23T11:15:00.000Z",
      experiment_id: "experiment-1",
      stage_id: "historical_validation",
      result_ids: ["result-unclassified"],
      artifacts,
    }), /lacks authoritative evidence classification/)

    const prepared = prepareReviewerAgentRun({
      db,
      reviewer_run_id: "reviewer-agent-run-1",
      trace_id: "trace-reviewer-1",
      idempotency_key: "reviewer-key-1",
      source_revision: "0123456789abcdef",
      requested_at: "2026-07-23T11:00:00.000Z",
      deadline_at: "2026-07-23T11:15:00.000Z",
      experiment_id: "experiment-1",
      stage_id: "historical_validation",
      result_ids: ["result-agent"],
      artifacts,
    })
    const submission = createReviewerAgentSubmission({
      schema_version: REVIEWER_AGENT_SUBMISSION_SCHEMA,
      reviewer_run_id: prepared.request.run_id,
      experiment_id: "experiment-1",
      expected_version: 2,
      stage_id: "historical_validation",
      decision: "accept_for_draft",
      evidence: [{ result_id: "result-agent", evidence_role: "primary" }],
      selected_trial_id: "trial-1",
      rationale: "The result appears positive.",
      created_at: "2026-07-23T11:05:00.000Z",
    })
    const output = artifacts.put(canonicalJson(submission), "application/json")
    assert.throws(() => admitReviewerAgentResult({
      db,
      prepared,
      ...completion(prepared, output),
      artifacts,
      recorded_at: "2026-07-23T11:05:01.000Z",
    }), /requires mechanical_replay/)
  } finally {
    db.close()
  }
})

function reviewerFixture(): Database {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE rd_experiment_contract(
      experiment_id TEXT PRIMARY KEY,
      lifecycle_state TEXT NOT NULL,
      lifecycle_version INTEGER NOT NULL
    );
    CREATE TABLE rd_experiment_result(
      result_id TEXT PRIMARY KEY,
      experiment_id TEXT NOT NULL,
      result_scope TEXT NOT NULL,
      trial_id TEXT,
      stage_id TEXT NOT NULL,
      artifact_ref TEXT NOT NULL,
      summary_json TEXT NOT NULL
    );
    CREATE TABLE rd_evaluation_evidence_classification(
      result_id TEXT PRIMARY KEY,
      classification_json TEXT NOT NULL
    );
    CREATE TABLE rd_lifecycle_transition_rule(
      current_state TEXT NOT NULL,
      trigger_type TEXT NOT NULL,
      trigger_value TEXT NOT NULL,
      requires_result_stage_id TEXT NOT NULL
    );
    INSERT INTO rd_experiment_contract VALUES ('experiment-1', 'discovery', 2);
    INSERT INTO rd_lifecycle_transition_rule VALUES
      ('discovery', 'reviewer', 'accept_for_draft', 'historical_validation');
    INSERT INTO rd_experiment_result VALUES
      ('result-agent', 'experiment-1', 'trial', 'trial-1', 'historical_validation',
       'artifact://result-agent', '{"net_return":0.02}'),
      ('result-unclassified', 'experiment-1', 'trial', 'trial-1', 'historical_validation',
       'artifact://result-unclassified', '{"net_return":0.03}');
  `)
  const classification = createEvaluationEvidenceClassification({
    schema_version: EVALUATION_EVIDENCE_CLASSIFICATION_SCHEMA,
    policy_version: EVALUATION_EVIDENCE_POLICY_VERSION,
    result_id: "result-agent",
    experiment_id: "experiment-1",
    evidence_kind: "agent_assisted_historical",
    producer: "agent_evaluation_owner",
    artifact_ref: "artifact://result-agent",
    evidence_hash: "a".repeat(64),
    classified_at: "2026-07-23T10:59:00.000Z",
  })
  db.query(`
    INSERT INTO rd_evaluation_evidence_classification(result_id, classification_json)
    VALUES ($result_id, $classification)
  `).run({
    $result_id: classification.result_id,
    $classification: JSON.stringify(classification),
  })
  return db
}

function completion(
  prepared: ReturnType<typeof prepareReviewerAgentRun>,
  output: AgentArtifactRef,
) {
  const request = prepared.request
  const events = [
    buildAgentRunEvent({
      run_id: request.run_id,
      trace_id: request.trace_id,
      request_hash: request.request_hash,
      sequence: 1,
      occurred_at: "2026-07-23T11:00:01.000Z",
      kind: "accepted",
      summary: "Reviewer accepted.",
    }),
    buildAgentRunEvent({
      run_id: request.run_id,
      trace_id: request.trace_id,
      request_hash: request.request_hash,
      sequence: 2,
      occurred_at: "2026-07-23T11:00:02.000Z",
      kind: "started",
      summary: "Reviewer started.",
    }),
    buildAgentRunEvent({
      run_id: request.run_id,
      trace_id: request.trace_id,
      request_hash: request.request_hash,
      sequence: 3,
      occurred_at: "2026-07-23T11:05:00.000Z",
      kind: "terminal",
      summary: "Reviewer completed.",
      status: "completed",
    }),
  ]
  return {
    events,
    result: buildAgentRunResult({
      run_id: request.run_id,
      trace_id: request.trace_id,
      request_hash: request.request_hash,
      terminal_sequence: 3,
      finished_at: "2026-07-23T11:05:00.000Z",
      status: "completed",
      output_refs: [output],
      usage: {
        wall_time_ms: 299_000,
        turns: 1,
        tool_calls: 0,
        input_bytes: request.instruction_ref.bytes + request.input_refs[0]!.bytes,
        output_bytes: output.bytes,
      },
    }),
  }
}
