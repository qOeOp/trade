import assert from "node:assert/strict"
import test from "node:test"
import {
  EVALUATION_EVIDENCE_CLASSIFICATION_SCHEMA,
  EVALUATION_EVIDENCE_POLICY_VERSION,
  assertEvaluationEvidenceClassification,
  createEvaluationEvidenceClassification,
} from "./evaluation-evidence-classification"

test("evaluation evidence classification binds kind to its authoritative producer", () => {
  const classification = createEvaluationEvidenceClassification({
    schema_version: EVALUATION_EVIDENCE_CLASSIFICATION_SCHEMA,
    policy_version: EVALUATION_EVIDENCE_POLICY_VERSION,
    result_id: "result-1",
    experiment_id: "experiment-1",
    evidence_kind: "mechanical_replay",
    producer: "replay_owner",
    artifact_ref: "replay/result-1.json",
    evidence_hash: "a".repeat(64),
    classified_at: "2026-07-23T11:00:00.000Z",
  })
  assertEvaluationEvidenceClassification(classification)
  assert.throws(() => createEvaluationEvidenceClassification({
    ...classification,
    producer: "agent_evaluation_owner",
  }), /not authoritative/)
  assert.throws(() => assertEvaluationEvidenceClassification({
    ...classification,
    evidence_hash: "b".repeat(64),
  }), /hash-drifted/)
})
