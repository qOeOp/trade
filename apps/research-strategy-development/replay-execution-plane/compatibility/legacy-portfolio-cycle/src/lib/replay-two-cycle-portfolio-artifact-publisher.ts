import { createHash } from "node:crypto"
import type { ReplayRuntimeSharedWalletRiskReservationSnapshot } from "../../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import { createReplayRuntimeSharedWalletPortfolioEvidence } from "../../../../accounting/src/lib/replay-runtime-shared-wallet-portfolio-accounting"
import type { ReplayIntegratedPortfolioOutcome } from "../../../../contracts/src/lib/replay-integrated-portfolio-contracts"
import type { ReplayPortfolioAllocationPlan } from "../../../../contracts/src/lib/replay-portfolio-allocation-contracts"
import type { ReplayPortfolioReallocationOutcome } from "../../../../contracts/src/lib/replay-portfolio-reallocation-contracts"
import type { ReplayRuntimeSharedWalletRiskPlan, ReplayRuntimeSharedWalletRiskResult } from "../../../../contracts/src/lib/replay-runtime-shared-wallet-risk-contracts"
import {
  REPLAY_TWO_CYCLE_PORTFOLIO_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  REPLAY_TWO_CYCLE_PORTFOLIO_ARTIFACT_ROLES,
  assertReplayTwoCyclePortfolioArtifactManifest,
  replayTwoCyclePortfolioArtifactManifestHash,
  replayTwoCyclePortfolioFingerprintHash,
  type ReplayTwoCyclePortfolioArtifactManifest,
  type ReplayTwoCyclePortfolioArtifactRole,
  type ReplayTwoCyclePortfolioFingerprint,
  type ReplayTwoCyclePortfolioPlan,
  type ReplayTwoCyclePortfolioResult,
} from "../../../../contracts/src/lib/replay-two-cycle-portfolio-contracts"
import { canonicalHash, canonicalJson } from "../../../../contracts/src/lib/replay-contracts"
import { assertCertifiedReplayArtifactStore, type ReplayArtifactNamespace, type ReplayArtifactStore } from "../../../../runner/src/lib/replay-artifact-store"

const MANIFEST = "two-cycle-portfolio-artifact-manifest.json"
const NAMES: Record<ReplayTwoCyclePortfolioArtifactRole, string> = {
  two_cycle_plan: "two-cycle-plan.json",
  cycle_1_integrated_result: "cycle-1-integrated-result.json",
  cycle_1_artifact_manifest: "cycle-1-artifact-manifest.json",
  cycle_2_reallocation_result: "cycle-2-reallocation-result.json",
  cycle_2_reallocation_manifest: "cycle-2-reallocation-manifest.json",
  cycle_2_allocation_plan: "cycle-2-allocation-plan.json",
  cycle_2_allocation_result: "cycle-2-allocation-result.json",
  cycle_2_risk_plan: "cycle-2-risk-plan.json",
  cycle_2_risk_reservation: "cycle-2-risk-reservation.json",
  cycle_2_risk_result: "cycle-2-risk-result.json",
  cycle_2_portfolio_evidence: "cycle-2-portfolio-evidence.json",
  two_cycle_state_chain: "two-cycle-state-chain.json",
  two_cycle_fingerprint: "two-cycle-fingerprint.json",
  two_cycle_result: "two-cycle-result.json",
}

export interface ReplayTwoCyclePortfolioArtifactPublishInput {
  plan: ReplayTwoCyclePortfolioPlan
  cycle_1: ReplayIntegratedPortfolioOutcome
  cycle_2_reallocation: ReplayPortfolioReallocationOutcome
  cycle_2_allocation_plan: ReplayPortfolioAllocationPlan
  cycle_2_risk_plan: ReplayRuntimeSharedWalletRiskPlan
  cycle_2_risk_reservation: ReplayRuntimeSharedWalletRiskReservationSnapshot
  cycle_2_risk_result: ReplayRuntimeSharedWalletRiskResult
  result: ReplayTwoCyclePortfolioResult
  artifact_store: ReplayArtifactStore
}

export function publishReplayTwoCyclePortfolioArtifact(
  input: ReplayTwoCyclePortfolioArtifactPublishInput,
): { manifest: ReplayTwoCyclePortfolioArtifactManifest; idempotent_replay: boolean } {
  const cycle1Result = input.cycle_1.result
  const cycle1Manifest = input.cycle_1.artifact?.artifact_manifest
  const reallocationResult = input.cycle_2_reallocation.result
  const reallocationManifest = input.cycle_2_reallocation.artifact_manifest
  const allocationResult = input.cycle_2_reallocation.allocation_result
  if (!cycle1Result || !cycle1Manifest || !reallocationResult || !reallocationManifest || !allocationResult) {
    throw new Error("two-cycle child evidence is incomplete")
  }
  const evidence = createReplayRuntimeSharedWalletPortfolioEvidence({
    plan: input.cycle_2_risk_plan,
    risk_reservation: input.cycle_2_risk_reservation,
    risk_result: input.cycle_2_risk_result,
    allocation_result: allocationResult,
  })
  const fingerprintBody: Omit<ReplayTwoCyclePortfolioFingerprint, "fingerprint_hash"> = {
    experiment_id: input.cycle_2_risk_reservation.experiment_id,
    trial_group_id: input.cycle_2_risk_reservation.trial_group_id,
    trial_group_hash: input.cycle_2_risk_reservation.trial_group_hash,
    portfolio_id: input.plan.portfolio_id,
    two_cycle_plan_hash: input.plan.plan_hash,
    cycle_1_integrated_result_hash: cycle1Result.result_hash,
    cycle_1_artifact_manifest_hash: cycle1Manifest.manifest_hash,
    cycle_2_reallocation_result_hash: reallocationResult.result_hash,
    cycle_2_reallocation_manifest_hash: reallocationManifest.manifest_hash,
    cycle_2_allocation_plan_hash: input.cycle_2_allocation_plan.plan_hash,
    cycle_2_allocation_result_hash: allocationResult.result_hash,
    cycle_2_risk_plan_hash: input.cycle_2_risk_plan.plan_hash,
    cycle_2_risk_reservation_hash: input.cycle_2_risk_reservation.reservation_hash,
    cycle_2_risk_result_hash: input.cycle_2_risk_result.result_hash,
    cycle_2_portfolio_evidence_hash: evidence.evidence_hash,
    state_chain_hash: input.result.state_chain_hash,
    two_cycle_result_hash: input.result.result_hash,
    limitations_hash: canonicalHash(input.result.limitations),
  }
  const fingerprint = { ...fingerprintBody,
    fingerprint_hash: replayTwoCyclePortfolioFingerprintHash(fingerprintBody as ReplayTwoCyclePortfolioFingerprint) }
  const values: Record<ReplayTwoCyclePortfolioArtifactRole, unknown> = {
    two_cycle_plan: input.plan,
    cycle_1_integrated_result: cycle1Result,
    cycle_1_artifact_manifest: cycle1Manifest,
    cycle_2_reallocation_result: reallocationResult,
    cycle_2_reallocation_manifest: reallocationManifest,
    cycle_2_allocation_plan: input.cycle_2_allocation_plan,
    cycle_2_allocation_result: allocationResult,
    cycle_2_risk_plan: input.cycle_2_risk_plan,
    cycle_2_risk_reservation: input.cycle_2_risk_reservation,
    cycle_2_risk_result: input.cycle_2_risk_result,
    cycle_2_portfolio_evidence: evidence,
    two_cycle_state_chain: input.result.state_chain,
    two_cycle_fingerprint: fingerprint,
    two_cycle_result: input.result,
  }
  assertCertifiedReplayArtifactStore(input.artifact_store)
  const namespace = input.artifact_store.openAttempt({
    idempotency_key_hash: canonicalHash({ two_cycle_plan_hash: input.plan.plan_hash }),
    attempt_id_hash: input.result.result_hash,
  })
  if (namespace.exists(MANIFEST)) return { manifest: readCommitted(namespace, input, values, fingerprint), idempotent_replay: true }
  const files = REPLAY_TWO_CYCLE_PORTFOLIO_ARTIFACT_ROLES.map((role) => {
    const name = NAMES[role]
    return { role, name, ...namespace.writeImmutable(name, encode(values[role])) }
  })
  const body: Omit<ReplayTwoCyclePortfolioArtifactManifest, "manifest_hash"> = {
    schema_version: REPLAY_TWO_CYCLE_PORTFOLIO_ARTIFACT_MANIFEST_SCHEMA_VERSION,
    artifact_id: `replay-two-cycle-portfolio:${fingerprint.fingerprint_hash}`,
    portfolio_id: input.plan.portfolio_id,
    two_cycle_result_hash: input.result.result_hash,
    fingerprint_hash: fingerprint.fingerprint_hash,
    files,
    completeness: {
      authoritative_result: true,
      required_roles: REPLAY_TWO_CYCLE_PORTFOLIO_ARTIFACT_ROLES,
      commit_marker: MANIFEST,
      partial_payload_without_manifest_is_authoritative: false,
    },
    authority_frozen_at: input.cycle_2_risk_reservation.issued_at,
  }
  const manifest = { ...body,
    manifest_hash: replayTwoCyclePortfolioArtifactManifestHash(body as ReplayTwoCyclePortfolioArtifactManifest) }
  assertReplayTwoCyclePortfolioArtifactManifest(manifest)
  namespace.writeImmutable(MANIFEST, encode(manifest))
  return { manifest, idempotent_replay: false }
}

function readCommitted(
  namespace: ReplayArtifactNamespace,
  input: ReplayTwoCyclePortfolioArtifactPublishInput,
  values: Record<ReplayTwoCyclePortfolioArtifactRole, unknown>,
  fingerprint: ReplayTwoCyclePortfolioFingerprint,
): ReplayTwoCyclePortfolioArtifactManifest {
  const manifest = JSON.parse(new TextDecoder().decode(namespace.read(MANIFEST).bytes)) as ReplayTwoCyclePortfolioArtifactManifest
  assertReplayTwoCyclePortfolioArtifactManifest(manifest)
  if (manifest.two_cycle_result_hash !== input.result.result_hash
      || manifest.fingerprint_hash !== fingerprint.fingerprint_hash) throw new Error("two-cycle manifest identity drift")
  for (const file of manifest.files) {
    const read = namespace.read(file.name)
    if (file.name !== NAMES[file.role] || file.ref !== read.ref || file.sha256 !== sha256(read.bytes)
        || canonicalHash(JSON.parse(new TextDecoder().decode(read.bytes))) !== canonicalHash(values[file.role])) {
      throw new Error("two-cycle artifact payload binding mismatch")
    }
  }
  return manifest
}

function encode(value: unknown): string { return `${canonicalJson(value)}\n` }
function sha256(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex") }
