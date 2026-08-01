import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { REPLAY_CERTIFICATION_OWNER, type ReplayProfileEvidenceManifest } from "./replay-certification"

interface ReplayOperationalProfile {
  profile: string
  status_values: string[]
  identity_fields: string[]
  progress_fields: string[]
  failure_fields: string[]
  publication_fields: string[]
  checkpoint_mode: string
  partial_evidence_policy: string
}

interface ReplayOperationalIncidentClass {
  incident_class: string
  first_action: string
  retry_policy: string
}

export interface ReplayOperationalReadinessRegistry {
  schema_version: "trade.rd-replay-operational-readiness.v1"
  owner: string
  scope: "local-structured-outcomes-immutable-evidence-and-release-certification"
  telemetry_boundary: "no-central-metrics-logs-traces-alerting-or-slo-claimed"
  authority_policy: "outcome-and-committed-evidence-not-process-exit-or-stdout-determine-authority"
  profile_observability: ReplayOperationalProfile[]
  incident_classes: ReplayOperationalIncidentClass[]
  operator_commands: string[]
  limitations: string[]
  registry_sha256: string
}

const EXPECTED_PROFILES: ReplayOperationalProfile[] = [
  {
    profile: "independent-lane-batch",
    status_values: ["completed", "failed"],
    identity_fields: ["batch_id", "plan_hash", "outcome_hash"],
    progress_fields: ["child_statuses"],
    failure_fields: ["failure.code", "failure.failed_lane_id", "failure.partial_result_published"],
    publication_fields: ["result.result_hash", "child_statuses[].artifact_manifest_hash"],
    checkpoint_mode: "child-trial-engine-checkpoints-v32-only",
    partial_evidence_policy: "partial_result_published=false",
  },
  {
    profile: "integrated-portfolio",
    status_values: ["completed", "failed"],
    identity_fields: ["portfolio_id", "integrated_plan_hash", "outcome_hash"],
    progress_fields: ["result", "risk_result", "artifact.status"],
    failure_fields: ["failure.code", "failure.message", "failure.partial_result_published"],
    publication_fields: ["result.result_hash", "artifact.artifact_manifest.manifest_hash"],
    checkpoint_mode: "not-supported-no-checkpoint-writer",
    partial_evidence_policy: "partial_result_published=false",
  },
  {
    profile: "single-trial",
    status_values: ["completed", "cancelled", "failed"],
    identity_fields: ["run_id", "attempt_id", "lease_generation", "attempt_lease_hash"],
    progress_fields: ["resumable_checkpoint", "diagnostic_checkpoint_commit", "cancellation_observation"],
    failure_fields: ["failure.code", "failure.failure_class", "failure.retryable", "failure.partial_result_published"],
    publication_fields: ["result.result_hash", "artifact_manifest.manifest_hash", "artifact_commit.sha256"],
    checkpoint_mode: "resumable-engine-checkpoint-v32",
    partial_evidence_policy: "partial_result_published=false",
  },
  {
    profile: "terminal-aware-bounded-cycle",
    status_values: ["completed", "failed"],
    identity_fields: ["portfolio_id", "sequence_plan_hash", "outcome_hash"],
    progress_fields: ["failure.cycle_index", "idempotent_replay"],
    failure_fields: ["failure.code", "failure.cycle_index", "failure.message", "failure.partial_sequence_result_published"],
    publication_fields: ["result.result_hash", "artifact_manifest.manifest_hash"],
    checkpoint_mode: "not-supported-no-checkpoint-writer",
    partial_evidence_policy: "partial_sequence_result_published=false",
  },
]

const EXPECTED_INCIDENT_CLASSES: ReplayOperationalIncidentClass[] = [
  { incident_class: "authority-admission", first_action: "freeze-inputs-and-verify-control-plane-authority", retry_policy: "only-when-outcome-retryable-and-control-plane-authorizes" },
  { incident_class: "data-integrity", first_action: "isolate-bytes-and-verify-all-lineage-and-hashes", retry_policy: "new-authorized-attempt-from-trusted-frozen-inputs" },
  { incident_class: "deterministic-unsupported", first_action: "record-limitation-and-return-blocker-to-control-plane", retry_policy: "same-input-rerun-forbidden-as-remediation" },
  { incident_class: "resource-cancellation", first_action: "verify-lease-generation-cancellation-observation-and-checkpoint", retry_policy: "clean-authorized-checkpoint-or-new-authorized-attempt" },
  { incident_class: "publication-corruption", first_action: "distinguish-non-authoritative-orphan-from-corrupt-commit", retry_policy: "identical-manifest-last-retry-only-before-commit" },
  { incident_class: "certification-regression", first_action: "block-release-and-preserve-runtime-host-commit-and-receipt", retry_policy: "fix-root-cause-then-rerun-complete-owner-certification" },
]

const EXPECTED_COMMANDS = [
  "bun run certify",
]

const EXPECTED_LIMITATIONS = [
  "no-central-durable-metrics-logs-traces-dashboard-or-pager",
  "no-formal-slo-or-alert-threshold-certified",
  "no-remote-distributed-artifact-store-operations",
  "no-automatic-incident-remediation-or-committed-corruption-repair",
  "stdout-and-process-exit-are-diagnostic-not-authoritative",
  "shadow-live-and-real-account-operations-out-of-scope",
]

export function loadReplayOperationalReadinessRegistry(
  repoRoot: string,
  path = join(repoRoot, REPLAY_CERTIFICATION_OWNER, "replay-operational-readiness.json"),
): ReplayOperationalReadinessRegistry {
  return JSON.parse(readFileSync(path, "utf8")) as ReplayOperationalReadinessRegistry
}

export function assertReplayOperationalReadinessRegistry(
  registry: ReplayOperationalReadinessRegistry,
  profileEvidence: ReplayProfileEvidenceManifest,
  _repoRoot: string,
): void {
  if (registry.schema_version !== "trade.rd-replay-operational-readiness.v1"
      || registry.owner !== REPLAY_CERTIFICATION_OWNER
      || registry.scope !== "local-structured-outcomes-immutable-evidence-and-release-certification"
      || registry.telemetry_boundary !== "no-central-metrics-logs-traces-alerting-or-slo-claimed"
      || registry.authority_policy
        !== "outcome-and-committed-evidence-not-process-exit-or-stdout-determine-authority") {
    throw new Error("unsupported Replay operational readiness registry")
  }
  if (JSON.stringify(registry.profile_observability) !== JSON.stringify(EXPECTED_PROFILES)
      || JSON.stringify(registry.profile_observability.map((entry) => entry.profile))
        !== JSON.stringify(profileEvidence.profiles.map((entry) => entry.profile))) {
    throw new Error("Replay operational profile observability is incomplete or overclaimed")
  }
  if (JSON.stringify(registry.incident_classes) !== JSON.stringify(EXPECTED_INCIDENT_CLASSES)) {
    throw new Error("Replay operational incident triage drifted or overclaimed retry")
  }
  if (JSON.stringify(registry.operator_commands) !== JSON.stringify(EXPECTED_COMMANDS)) {
    throw new Error("Replay operational commands drifted")
  }
  if (JSON.stringify(registry.limitations) !== JSON.stringify(EXPECTED_LIMITATIONS)) {
    throw new Error("Replay operational limitations drifted")
  }
  if (registry.registry_sha256 !== replayOperationalReadinessRegistryHash(registry)) {
    throw new Error("Replay operational readiness registry hash drifted")
  }
}

export function replayOperationalReadinessRegistryHash(
  registry: ReplayOperationalReadinessRegistry,
): string {
  const { registry_sha256: _registryHash, ...body } = registry
  return sha256(stableJson(body))
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(object[key])}`).join(",")}}`
  }
  return JSON.stringify(value)
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}
