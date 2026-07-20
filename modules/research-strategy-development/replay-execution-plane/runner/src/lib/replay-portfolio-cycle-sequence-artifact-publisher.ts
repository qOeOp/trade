import { createHash } from "node:crypto"
import type { ReplayPortfolioCycleSequenceReservationSnapshot } from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import {
  REPLAY_PORTFOLIO_CYCLE_SEQUENCE_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_CYCLE_SEQUENCE_ARTIFACT_ROLES,
  assertReplayPortfolioCycleSequenceArtifactManifest,
  replayPortfolioCycleSequenceArtifactManifestHash,
  replayPortfolioCycleSequenceFingerprintHash,
  type ReplayPortfolioCycleSequenceArtifactManifest,
  type ReplayPortfolioCycleSequenceArtifactRole,
  type ReplayPortfolioCycleSequenceExecutionInput,
  type ReplayPortfolioCycleSequenceFingerprint,
  type ReplayPortfolioCycleSequencePlan,
  type ReplayPortfolioCycleSequenceResult,
} from "../../../contracts/src/lib/replay-portfolio-cycle-sequence-contracts"
import { canonicalHash, canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import {
  assertCertifiedReplayArtifactStore,
  type ReplayArtifactNamespace,
  type ReplayArtifactStore,
} from "./replay-artifact-store"

const MANIFEST = "portfolio-cycle-sequence-artifact-manifest.json"
const NAMES: Record<ReplayPortfolioCycleSequenceArtifactRole, string> = {
  cycle_sequence_plan: "cycle-sequence-plan.json",
  cycle_sequence_reservation: "cycle-sequence-reservation.json",
  cycle_evidence: "cycle-evidence.json",
  cycle_sequence_state_chain: "cycle-sequence-state-chain.json",
  cycle_sequence_fingerprint: "cycle-sequence-fingerprint.json",
  cycle_sequence_result: "cycle-sequence-result.json",
}

export interface ReplayPortfolioCycleSequenceArtifactPublishInput {
  plan: ReplayPortfolioCycleSequencePlan
  reservation: ReplayPortfolioCycleSequenceReservationSnapshot
  executions: ReplayPortfolioCycleSequenceExecutionInput[]
  result: ReplayPortfolioCycleSequenceResult
  artifact_store: ReplayArtifactStore
}

export function publishReplayPortfolioCycleSequenceArtifact(
  input: ReplayPortfolioCycleSequenceArtifactPublishInput,
): { manifest: ReplayPortfolioCycleSequenceArtifactManifest; idempotent_replay: boolean } {
  const cycleEvidence = input.executions.map((execution) => ({
    cycle_index: execution.cycle_index,
    integrated_plan: execution.integrated_plan,
    allocation_plan: execution.allocation_plan,
    allocation_result: execution.allocation_result,
    risk_plan: execution.risk_plan,
    risk_result: execution.risk_result,
    portfolio_evidence: execution.portfolio_evidence,
    integrated_result: execution.integrated_result,
  }))
  const fingerprintBody: Omit<ReplayPortfolioCycleSequenceFingerprint, "fingerprint_hash"> = {
    experiment_id: input.reservation.experiment_id,
    trial_group_id: input.reservation.trial_group_id,
    trial_group_hash: input.reservation.trial_group_hash,
    portfolio_id: input.plan.portfolio_id,
    sequence_reservation_hash: input.reservation.reservation_hash,
    sequence_plan_hash: input.plan.plan_hash,
    cycle_count: input.result.cycle_count,
    cycle_records_hash: input.result.cycle_records_hash,
    state_chain_hash: input.result.state_chain_hash,
    sequence_result_hash: input.result.result_hash,
    limitations_hash: canonicalHash(input.result.limitations),
  }
  const fingerprint = { ...fingerprintBody,
    fingerprint_hash: replayPortfolioCycleSequenceFingerprintHash(
      fingerprintBody as ReplayPortfolioCycleSequenceFingerprint,
    ) }
  const values: Record<ReplayPortfolioCycleSequenceArtifactRole, unknown> = {
    cycle_sequence_plan: input.plan,
    cycle_sequence_reservation: input.reservation,
    cycle_evidence: cycleEvidence,
    cycle_sequence_state_chain: input.result.state_chain,
    cycle_sequence_fingerprint: fingerprint,
    cycle_sequence_result: input.result,
  }
  assertCertifiedReplayArtifactStore(input.artifact_store)
  const namespace = input.artifact_store.openAttempt({
    idempotency_key_hash: canonicalHash({ sequence_plan_hash: input.plan.plan_hash }),
    attempt_id_hash: input.result.result_hash,
  })
  if (namespace.exists(MANIFEST)) {
    return { manifest: readCommitted(namespace, input, values, fingerprint), idempotent_replay: true }
  }
  const files = REPLAY_PORTFOLIO_CYCLE_SEQUENCE_ARTIFACT_ROLES.map((role) => {
    const name = NAMES[role]
    return { role, name, ...namespace.writeImmutable(name, encode(values[role])) }
  })
  const body: Omit<ReplayPortfolioCycleSequenceArtifactManifest, "manifest_hash"> = {
    schema_version: REPLAY_PORTFOLIO_CYCLE_SEQUENCE_ARTIFACT_MANIFEST_SCHEMA_VERSION,
    artifact_id: `replay-portfolio-cycle-sequence:${fingerprint.fingerprint_hash}`,
    portfolio_id: input.plan.portfolio_id,
    sequence_result_hash: input.result.result_hash,
    fingerprint_hash: fingerprint.fingerprint_hash,
    files,
    completeness: {
      authoritative_result: true,
      required_roles: REPLAY_PORTFOLIO_CYCLE_SEQUENCE_ARTIFACT_ROLES,
      commit_marker: MANIFEST,
      partial_payload_without_manifest_is_authoritative: false,
    },
    authority_frozen_at: input.reservation.issued_at,
  }
  const manifest = { ...body,
    manifest_hash: replayPortfolioCycleSequenceArtifactManifestHash(
      body as ReplayPortfolioCycleSequenceArtifactManifest,
    ) }
  assertReplayPortfolioCycleSequenceArtifactManifest(manifest)
  namespace.writeImmutable(MANIFEST, encode(manifest))
  return { manifest, idempotent_replay: false }
}

function readCommitted(
  namespace: ReplayArtifactNamespace,
  input: ReplayPortfolioCycleSequenceArtifactPublishInput,
  values: Record<ReplayPortfolioCycleSequenceArtifactRole, unknown>,
  fingerprint: ReplayPortfolioCycleSequenceFingerprint,
): ReplayPortfolioCycleSequenceArtifactManifest {
  const manifest = JSON.parse(
    new TextDecoder().decode(namespace.read(MANIFEST).bytes),
  ) as ReplayPortfolioCycleSequenceArtifactManifest
  assertReplayPortfolioCycleSequenceArtifactManifest(manifest)
  if (manifest.sequence_result_hash !== input.result.result_hash
      || manifest.fingerprint_hash !== fingerprint.fingerprint_hash) {
    throw new Error("cycle sequence manifest identity drift")
  }
  for (const file of manifest.files) {
    const read = namespace.read(file.name)
    if (file.name !== NAMES[file.role] || file.ref !== read.ref || file.sha256 !== sha256(read.bytes)
        || canonicalHash(JSON.parse(new TextDecoder().decode(read.bytes))) !== canonicalHash(values[file.role])) {
      throw new Error("cycle sequence artifact payload binding mismatch")
    }
  }
  return manifest
}

function encode(value: unknown): string { return `${canonicalJson(value)}\n` }
function sha256(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex") }
