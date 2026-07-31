import { readFileSync } from "node:fs"
import {
  REPLAY_PORTFOLIO_CYCLE_SEQUENCE_ACCOUNTING_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  assertReplayPortfolioCycleSequenceAccountingArtifactManifest,
  type ReplayPortfolioCycleSequenceAccountingArtifactManifest,
} from "../../../../contracts/src/lib/replay-portfolio-cycle-sequence-accounting-contracts"
import {
  REPLAY_PORTFOLIO_REALLOCATION_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  assertReplayPortfolioReallocationArtifactManifest,
  type ReplayPortfolioReallocationArtifactManifest,
} from "../../../../contracts/src/lib/replay-portfolio-reallocation-contracts"
import { canonicalHash } from "../../../../contracts/src/lib/replay-contracts"
import {
  REPLAY_TWO_CYCLE_PORTFOLIO_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  assertReplayTwoCyclePortfolioArtifactManifest,
  type ReplayTwoCyclePortfolioArtifactManifest,
} from "../../../../contracts/src/lib/replay-two-cycle-portfolio-contracts"

export const HISTORICAL_ARTIFACT_READ_MIGRATION_FIXTURE_SCHEMA_VERSION =
  "trade.rd-replay-historical-artifact-read-migration-fixture-pack.v1" as const
export const HISTORICAL_ARTIFACT_READ_MIGRATION_OWNER =
  "apps/research-strategy-development/replay-execution-plane/certification/legacy-portfolio-cycle-certification" as const

export type HistoricalArtifactCapability = "M4-P10" | "M4-P11" | "M4-P13"

type HistoricalArtifactManifest =
  | ReplayPortfolioReallocationArtifactManifest
  | ReplayTwoCyclePortfolioArtifactManifest
  | ReplayPortfolioCycleSequenceAccountingArtifactManifest

export interface HistoricalArtifactReadProjection {
  capability: HistoricalArtifactCapability
  source_schema_version: string
  artifact_id: string
  portfolio_id: string
  primary_result_hash: string
  evidence_hashes: string[]
  manifest_hash: string
  roles: string[]
  commit_marker: string
  authority_frozen_at: string
  migration_status: "readable-legacy-no-write"
}

export interface HistoricalArtifactFixtureEntry {
  capability: HistoricalArtifactCapability
  manifest: HistoricalArtifactManifest
  expected_projection: HistoricalArtifactReadProjection
}

export interface HistoricalArtifactReadMigrationFixturePack {
  schema_version: typeof HISTORICAL_ARTIFACT_READ_MIGRATION_FIXTURE_SCHEMA_VERSION
  owner: typeof HISTORICAL_ARTIFACT_READ_MIGRATION_OWNER
  read_policy: {
    mode: "read-only"
    schema_dispatch: "exact-known-version-only"
    projection: "identity-integrity-and-commit-state-only"
    economic_reinterpretation: "forbidden"
    current_epoch_write: "forbidden"
    unknown_schema: "fail-closed"
  }
  artifacts: HistoricalArtifactFixtureEntry[]
  limitations: [
    "synthetic-frozen-manifests-without-payload-bytes",
    "payload-byte-rehydration-and-economic-upgrade-not-certified",
    "current-result-v53-and-artifact-v55-writers-not-invoked",
  ]
  pack_hash: string
}

const EXPECTED_CAPABILITIES: HistoricalArtifactCapability[] = ["M4-P10", "M4-P11", "M4-P13"]

export function loadHistoricalArtifactReadMigrationFixturePack(
  path: string,
): HistoricalArtifactReadMigrationFixturePack {
  return JSON.parse(readFileSync(path, "utf8")) as HistoricalArtifactReadMigrationFixturePack
}

export function historicalArtifactReadMigrationFixturePackHash(
  value: HistoricalArtifactReadMigrationFixturePack,
): string {
  const { pack_hash: _hash, ...body } = value
  return canonicalHash(body)
}

export function readHistoricalArtifactManifest(
  capability: HistoricalArtifactCapability,
  manifest: HistoricalArtifactManifest,
): HistoricalArtifactReadProjection {
  if (capability === "M4-P10") {
    if (manifest.schema_version !== REPLAY_PORTFOLIO_REALLOCATION_ARTIFACT_MANIFEST_SCHEMA_VERSION) {
      throw new Error("Historical Artifact reader P10 schema is not the exact frozen version")
    }
    const value = manifest as ReplayPortfolioReallocationArtifactManifest
    assertReplayPortfolioReallocationArtifactManifest(value)
    return projection(capability, value, value.reallocation_result_hash, [])
  }
  if (capability === "M4-P11") {
    if (manifest.schema_version !== REPLAY_TWO_CYCLE_PORTFOLIO_ARTIFACT_MANIFEST_SCHEMA_VERSION) {
      throw new Error("Historical Artifact reader P11 schema is not the exact frozen version")
    }
    const value = manifest as ReplayTwoCyclePortfolioArtifactManifest
    assertReplayTwoCyclePortfolioArtifactManifest(value)
    return projection(capability, value, value.two_cycle_result_hash, [value.fingerprint_hash])
  }
  if (capability === "M4-P13") {
    if (manifest.schema_version
        !== REPLAY_PORTFOLIO_CYCLE_SEQUENCE_ACCOUNTING_ARTIFACT_MANIFEST_SCHEMA_VERSION) {
      throw new Error("Historical Artifact reader P13 schema is not the exact frozen version")
    }
    const value = manifest as ReplayPortfolioCycleSequenceAccountingArtifactManifest
    assertReplayPortfolioCycleSequenceAccountingArtifactManifest(value)
    return projection(capability, value, value.sequence_result_hash, [
      value.accounting_evidence_hash,
      value.accounting_fingerprint_hash,
    ])
  }
  throw new Error("Historical Artifact reader capability is not certified")
}

export function assertHistoricalArtifactReadMigrationFixturePack(
  pack: HistoricalArtifactReadMigrationFixturePack,
): void {
  if (pack.schema_version !== HISTORICAL_ARTIFACT_READ_MIGRATION_FIXTURE_SCHEMA_VERSION
      || pack.owner !== HISTORICAL_ARTIFACT_READ_MIGRATION_OWNER
      || pack.read_policy.mode !== "read-only"
      || pack.read_policy.schema_dispatch !== "exact-known-version-only"
      || pack.read_policy.projection !== "identity-integrity-and-commit-state-only"
      || pack.read_policy.economic_reinterpretation !== "forbidden"
      || pack.read_policy.current_epoch_write !== "forbidden"
      || pack.read_policy.unknown_schema !== "fail-closed"
      || JSON.stringify(pack.artifacts.map((entry) => entry.capability))
        !== JSON.stringify(EXPECTED_CAPABILITIES)
      || new Set(pack.artifacts.map((entry) => entry.capability)).size !== EXPECTED_CAPABILITIES.length
      || JSON.stringify(pack.limitations) !== JSON.stringify([
        "synthetic-frozen-manifests-without-payload-bytes",
        "payload-byte-rehydration-and-economic-upgrade-not-certified",
        "current-result-v53-and-artifact-v55-writers-not-invoked",
      ])
      || pack.pack_hash !== historicalArtifactReadMigrationFixturePackHash(pack)) {
    throw new Error("Historical Artifact read migration fixture pack policy/hash drifted")
  }
  for (const entry of pack.artifacts) {
    const projectionValue = readHistoricalArtifactManifest(entry.capability, entry.manifest)
    if (JSON.stringify(projectionValue) !== JSON.stringify(entry.expected_projection)) {
      throw new Error(`Historical Artifact projection drifted: ${entry.capability}`)
    }
  }
}

function projection(
  capability: HistoricalArtifactCapability,
  manifest: HistoricalArtifactManifest,
  primaryResultHash: string,
  evidenceHashes: string[],
): HistoricalArtifactReadProjection {
  return {
    capability,
    source_schema_version: manifest.schema_version,
    artifact_id: manifest.artifact_id,
    portfolio_id: manifest.portfolio_id,
    primary_result_hash: primaryResultHash,
    evidence_hashes: evidenceHashes,
    manifest_hash: manifest.manifest_hash,
    roles: manifest.files.map((file) => file.role),
    commit_marker: manifest.completeness.commit_marker,
    authority_frozen_at: manifest.authority_frozen_at,
    migration_status: "readable-legacy-no-write",
  }
}
