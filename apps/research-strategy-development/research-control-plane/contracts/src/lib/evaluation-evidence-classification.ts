import { canonicalNfcJson } from "../../../../../contracts/runtime-core/src/canonical-json"
import { canonicalControlPlaneHash } from "./control-plane-contracts"

export const EVALUATION_EVIDENCE_CLASSIFICATION_SCHEMA =
  "trade.rd-evaluation-evidence-classification.v1" as const
export const EVALUATION_EVIDENCE_POLICY_VERSION =
  "trade.rd-evaluation-evidence-policy.v1" as const

export type EvaluationEvidenceKind =
  | "mechanical_replay"
  | "compatibility_mechanical_replay"
  | "agent_assisted_historical"
  | "forward_observation"

export type EvaluationEvidenceProducer =
  | "replay_owner"
  | "compatibility_evaluation_owner"
  | "agent_evaluation_owner"
  | "forward_owner"

export interface EvaluationEvidenceClassificationBody {
  schema_version: typeof EVALUATION_EVIDENCE_CLASSIFICATION_SCHEMA
  policy_version: typeof EVALUATION_EVIDENCE_POLICY_VERSION
  result_id: string
  experiment_id: string
  evidence_kind: EvaluationEvidenceKind
  producer: EvaluationEvidenceProducer
  artifact_ref: string
  evidence_hash: string
  classified_at: string
}

export interface EvaluationEvidenceClassification
  extends EvaluationEvidenceClassificationBody {
  classification_hash: string
}

export function createEvaluationEvidenceClassification(
  input: EvaluationEvidenceClassificationBody,
): EvaluationEvidenceClassification {
  if (input.schema_version !== EVALUATION_EVIDENCE_CLASSIFICATION_SCHEMA) {
    throw new Error("evaluation evidence classification schema is unsupported")
  }
  if (input.policy_version !== EVALUATION_EVIDENCE_POLICY_VERSION) {
    throw new Error("evaluation evidence policy version is unsupported")
  }
  const evidenceKind = kind(input.evidence_kind)
  const producer = evidenceProducer(input.producer)
  const expectedProducer: Record<EvaluationEvidenceKind, EvaluationEvidenceProducer> = {
    mechanical_replay: "replay_owner",
    compatibility_mechanical_replay: "compatibility_evaluation_owner",
    agent_assisted_historical: "agent_evaluation_owner",
    forward_observation: "forward_owner",
  }
  if (producer !== expectedProducer[evidenceKind]) {
    throw new Error("evaluation evidence producer is not authoritative for evidence kind")
  }
  const body: EvaluationEvidenceClassificationBody = {
    schema_version: EVALUATION_EVIDENCE_CLASSIFICATION_SCHEMA,
    policy_version: EVALUATION_EVIDENCE_POLICY_VERSION,
    result_id: identifier(input.result_id, "result_id"),
    experiment_id: identifier(input.experiment_id, "experiment_id"),
    evidence_kind: evidenceKind,
    producer,
    artifact_ref: safeRef(input.artifact_ref),
    evidence_hash: digest(input.evidence_hash),
    classified_at: utc(input.classified_at),
  }
  return { ...body, classification_hash: canonicalControlPlaneHash(body) }
}

export function assertEvaluationEvidenceClassification(
  value: EvaluationEvidenceClassification,
): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("evaluation evidence classification must be an object")
  }
  const { classification_hash: _classificationHash, ...body } = value
  const expected = createEvaluationEvidenceClassification(body)
  if (canonicalNfcJson(value) !== canonicalNfcJson(expected)) {
    throw new Error("evaluation evidence classification is non-canonical or hash-drifted")
  }
}

function kind(value: string): EvaluationEvidenceKind {
  if (![
    "mechanical_replay",
    "compatibility_mechanical_replay",
    "agent_assisted_historical",
    "forward_observation",
  ].includes(value)) {
    throw new Error("evaluation evidence kind is unsupported")
  }
  return value as EvaluationEvidenceKind
}

function evidenceProducer(value: string): EvaluationEvidenceProducer {
  if (![
    "replay_owner",
    "compatibility_evaluation_owner",
    "agent_evaluation_owner",
    "forward_owner",
  ].includes(value)) {
    throw new Error("evaluation evidence producer is unsupported")
  }
  return value as EvaluationEvidenceProducer
}

function identifier(value: string, field: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)) throw new Error(`${field} is invalid`)
  return value
}

function safeRef(value: string): string {
  const normalized = value?.trim()
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) {
    throw new Error("artifact_ref is unsafe")
  }
  return normalized
}

function digest(value: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("evidence_hash must be lowercase SHA-256")
  return value
}

function utc(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new Error("classified_at must be canonical UTC")
  }
  return value
}
