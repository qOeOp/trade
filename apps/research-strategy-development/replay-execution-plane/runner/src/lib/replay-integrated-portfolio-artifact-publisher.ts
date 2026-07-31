import { createHash } from "node:crypto"
import { createReplayRuntimeSharedWalletPortfolioEvidence } from "../../../accounting/src/lib/replay-runtime-shared-wallet-portfolio-accounting"
import {
  REPLAY_INTEGRATED_PORTFOLIO_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  REPLAY_INTEGRATED_PORTFOLIO_ARTIFACT_OUTCOME_SCHEMA_VERSION,
  REPLAY_INTEGRATED_PORTFOLIO_ARTIFACT_ROLES,
  assertReplayIntegratedPortfolioArtifactManifest,
  assertReplayIntegratedPortfolioArtifactOutcome,
  replayIntegratedPortfolioArtifactManifestHash,
  replayIntegratedPortfolioArtifactOutcomeHash,
  replayIntegratedPortfolioFingerprintHash,
  type ReplayIntegratedPortfolioArtifactManifest,
  type ReplayIntegratedPortfolioArtifactOutcome,
  type ReplayIntegratedPortfolioArtifactRole,
  type ReplayIntegratedPortfolioFingerprint,
  type ReplayIntegratedPortfolioPlan,
  type ReplayIntegratedPortfolioResult,
} from "../../../contracts/src/lib/replay-integrated-portfolio-contracts"
import type { ReplayPortfolioAllocationResult } from "../../../contracts/src/lib/replay-portfolio-allocation-contracts"
import type { ReplayPortfolioAllocationAuthorityBinding } from
  "../../../contracts/src/lib/replay-portfolio-allocation-contracts"
import type { ReplayPortfolioEvidenceAuthorityBinding } from
  "../../../contracts/src/lib/replay-runtime-shared-wallet-artifact-contracts"
import type { ReplayRuntimeSharedWalletRiskPlan, ReplayRuntimeSharedWalletRiskResult } from "../../../contracts/src/lib/replay-runtime-shared-wallet-risk-contracts"
import { canonicalHash, canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import { assertCertifiedReplayArtifactStore, type ReplayArtifactNamespace, type ReplayArtifactStore } from "./replay-artifact-store"

const MANIFEST = "integrated-portfolio-artifact-manifest.json"
const NAMES: Record<ReplayIntegratedPortfolioArtifactRole, string> = {
  integrated_plan: "integrated-plan.json",
  allocation_reservation: "allocation-reservation.json",
  allocation_result: "allocation-result.json",
  risk_reservation: "risk-reservation.json",
  risk_result: "risk-result.json",
  portfolio_evidence: "portfolio-evidence.json",
  integrated_state_chain: "integrated-state-chain.json",
  integrated_fingerprint: "integrated-fingerprint.json",
  integrated_result: "integrated-result.json",
}

export interface ReplayIntegratedPortfolioArtifactPublishInput {
  integrated_plan: ReplayIntegratedPortfolioPlan
  allocation_reservation: ReplayPortfolioAllocationAuthorityBinding & ReplayPortfolioEvidenceAuthorityBinding
  allocation_result: ReplayPortfolioAllocationResult
  risk_plan: ReplayRuntimeSharedWalletRiskPlan
  risk_reservation: ReplayPortfolioEvidenceAuthorityBinding
  risk_result: ReplayRuntimeSharedWalletRiskResult
  integrated_result: ReplayIntegratedPortfolioResult
  artifact_store: ReplayArtifactStore
}

export function publishReplayIntegratedPortfolioArtifact(
  input: ReplayIntegratedPortfolioArtifactPublishInput,
): ReplayIntegratedPortfolioArtifactOutcome {
  let values: Record<ReplayIntegratedPortfolioArtifactRole, unknown>
  let fingerprint: ReplayIntegratedPortfolioFingerprint
  try {
    const evidence = createReplayRuntimeSharedWalletPortfolioEvidence({
      plan: input.risk_plan, risk_reservation: input.risk_reservation,
      risk_result: input.risk_result, allocation_result: input.allocation_result,
    })
    const fingerprintBody: Omit<ReplayIntegratedPortfolioFingerprint, "fingerprint_hash"> = {
      experiment_id: input.risk_reservation.experiment_id,
      trial_group_id: input.risk_reservation.trial_group_id,
      trial_group_hash: input.risk_reservation.trial_group_hash,
      portfolio_id: input.integrated_plan.portfolio_id,
      integrated_plan_hash: input.integrated_plan.plan_hash,
      allocation_plan_hash: input.integrated_plan.allocation_plan_hash,
      allocation_reservation_hash: input.allocation_reservation.reservation_hash,
      allocation_result_hash: input.allocation_result.result_hash,
      risk_plan_hash: input.risk_plan.plan_hash,
      risk_reservation_hash: input.risk_reservation.reservation_hash,
      risk_result_hash: input.risk_result.result_hash,
      portfolio_evidence_hash: evidence.evidence_hash,
      portfolio_evidence_fingerprint_hash: evidence.fingerprint.fingerprint_hash,
      integrated_result_hash: input.integrated_result.result_hash,
      state_chain_hash: input.integrated_result.state_chain_hash,
      limitations_hash: canonicalHash(input.integrated_result.limitations),
    }
    fingerprint = {
      ...fingerprintBody,
      fingerprint_hash: replayIntegratedPortfolioFingerprintHash(fingerprintBody as ReplayIntegratedPortfolioFingerprint),
    }
    values = {
      integrated_plan: input.integrated_plan,
      allocation_reservation: input.allocation_reservation,
      allocation_result: input.allocation_result,
      risk_reservation: input.risk_reservation,
      risk_result: input.risk_result,
      portfolio_evidence: evidence,
      integrated_state_chain: input.integrated_result.state_chain,
      integrated_fingerprint: fingerprint,
      integrated_result: input.integrated_result,
    }
  } catch (error) {
    return failed(input.integrated_plan.portfolio_id, "integrated-evidence-invalid", error)
  }
  try {
    assertCertifiedReplayArtifactStore(input.artifact_store)
    const identity = {
      idempotency_key_hash: canonicalHash({ integrated_plan_hash: input.integrated_plan.plan_hash }),
      attempt_id_hash: input.integrated_result.result_hash,
    }
    const namespace = input.artifact_store.openAttempt(identity)
    if (namespace.exists(MANIFEST)) return readCommitted(namespace, input, values, fingerprint)
    const files = REPLAY_INTEGRATED_PORTFOLIO_ARTIFACT_ROLES.map((role) => {
      const name = NAMES[role]
      return { role, name, ...namespace.writeImmutable(name, encode(values[role])) }
    })
    const body: Omit<ReplayIntegratedPortfolioArtifactManifest, "manifest_hash"> = {
      schema_version: REPLAY_INTEGRATED_PORTFOLIO_ARTIFACT_MANIFEST_SCHEMA_VERSION,
      artifact_id: `replay-integrated-portfolio:${fingerprint.fingerprint_hash}`,
      portfolio_id: input.integrated_plan.portfolio_id,
      integrated_result_hash: input.integrated_result.result_hash,
      integrated_fingerprint_hash: fingerprint.fingerprint_hash,
      files,
      completeness: {
        authoritative_result: true,
        required_roles: REPLAY_INTEGRATED_PORTFOLIO_ARTIFACT_ROLES,
        commit_marker: MANIFEST,
        partial_payload_without_manifest_is_authoritative: false,
      },
      authority_frozen_at: input.risk_reservation.issued_at,
    }
    const manifest = { ...body, manifest_hash: replayIntegratedPortfolioArtifactManifestHash(body as ReplayIntegratedPortfolioArtifactManifest) }
    assertReplayIntegratedPortfolioArtifactManifest(manifest)
    namespace.writeImmutable(MANIFEST, encode(manifest))
    return committed(input.integrated_plan.portfolio_id, manifest, false)
  } catch (error) {
    return failed(input.integrated_plan.portfolio_id, "integrated-artifact-store-failed", error)
  }
}

function readCommitted(
  namespace: ReplayArtifactNamespace,
  input: ReplayIntegratedPortfolioArtifactPublishInput,
  values: Record<ReplayIntegratedPortfolioArtifactRole, unknown>,
  fingerprint: ReplayIntegratedPortfolioFingerprint,
): ReplayIntegratedPortfolioArtifactOutcome {
  const manifest = JSON.parse(new TextDecoder().decode(namespace.read(MANIFEST).bytes)) as ReplayIntegratedPortfolioArtifactManifest
  assertReplayIntegratedPortfolioArtifactManifest(manifest)
  if (manifest.integrated_result_hash !== input.integrated_result.result_hash
      || manifest.integrated_fingerprint_hash !== fingerprint.fingerprint_hash
      || manifest.files.length !== REPLAY_INTEGRATED_PORTFOLIO_ARTIFACT_ROLES.length) throw new Error("integrated manifest identity drift")
  for (const file of manifest.files) {
    const read = namespace.read(file.name)
    if (file.name !== NAMES[file.role] || file.ref !== read.ref || file.sha256 !== sha256(read.bytes)
        || canonicalHash(JSON.parse(new TextDecoder().decode(read.bytes))) !== canonicalHash(values[file.role])) {
      throw new Error("integrated artifact payload binding mismatch")
    }
  }
  return committed(input.integrated_plan.portfolio_id, manifest, true)
}

function committed(portfolioId: string, manifest: ReplayIntegratedPortfolioArtifactManifest, replay: boolean): ReplayIntegratedPortfolioArtifactOutcome {
  const body: Omit<ReplayIntegratedPortfolioArtifactOutcome, "outcome_hash"> = {
    schema_version: REPLAY_INTEGRATED_PORTFOLIO_ARTIFACT_OUTCOME_SCHEMA_VERSION,
    portfolio_id: portfolioId, status: "committed", idempotent_replay: replay,
    artifact_manifest: manifest, failure: null,
  }
  const outcome = { ...body, outcome_hash: replayIntegratedPortfolioArtifactOutcomeHash(body as ReplayIntegratedPortfolioArtifactOutcome) }
  assertReplayIntegratedPortfolioArtifactOutcome(outcome)
  return outcome
}

function failed(portfolioId: string, code: "integrated-evidence-invalid" | "integrated-artifact-store-failed", error: unknown): ReplayIntegratedPortfolioArtifactOutcome {
  const body: Omit<ReplayIntegratedPortfolioArtifactOutcome, "outcome_hash"> = {
    schema_version: REPLAY_INTEGRATED_PORTFOLIO_ARTIFACT_OUTCOME_SCHEMA_VERSION,
    portfolio_id: portfolioId, status: "failed", idempotent_replay: false, artifact_manifest: null,
    failure: { code, message: error instanceof Error ? error.message : String(error), partial_result_published: false },
  }
  const outcome = { ...body, outcome_hash: replayIntegratedPortfolioArtifactOutcomeHash(body as ReplayIntegratedPortfolioArtifactOutcome) }
  assertReplayIntegratedPortfolioArtifactOutcome(outcome)
  return outcome
}

function encode(value: unknown): string { return `${canonicalJson(value)}\n` }
function sha256(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex") }
