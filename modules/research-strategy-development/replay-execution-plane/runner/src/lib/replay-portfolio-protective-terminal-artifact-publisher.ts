import { createHash } from "node:crypto"
import {
  REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ARTIFACT_ROLES,
  assertReplayPortfolioProtectiveTerminalArtifactManifest,
  replayPortfolioProtectiveTerminalArtifactManifestHash,
  type ReplayPortfolioProtectiveTerminalArtifactManifest,
  type ReplayPortfolioProtectiveTerminalArtifactRole,
  type ReplayPortfolioProtectiveTerminalEvidence,
} from "../../../contracts/src/lib/replay-portfolio-protective-terminal-contracts"
import type { ReplayPortfolioMarkRiskRevaluationArtifactManifest } from "../../../contracts/src/lib/replay-portfolio-mark-risk-revaluation-contracts"
import type { ReplayIntegratedPortfolioArtifactManifest } from "../../../contracts/src/lib/replay-integrated-portfolio-contracts"
import type { ReplayPortfolioAllocationResult } from "../../../contracts/src/lib/replay-portfolio-allocation-contracts"
import type { ReplayRuntimeSharedWalletRiskResult } from "../../../contracts/src/lib/replay-runtime-shared-wallet-risk-contracts"
import { canonicalHash, canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import { assertCertifiedReplayArtifactStore, type ReplayArtifactNamespace, type ReplayArtifactStore } from "./replay-artifact-store"

const MANIFEST = "portfolio-protective-terminal-artifact-manifest.json"
const NAMES: Record<ReplayPortfolioProtectiveTerminalArtifactRole, string> = {
  integrated_artifact_manifest: "integrated-artifact-manifest.json",
  mark_risk_revaluation_artifact_manifest: "mark-risk-revaluation-artifact-manifest.json",
  allocation_result: "allocation-result.json",
  risk_result: "risk-result.json",
  protective_terminal_records: "protective-terminal-records.json",
  ohlcv_resolutions: "ohlcv-resolutions.json",
  protective_terminal_fingerprint: "protective-terminal-fingerprint.json",
  protective_terminal_evidence: "protective-terminal-evidence.json",
}

export interface ReplayPortfolioProtectiveTerminalArtifactPublishInput {
  integrated_manifest: ReplayIntegratedPortfolioArtifactManifest
  revaluation_manifest: ReplayPortfolioMarkRiskRevaluationArtifactManifest
  allocation_result: ReplayPortfolioAllocationResult
  risk_result: ReplayRuntimeSharedWalletRiskResult
  evidence: ReplayPortfolioProtectiveTerminalEvidence
  authority_frozen_at: string
  artifact_store: ReplayArtifactStore
}

export function publishReplayPortfolioProtectiveTerminalArtifact(
  input: ReplayPortfolioProtectiveTerminalArtifactPublishInput,
): { manifest: ReplayPortfolioProtectiveTerminalArtifactManifest; idempotent_replay: boolean } {
  const values: Record<ReplayPortfolioProtectiveTerminalArtifactRole, unknown> = {
    integrated_artifact_manifest: input.integrated_manifest,
    mark_risk_revaluation_artifact_manifest: input.revaluation_manifest,
    allocation_result: input.allocation_result,
    risk_result: input.risk_result,
    protective_terminal_records: input.evidence.lane_records,
    ohlcv_resolutions: input.evidence.ohlcv_resolutions,
    protective_terminal_fingerprint: input.evidence.fingerprint,
    protective_terminal_evidence: input.evidence,
  }
  assertCertifiedReplayArtifactStore(input.artifact_store)
  const namespace = input.artifact_store.openAttempt({
    idempotency_key_hash: canonicalHash({
      revaluation_evidence_hash: input.evidence.mark_risk_revaluation_evidence_hash,
      protective_terminal_policy: input.evidence.policy_version,
    }),
    attempt_id_hash: input.evidence.evidence_hash,
  })
  if (namespace.exists(MANIFEST)) {
    return { manifest: readCommitted(namespace, input, values), idempotent_replay: true }
  }
  const files = REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ARTIFACT_ROLES.map((role) => {
    const name = NAMES[role]
    return { role, name, ...namespace.writeImmutable(name, encode(values[role])) }
  })
  const body: Omit<ReplayPortfolioProtectiveTerminalArtifactManifest, "manifest_hash"> = {
    schema_version: REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ARTIFACT_MANIFEST_SCHEMA_VERSION,
    artifact_id: `replay-portfolio-protective-terminal:${input.evidence.fingerprint.fingerprint_hash}`,
    portfolio_id: input.evidence.portfolio_id,
    protective_terminal_evidence_hash: input.evidence.evidence_hash,
    protective_terminal_fingerprint_hash: input.evidence.fingerprint.fingerprint_hash,
    mark_risk_revaluation_evidence_hash: input.evidence.mark_risk_revaluation_evidence_hash,
    files,
    completeness: {
      authoritative_result: true,
      required_roles: REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ARTIFACT_ROLES,
      commit_marker: MANIFEST,
      partial_payload_without_manifest_is_authoritative: false,
    },
    authority_frozen_at: input.authority_frozen_at,
  }
  const manifest = { ...body, manifest_hash: replayPortfolioProtectiveTerminalArtifactManifestHash(body) }
  assertReplayPortfolioProtectiveTerminalArtifactManifest(manifest)
  namespace.writeImmutable(MANIFEST, encode(manifest))
  return { manifest, idempotent_replay: false }
}

function readCommitted(
  namespace: ReplayArtifactNamespace,
  input: ReplayPortfolioProtectiveTerminalArtifactPublishInput,
  values: Record<ReplayPortfolioProtectiveTerminalArtifactRole, unknown>,
): ReplayPortfolioProtectiveTerminalArtifactManifest {
  const manifest = JSON.parse(new TextDecoder().decode(namespace.read(MANIFEST).bytes)) as
    ReplayPortfolioProtectiveTerminalArtifactManifest
  assertReplayPortfolioProtectiveTerminalArtifactManifest(manifest)
  if (manifest.protective_terminal_evidence_hash !== input.evidence.evidence_hash
      || manifest.protective_terminal_fingerprint_hash !== input.evidence.fingerprint.fingerprint_hash
      || manifest.mark_risk_revaluation_evidence_hash !== input.evidence.mark_risk_revaluation_evidence_hash) {
    throw new Error("Portfolio Protective Terminal manifest identity drift")
  }
  for (const file of manifest.files) {
    const read = namespace.read(file.name)
    if (file.name !== NAMES[file.role] || file.ref !== read.ref || file.sha256 !== sha256(read.bytes)
        || canonicalHash(JSON.parse(new TextDecoder().decode(read.bytes))) !== canonicalHash(values[file.role])) {
      throw new Error("Portfolio Protective Terminal Artifact payload binding mismatch")
    }
  }
  return manifest
}

function encode(value: unknown): string { return `${canonicalJson(value)}\n` }
function sha256(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex") }
