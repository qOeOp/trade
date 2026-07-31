import {
  canonicalHash,
  canonicalJson,
} from "../../../../../contracts/runtime-core/src/canonical-json"

export const CERTIFIED_STRATEGY_SOURCE_BINDING_SCHEMA_VERSION =
  "trade.rd-certified-strategy-source-binding.v1" as const

export interface CertifiedStrategySourceBindingBody {
  schema_version: typeof CERTIFIED_STRATEGY_SOURCE_BINDING_SCHEMA_VERSION
  admission_id: string
  experiment_id: string
  decision_id: string
  draft_id: string
  strategy_id: string
  strategy_version: string
  strategy_source_ref: string
  strategy_source_hash: string
  source_candidate_manifest_ref: string
  source_candidate_manifest_hash: string
  source_adoption_id: string
  source_adoption_manifest_ref: string
  source_adoption_manifest_hash: string
  candidate_source_revision: string
  source_archive_ref: string
  source_archive_hash: string
  historical_replay_build_artifact_hash: string
  historical_replay_runtime_executable_hash: string
  certified_at: string
  authority: {
    forward_evidence_authority: "source_binding_only"
    deployment_authority: "none"
    trading_authority: false
  }
}

export interface CertifiedStrategySourceBinding
  extends CertifiedStrategySourceBindingBody {
  binding_hash: string
}

export function createCertifiedStrategySourceBinding(
  input: CertifiedStrategySourceBindingBody,
): CertifiedStrategySourceBinding {
  if (input.schema_version
        !== CERTIFIED_STRATEGY_SOURCE_BINDING_SCHEMA_VERSION
      || input.authority?.forward_evidence_authority
        !== "source_binding_only"
      || input.authority?.deployment_authority !== "none"
      || input.authority?.trading_authority !== false) {
    throw new Error("unsupported certified Strategy source authority")
  }
  const body: CertifiedStrategySourceBindingBody = {
    schema_version: CERTIFIED_STRATEGY_SOURCE_BINDING_SCHEMA_VERSION,
    admission_id: identifier(input.admission_id, "admission_id"),
    experiment_id: identifier(input.experiment_id, "experiment_id"),
    decision_id: identifier(input.decision_id, "decision_id"),
    draft_id: identifier(input.draft_id, "draft_id"),
    strategy_id: identifier(input.strategy_id, "strategy_id"),
    strategy_version: identifier(
      input.strategy_version,
      "strategy_version",
    ),
    strategy_source_ref: strategyRef(input.strategy_source_ref),
    strategy_source_hash: digest(
      input.strategy_source_hash,
      "strategy_source_hash",
    ),
    source_candidate_manifest_ref: repoRef(
      input.source_candidate_manifest_ref,
      "source_candidate_manifest_ref",
    ),
    source_candidate_manifest_hash: digest(
      input.source_candidate_manifest_hash,
      "source_candidate_manifest_hash",
    ),
    source_adoption_id: identifier(
      input.source_adoption_id,
      "source_adoption_id",
    ),
    source_adoption_manifest_ref: repoRef(
      input.source_adoption_manifest_ref,
      "source_adoption_manifest_ref",
    ),
    source_adoption_manifest_hash: digest(
      input.source_adoption_manifest_hash,
      "source_adoption_manifest_hash",
    ),
    candidate_source_revision: revision(
      input.candidate_source_revision,
      "candidate_source_revision",
    ),
    source_archive_ref: repoRef(
      input.source_archive_ref,
      "source_archive_ref",
    ),
    source_archive_hash: digest(
      input.source_archive_hash,
      "source_archive_hash",
    ),
    historical_replay_build_artifact_hash: digest(
      input.historical_replay_build_artifact_hash,
      "historical_replay_build_artifact_hash",
    ),
    historical_replay_runtime_executable_hash: digest(
      input.historical_replay_runtime_executable_hash,
      "historical_replay_runtime_executable_hash",
    ),
    certified_at: utc(input.certified_at, "certified_at"),
    authority: {
      forward_evidence_authority: "source_binding_only",
      deployment_authority: "none",
      trading_authority: false,
    },
  }
  return { ...body, binding_hash: canonicalHash(body) }
}

export function assertCertifiedStrategySourceBinding(
  value: CertifiedStrategySourceBinding,
): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("certified Strategy source binding must be an object")
  }
  const { binding_hash: _hash, ...body } = value
  const expected = createCertifiedStrategySourceBinding(body)
  if (canonicalJson(value) !== canonicalJson(expected)) {
    throw new Error(
      "certified Strategy source binding is non-canonical or hash-drifted",
    )
  }
}

function identifier(value: unknown, field: string): string {
  if (typeof value !== "string"
      || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,191}$/.test(value)) {
    throw new Error(`${field} is invalid`)
  }
  return value
}

function digest(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${field} must be sha256`)
  }
  return value
}

function revision(value: unknown, field: string): string {
  if (typeof value !== "string"
      || !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(value)) {
    throw new Error(`${field} is invalid`)
  }
  return value
}

function strategyRef(value: unknown): string {
  if (typeof value !== "string"
      || !/^strategies\/[a-z0-9][a-z0-9-]{0,127}\.md$/.test(value)) {
    throw new Error("strategy_source_ref is invalid")
  }
  return value
}

function repoRef(value: unknown, field: string): string {
  if (typeof value !== "string"
      || !value
      || value.length > 4_096
      || value.startsWith("/")
      || value.includes("\\")
      || value.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`${field} must be a repository-relative path`)
  }
  return value
}

function utc(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} is invalid`)
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new Error(`${field} must be canonical UTC`)
  }
  return value
}
