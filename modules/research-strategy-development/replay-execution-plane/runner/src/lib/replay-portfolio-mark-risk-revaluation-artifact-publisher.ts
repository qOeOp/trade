import { createHash } from "node:crypto"
import {
  REPLAY_PORTFOLIO_MARK_RISK_REVALUATION_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_MARK_RISK_REVALUATION_ARTIFACT_ROLES,
  assertReplayPortfolioMarkRiskRevaluationArtifactManifest,
  replayPortfolioMarkRiskRevaluationArtifactManifestHash,
  type ReplayPortfolioMarkRiskRevaluationArtifactManifest,
  type ReplayPortfolioMarkRiskRevaluationArtifactRole,
  type ReplayPortfolioMarkRiskRevaluationEvidence,
} from "../../../contracts/src/lib/replay-portfolio-mark-risk-revaluation-contracts"
import type {
  ReplayIntegratedPortfolioArtifactManifest,
  ReplayIntegratedPortfolioResult,
} from "../../../contracts/src/lib/replay-integrated-portfolio-contracts"
import type {
  ReplayPortfolioAllocationAuthorityBinding,
  ReplayPortfolioAllocationResult,
} from "../../../contracts/src/lib/replay-portfolio-allocation-contracts"
import type { ReplayPortfolioEvidenceAuthorityBinding } from
  "../../../contracts/src/lib/replay-runtime-shared-wallet-artifact-contracts"
import type { ReplayRuntimeSharedWalletRiskResult } from "../../../contracts/src/lib/replay-runtime-shared-wallet-risk-contracts"
import { canonicalHash, canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import {
  assertCertifiedReplayArtifactStore,
  type ReplayArtifactNamespace,
  type ReplayArtifactStore,
} from "./replay-artifact-store"

const MANIFEST = "portfolio-mark-risk-revaluation-artifact-manifest.json"
const NAMES: Record<ReplayPortfolioMarkRiskRevaluationArtifactRole, string> = {
  integrated_result: "integrated-result.json",
  integrated_artifact_manifest: "integrated-artifact-manifest.json",
  allocation_reservation: "allocation-reservation.json",
  allocation_result: "allocation-result.json",
  risk_result: "risk-result.json",
  revaluation_transitions: "revaluation-transitions.json",
  revaluation_fingerprint: "revaluation-fingerprint.json",
  revaluation_evidence: "revaluation-evidence.json",
}

export interface ReplayPortfolioMarkRiskRevaluationArtifactPublishInput {
  integrated_result: ReplayIntegratedPortfolioResult
  integrated_manifest: ReplayIntegratedPortfolioArtifactManifest
  allocation_reservation: ReplayPortfolioAllocationAuthorityBinding & ReplayPortfolioEvidenceAuthorityBinding
  allocation_result: ReplayPortfolioAllocationResult
  risk_result: ReplayRuntimeSharedWalletRiskResult
  evidence: ReplayPortfolioMarkRiskRevaluationEvidence
  authority_frozen_at: string
  artifact_store: ReplayArtifactStore
}

export function publishReplayPortfolioMarkRiskRevaluationArtifact(
  input: ReplayPortfolioMarkRiskRevaluationArtifactPublishInput,
): { manifest: ReplayPortfolioMarkRiskRevaluationArtifactManifest; idempotent_replay: boolean } {
  const values: Record<ReplayPortfolioMarkRiskRevaluationArtifactRole, unknown> = {
    integrated_result: input.integrated_result,
    integrated_artifact_manifest: input.integrated_manifest,
    allocation_reservation: input.allocation_reservation,
    allocation_result: input.allocation_result,
    risk_result: input.risk_result,
    revaluation_transitions: input.evidence.transitions,
    revaluation_fingerprint: input.evidence.fingerprint,
    revaluation_evidence: input.evidence,
  }
  assertCertifiedReplayArtifactStore(input.artifact_store)
  const namespace = input.artifact_store.openAttempt({
    idempotency_key_hash: canonicalHash({
      integrated_result_hash: input.integrated_result.result_hash,
      revaluation_policy: input.evidence.policy_version,
    }),
    attempt_id_hash: input.evidence.evidence_hash,
  })
  if (namespace.exists(MANIFEST)) {
    return { manifest: readCommitted(namespace, input, values), idempotent_replay: true }
  }
  const files = REPLAY_PORTFOLIO_MARK_RISK_REVALUATION_ARTIFACT_ROLES.map((role) => {
    const name = NAMES[role]
    return { role, name, ...namespace.writeImmutable(name, encode(values[role])) }
  })
  const body: Omit<ReplayPortfolioMarkRiskRevaluationArtifactManifest, "manifest_hash"> = {
    schema_version: REPLAY_PORTFOLIO_MARK_RISK_REVALUATION_ARTIFACT_MANIFEST_SCHEMA_VERSION,
    artifact_id: `replay-portfolio-mark-risk-revaluation:${input.evidence.fingerprint.fingerprint_hash}`,
    portfolio_id: input.integrated_result.portfolio_id,
    revaluation_evidence_hash: input.evidence.evidence_hash,
    revaluation_fingerprint_hash: input.evidence.fingerprint.fingerprint_hash,
    integrated_result_hash: input.integrated_result.result_hash,
    files,
    completeness: {
      authoritative_result: true,
      required_roles: REPLAY_PORTFOLIO_MARK_RISK_REVALUATION_ARTIFACT_ROLES,
      commit_marker: MANIFEST,
      partial_payload_without_manifest_is_authoritative: false,
    },
    authority_frozen_at: input.authority_frozen_at,
  }
  const manifest = {
    ...body,
    manifest_hash: replayPortfolioMarkRiskRevaluationArtifactManifestHash(
      body as ReplayPortfolioMarkRiskRevaluationArtifactManifest,
    ),
  }
  assertReplayPortfolioMarkRiskRevaluationArtifactManifest(manifest)
  namespace.writeImmutable(MANIFEST, encode(manifest))
  return { manifest, idempotent_replay: false }
}

function readCommitted(
  namespace: ReplayArtifactNamespace,
  input: ReplayPortfolioMarkRiskRevaluationArtifactPublishInput,
  values: Record<ReplayPortfolioMarkRiskRevaluationArtifactRole, unknown>,
): ReplayPortfolioMarkRiskRevaluationArtifactManifest {
  const manifest = JSON.parse(
    new TextDecoder().decode(namespace.read(MANIFEST).bytes),
  ) as ReplayPortfolioMarkRiskRevaluationArtifactManifest
  assertReplayPortfolioMarkRiskRevaluationArtifactManifest(manifest)
  if (manifest.revaluation_evidence_hash !== input.evidence.evidence_hash
      || manifest.revaluation_fingerprint_hash !== input.evidence.fingerprint.fingerprint_hash
      || manifest.integrated_result_hash !== input.integrated_result.result_hash) {
    throw new Error("Portfolio Mark Risk Revaluation manifest identity drift")
  }
  for (const file of manifest.files) {
    const read = namespace.read(file.name)
    if (file.name !== NAMES[file.role] || file.ref !== read.ref || file.sha256 !== sha256(read.bytes)
        || canonicalHash(JSON.parse(new TextDecoder().decode(read.bytes))) !== canonicalHash(values[file.role])) {
      throw new Error("Portfolio Mark Risk Revaluation Artifact payload binding mismatch")
    }
  }
  return manifest
}

function encode(value: unknown): string { return `${canonicalJson(value)}\n` }
function sha256(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex") }
