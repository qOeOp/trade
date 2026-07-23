import type { Database } from "bun:sqlite"
import {
  assertEvaluationEvidenceClassification,
  type EvaluationEvidenceClassification,
} from "../../../contracts/src/lib/evaluation-evidence-classification"

interface ResultRow {
  result_id: string
  experiment_id: string
  artifact_ref: string
  stage_id: string
}

export function registerEvaluationEvidenceClassification(
  db: Database,
  classification: EvaluationEvidenceClassification,
): EvaluationEvidenceClassification {
  assertEvaluationEvidenceClassification(classification)
  const existing = readEvaluationEvidenceClassification(db, classification.result_id)
  if (existing) {
    if (existing.classification_hash === classification.classification_hash) return existing
    throw new Error("result already has a different evaluation evidence classification")
  }
  const result = db.query(`
    SELECT result_id, experiment_id, artifact_ref, stage_id
    FROM rd_experiment_result
    WHERE result_id = $result_id
  `).get({ $result_id: classification.result_id }) as ResultRow | null
  if (!result || result.experiment_id !== classification.experiment_id) {
    throw new Error("evaluation evidence classification requires its experiment Result")
  }
  if (result.artifact_ref !== classification.artifact_ref) {
    throw new Error("evaluation evidence artifact_ref drifted from its Result")
  }
  if (classification.evidence_kind === "forward_observation"
    && result.stage_id !== "forward_observation") {
    throw new Error("forward evidence classification requires forward_observation Result stage")
  }
  if (classification.evidence_kind !== "forward_observation"
    && result.stage_id === "forward_observation") {
    throw new Error("historical evidence classification cannot label forward_observation Result")
  }
  db.query(`
    INSERT INTO rd_evaluation_evidence_classification(
      result_id, experiment_id, evidence_kind, producer, artifact_ref,
      evidence_hash, policy_version, classification_json, classification_hash,
      classified_at
    ) VALUES (
      $result_id, $experiment_id, $evidence_kind, $producer, $artifact_ref,
      $evidence_hash, $policy_version, $classification_json, $classification_hash,
      $classified_at
    )
  `).run({
    $result_id: classification.result_id,
    $experiment_id: classification.experiment_id,
    $evidence_kind: classification.evidence_kind,
    $producer: classification.producer,
    $artifact_ref: classification.artifact_ref,
    $evidence_hash: classification.evidence_hash,
    $policy_version: classification.policy_version,
    $classification_json: JSON.stringify(classification),
    $classification_hash: classification.classification_hash,
    $classified_at: classification.classified_at,
  })
  return classification
}

export function readEvaluationEvidenceClassification(
  db: Database,
  resultId: string,
): EvaluationEvidenceClassification | null {
  const row = db.query(`
    SELECT classification_json
    FROM rd_evaluation_evidence_classification
    WHERE result_id = $result_id
  `).get({ $result_id: resultId }) as { classification_json: string } | null
  if (!row) return null
  const classification = JSON.parse(row.classification_json) as EvaluationEvidenceClassification
  assertEvaluationEvidenceClassification(classification)
  return classification
}

export function readExperimentEvaluationEvidence(
  db: Database,
  experimentId: string,
): EvaluationEvidenceClassification[] {
  return (db.query(`
    SELECT classification_json
    FROM rd_evaluation_evidence_classification
    WHERE experiment_id = $experiment_id
    ORDER BY result_id
  `).all({ $experiment_id: experimentId }) as Array<{ classification_json: string }>)
    .map((row) => {
      const classification = JSON.parse(row.classification_json) as EvaluationEvidenceClassification
      assertEvaluationEvidenceClassification(classification)
      return classification
    })
}
