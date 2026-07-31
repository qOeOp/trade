import { createHash } from "node:crypto"
import {
  REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_ARTIFACT_ROLES,
  assertReplayPortfolioProtectiveStopReplacementTerminalArtifactManifest,
  replayPortfolioProtectiveStopReplacementTerminalArtifactManifestHash,
  type ReplayPortfolioProtectiveStopReplacementTerminalArtifactManifest,
  type ReplayPortfolioProtectiveStopReplacementTerminalArtifactRole,
  type ReplayPortfolioProtectiveStopReplacementTerminalEvidence,
} from "../../../contracts/src/lib/replay-portfolio-protective-stop-replacement-terminal-contracts"
import type {
  ReplayPortfolioProtectiveTerminalArtifactManifest,
  ReplayPortfolioProtectiveTerminalEvidence,
} from "../../../contracts/src/lib/replay-portfolio-protective-terminal-contracts"
import { canonicalHash, canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import {
  assertCertifiedReplayArtifactStore,
  type ReplayArtifactNamespace,
  type ReplayArtifactStore,
} from "./replay-artifact-store"

const MANIFEST = "portfolio-protective-stop-replacement-terminal-artifact-manifest.json"
const NAMES: Record<ReplayPortfolioProtectiveStopReplacementTerminalArtifactRole, string> = {
  source_protective_terminal_artifact_manifest: "source-protective-terminal-artifact-manifest.json",
  source_protective_terminal_evidence: "source-protective-terminal-evidence.json",
  replacement_terminal_records: "replacement-terminal-records.json",
  ohlcv_resolutions: "ohlcv-resolutions.json",
  replacement_terminal_fingerprint: "replacement-terminal-fingerprint.json",
  replacement_terminal_evidence: "replacement-terminal-evidence.json",
}

export interface ReplayPortfolioProtectiveStopReplacementTerminalArtifactPublishInput {
  source_manifest: ReplayPortfolioProtectiveTerminalArtifactManifest
  source_evidence: ReplayPortfolioProtectiveTerminalEvidence
  evidence: ReplayPortfolioProtectiveStopReplacementTerminalEvidence
  authority_frozen_at: string
  artifact_store: ReplayArtifactStore
}

export function publishReplayPortfolioProtectiveStopReplacementTerminalArtifact(
  input: ReplayPortfolioProtectiveStopReplacementTerminalArtifactPublishInput,
): { manifest: ReplayPortfolioProtectiveStopReplacementTerminalArtifactManifest; idempotent_replay: boolean } {
  const values: Record<ReplayPortfolioProtectiveStopReplacementTerminalArtifactRole, unknown> = {
    source_protective_terminal_artifact_manifest: input.source_manifest,
    source_protective_terminal_evidence: input.source_evidence,
    replacement_terminal_records: input.evidence.lane_records,
    ohlcv_resolutions: input.evidence.ohlcv_resolutions,
    replacement_terminal_fingerprint: input.evidence.fingerprint,
    replacement_terminal_evidence: input.evidence,
  }
  assertCertifiedReplayArtifactStore(input.artifact_store)
  const namespace = input.artifact_store.openAttempt({
    idempotency_key_hash: canonicalHash({
      source_protective_terminal_evidence_hash: input.source_evidence.evidence_hash,
      replacement_terminal_policy: input.evidence.policy_version,
    }),
    attempt_id_hash: input.evidence.evidence_hash,
  })
  if (namespace.exists(MANIFEST)) return { manifest: readCommitted(namespace, input, values), idempotent_replay: true }
  const files = REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_ARTIFACT_ROLES.map((role) => {
    const name = NAMES[role]
    return { role, name, ...namespace.writeImmutable(name, encode(values[role])) }
  })
  const body: Omit<ReplayPortfolioProtectiveStopReplacementTerminalArtifactManifest, "manifest_hash"> = {
    schema_version: REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_ARTIFACT_MANIFEST_SCHEMA_VERSION,
    artifact_id: `replay-portfolio-protective-stop-replacement-terminal:${input.evidence.fingerprint.fingerprint_hash}`,
    portfolio_id: input.evidence.portfolio_id,
    replacement_terminal_evidence_hash: input.evidence.evidence_hash,
    replacement_terminal_fingerprint_hash: input.evidence.fingerprint.fingerprint_hash,
    source_protective_terminal_evidence_hash: input.source_evidence.evidence_hash,
    source_protective_terminal_artifact_manifest_hash: input.source_manifest.manifest_hash,
    files,
    completeness: {
      authoritative_result: true,
      required_roles: REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_ARTIFACT_ROLES,
      commit_marker: MANIFEST,
      partial_payload_without_manifest_is_authoritative: false,
    },
    authority_frozen_at: input.authority_frozen_at,
  }
  const manifest = {
    ...body,
    manifest_hash: replayPortfolioProtectiveStopReplacementTerminalArtifactManifestHash(body),
  }
  assertReplayPortfolioProtectiveStopReplacementTerminalArtifactManifest(manifest)
  namespace.writeImmutable(MANIFEST, encode(manifest))
  return { manifest, idempotent_replay: false }
}

function readCommitted(
  namespace: ReplayArtifactNamespace,
  input: ReplayPortfolioProtectiveStopReplacementTerminalArtifactPublishInput,
  values: Record<ReplayPortfolioProtectiveStopReplacementTerminalArtifactRole, unknown>,
): ReplayPortfolioProtectiveStopReplacementTerminalArtifactManifest {
  const manifest = JSON.parse(new TextDecoder().decode(namespace.read(MANIFEST).bytes)) as
    ReplayPortfolioProtectiveStopReplacementTerminalArtifactManifest
  assertReplayPortfolioProtectiveStopReplacementTerminalArtifactManifest(manifest)
  if (manifest.replacement_terminal_evidence_hash !== input.evidence.evidence_hash
      || manifest.replacement_terminal_fingerprint_hash !== input.evidence.fingerprint.fingerprint_hash
      || manifest.source_protective_terminal_evidence_hash !== input.source_evidence.evidence_hash
      || manifest.source_protective_terminal_artifact_manifest_hash !== input.source_manifest.manifest_hash) {
    throw new Error("Portfolio replacement terminal manifest identity drift")
  }
  for (const file of manifest.files) {
    const read = namespace.read(file.name)
    if (file.name !== NAMES[file.role] || file.ref !== read.ref || file.sha256 !== sha256(read.bytes)
        || canonicalHash(JSON.parse(new TextDecoder().decode(read.bytes))) !== canonicalHash(values[file.role])) {
      throw new Error("Portfolio replacement terminal Artifact payload binding mismatch")
    }
  }
  return manifest
}

function encode(value: unknown): string { return `${canonicalJson(value)}\n` }
function sha256(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex") }
