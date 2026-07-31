import {
  canonicalHash,
  canonicalJson,
} from "../../../../../contracts/runtime-core/src/canonical-json"

export const STRATEGY_SOURCE_CANDIDATE_SCHEMA_VERSION =
  "trade.rd-strategy-source-candidate.v1" as const

export interface StrategySourceCandidateBody {
  schema_version: typeof STRATEGY_SOURCE_CANDIDATE_SCHEMA_VERSION
  candidate_kind: "draft_strategy_source"
  compiler: {
    version: string
    input_hash: string
  }
  decision: {
    decision_id: string
    draft_id: string
    strategy_id: string
    strategy_version: string
    primary_result_id: string
    primary_result_hash: string
  }
  source_provenance: {
    source_revision: string
    provenance_hash: string
    agent_run_request_hash: string
    agent_run_result_hash: string
  }
  replay_code_evidence: {
    decision_harness_build_artifact_hash: string
    decision_harness_runtime_executable_hash: string
  }
  strategy_source: {
    ref: string
    sha256: string
    bytes: number
  }
  authority: {
    release_authority: "candidate_source_only"
    deployment_authority: "none"
    trading_authority: false
  }
  created_at: string
}

export interface StrategySourceCandidate extends StrategySourceCandidateBody {
  manifest_hash: string
}

export function createStrategySourceCandidate(
  input: StrategySourceCandidateBody,
): StrategySourceCandidate {
  if (input.schema_version !== STRATEGY_SOURCE_CANDIDATE_SCHEMA_VERSION
      || input.candidate_kind !== "draft_strategy_source"
      || input.authority?.release_authority !== "candidate_source_only"
      || input.authority?.deployment_authority !== "none"
      || input.authority?.trading_authority !== false) {
    throw new Error("unsupported Strategy source candidate authority")
  }
  const body: StrategySourceCandidateBody = {
    schema_version: STRATEGY_SOURCE_CANDIDATE_SCHEMA_VERSION,
    candidate_kind: "draft_strategy_source",
    compiler: {
      version: required(input.compiler?.version, "compiler.version"),
      input_hash: digest(input.compiler?.input_hash, "compiler.input_hash"),
    },
    decision: {
      decision_id: identifier(
        input.decision?.decision_id,
        "decision.decision_id",
      ),
      draft_id: identifier(input.decision?.draft_id, "decision.draft_id"),
      strategy_id: identifier(
        input.decision?.strategy_id,
        "decision.strategy_id",
      ),
      strategy_version: identifier(
        input.decision?.strategy_version,
        "decision.strategy_version",
      ),
      primary_result_id: identifier(
        input.decision?.primary_result_id,
        "decision.primary_result_id",
      ),
      primary_result_hash: digest(
        input.decision?.primary_result_hash,
        "decision.primary_result_hash",
      ),
    },
    source_provenance: {
      source_revision: revision(input.source_provenance?.source_revision),
      provenance_hash: digest(
        input.source_provenance?.provenance_hash,
        "source_provenance.provenance_hash",
      ),
      agent_run_request_hash: digest(
        input.source_provenance?.agent_run_request_hash,
        "source_provenance.agent_run_request_hash",
      ),
      agent_run_result_hash: digest(
        input.source_provenance?.agent_run_result_hash,
        "source_provenance.agent_run_result_hash",
      ),
    },
    replay_code_evidence: {
      decision_harness_build_artifact_hash: digest(
        input.replay_code_evidence?.decision_harness_build_artifact_hash,
        "replay_code_evidence.decision_harness_build_artifact_hash",
      ),
      decision_harness_runtime_executable_hash: digest(
        input.replay_code_evidence
          ?.decision_harness_runtime_executable_hash,
        "replay_code_evidence.decision_harness_runtime_executable_hash",
      ),
    },
    strategy_source: {
      ref: strategyRef(input.strategy_source?.ref),
      sha256: digest(
        input.strategy_source?.sha256,
        "strategy_source.sha256",
      ),
      bytes: integer(input.strategy_source?.bytes, "strategy_source.bytes"),
    },
    authority: {
      release_authority: "candidate_source_only",
      deployment_authority: "none",
      trading_authority: false,
    },
    created_at: canonicalUtc(input.created_at),
  }
  return { ...body, manifest_hash: canonicalHash(body) }
}

export function assertStrategySourceCandidate(
  value: StrategySourceCandidate,
): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Strategy source candidate must be an object")
  }
  const { manifest_hash: _hash, ...body } = value
  const expected = createStrategySourceCandidate(body)
  if (canonicalJson(value) !== canonicalJson(expected)) {
    throw new Error("Strategy source candidate is non-canonical or hash-drifted")
  }
}

function required(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required`)
  }
  return value
}

function identifier(value: unknown, field: string): string {
  const text = required(value, field)
  if (!/^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/.test(text)) {
    throw new Error(`${field} is invalid`)
  }
  return text
}

function revision(value: unknown): string {
  const text = required(value, "source_revision")
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(text)) {
    throw new Error("source_revision is invalid")
  }
  return text
}

function digest(value: unknown, field: string): string {
  const text = required(value, field)
  if (!/^[a-f0-9]{64}$/.test(text)) {
    throw new Error(`${field} must be sha256`)
  }
  return text
}

function strategyRef(value: unknown): string {
  const text = required(value, "strategy_source.ref")
  if (!/^strategies\/[a-z0-9][a-z0-9-]{0,127}\.md$/.test(text)) {
    throw new Error("strategy_source.ref is invalid")
  }
  return text
}

function integer(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error(`${field} is invalid`)
  }
  return Number(value)
}

function canonicalUtc(value: unknown): string {
  const text = required(value, "created_at")
  const date = new Date(text)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== text) {
    throw new Error("created_at must be canonical UTC")
  }
  return text
}
