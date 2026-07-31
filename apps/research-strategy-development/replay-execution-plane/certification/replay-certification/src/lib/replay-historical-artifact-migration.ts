import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { REPLAY_CERTIFICATION_OWNER } from "./replay-certification"

export interface ReplayHistoricalArtifactMigrationRegistry {
  schema_version: "trade.rd-replay-historical-artifact-migration.v1"
  owner: string
  reader_owner: string
  certification_owner: string
  migration_policy: "read-only-summary-no-writer-no-authority-rewrite"
  historical_artifacts: Array<{
    milestone: "M4-P10" | "M4-P11" | "M4-P13"
    manifest_schema_version: string
    primary_schema_version: string
    manifest_name: string
    primary_role: string
    artifact_roles: string[]
  }>
  reader_path: string
  reader_export: string
  certification_test_path: string
  certification_test_names: string[]
  limitations: string[]
  registry_sha256: string
}

const EXPECTED_ARTIFACTS: ReplayHistoricalArtifactMigrationRegistry["historical_artifacts"] = [
  {
    milestone: "M4-P10",
    manifest_schema_version: "trade.rd-replay-portfolio-reallocation-artifact-manifest.v1",
    primary_schema_version: "trade.rd-replay-portfolio-reallocation-result.v1",
    manifest_name: "portfolio-reallocation-artifact-manifest.json",
    primary_role: "reallocation_result",
    artifact_roles: ["reallocation_plan", "reallocation_reservation", "predecessor_integrated_result",
      "predecessor_artifact_manifest", "cycle_2_allocation_plan", "cycle_2_allocation_result",
      "reallocation_result"],
  },
  {
    milestone: "M4-P11",
    manifest_schema_version: "trade.rd-replay-two-cycle-portfolio-artifact-manifest.v1",
    primary_schema_version: "trade.rd-replay-two-cycle-portfolio-result.v1",
    manifest_name: "two-cycle-portfolio-artifact-manifest.json",
    primary_role: "two_cycle_result",
    artifact_roles: ["two_cycle_plan", "cycle_1_integrated_result", "cycle_1_artifact_manifest",
      "cycle_2_reallocation_result", "cycle_2_reallocation_manifest", "cycle_2_allocation_plan",
      "cycle_2_allocation_result", "cycle_2_risk_plan", "cycle_2_risk_reservation",
      "cycle_2_risk_result", "cycle_2_portfolio_evidence", "two_cycle_state_chain",
      "two_cycle_fingerprint", "two_cycle_result"],
  },
  {
    milestone: "M4-P13",
    manifest_schema_version: "trade.rd-replay-portfolio-cycle-sequence-accounting-artifact-manifest.v1",
    primary_schema_version: "trade.rd-replay-portfolio-cycle-sequence-accounting-evidence.v1",
    manifest_name: "portfolio-cycle-sequence-accounting-artifact-manifest.json",
    primary_role: "consolidated_accounting_evidence",
    artifact_roles: ["sequence_result", "sequence_artifact_manifest", "cycle_accounting_evidence",
      "consolidated_ledger", "consolidated_journal", "consolidated_trial_balance",
      "consolidated_fingerprint", "consolidated_accounting_evidence"],
  },
]

const EXPECTED_LIMITATIONS = [
  "historical-p10-p11-p13-only",
  "generated-versioned-fixtures-not-production-writer-reactivation",
  "read-model-is-not-current-result-artifact-or-runtime-authority",
]

export function loadReplayHistoricalArtifactMigrationRegistry(
  repoRoot: string,
  path = join(repoRoot, REPLAY_CERTIFICATION_OWNER, "replay-historical-artifact-migration.json"),
): ReplayHistoricalArtifactMigrationRegistry {
  return JSON.parse(readFileSync(path, "utf8")) as ReplayHistoricalArtifactMigrationRegistry
}

export function assertReplayHistoricalArtifactMigrationRegistry(
  registry: ReplayHistoricalArtifactMigrationRegistry,
  repoRoot: string,
): void {
  if (registry.schema_version !== "trade.rd-replay-historical-artifact-migration.v1"
      || registry.owner !== REPLAY_CERTIFICATION_OWNER
      || registry.reader_owner
        !== "apps/research-strategy-development/replay-execution-plane/compatibility/legacy-portfolio-cycle"
      || registry.certification_owner
        !== "apps/research-strategy-development/replay-execution-plane/certification/legacy-portfolio-cycle-certification"
      || registry.migration_policy !== "read-only-summary-no-writer-no-authority-rewrite") {
    throw new Error("unsupported Replay historical Artifact migration registry")
  }
  if (JSON.stringify(registry.historical_artifacts) !== JSON.stringify(EXPECTED_ARTIFACTS)) {
    throw new Error("Replay historical Artifact migration must freeze exact P10/P11/P13 epochs and roles")
  }
  if (JSON.stringify(registry.limitations) !== JSON.stringify(EXPECTED_LIMITATIONS)) {
    throw new Error("Replay historical Artifact migration limitations are incomplete")
  }
  const reader = readSource(repoRoot, registry.reader_path, "reader")
  if (!reader.includes(`export function ${registry.reader_export}`)) {
    throw new Error("Replay historical Artifact reader export is missing")
  }
  const certification = readSource(repoRoot, registry.certification_test_path, "certification")
  for (const testName of registry.certification_test_names) {
    if (!certification.includes(`test(${JSON.stringify(testName)}`)) {
      throw new Error(`Replay historical Artifact certification test is missing: ${testName}`)
    }
  }
  if (registry.registry_sha256 !== replayHistoricalArtifactMigrationRegistryHash(registry)) {
    throw new Error("Replay historical Artifact migration registry hash drifted")
  }
}

export function replayHistoricalArtifactMigrationRegistryHash(
  registry: ReplayHistoricalArtifactMigrationRegistry,
): string {
  const { registry_sha256: _registrySha256, ...body } = registry
  return sha256(stableJson(body))
}

function readSource(repoRoot: string, path: string, kind: string): string {
  if (!path || path.startsWith("/") || path.includes("..")) {
    throw new Error(`Replay historical Artifact ${kind} path is not repo-relative`)
  }
  const absolute = join(repoRoot, path)
  if (!existsSync(absolute)) throw new Error(`Replay historical Artifact ${kind} source is missing`)
  return readFileSync(absolute, "utf8")
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((entry) => stableJson(entry)).join(",")}]`
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`
  }
  return JSON.stringify(value)
}
