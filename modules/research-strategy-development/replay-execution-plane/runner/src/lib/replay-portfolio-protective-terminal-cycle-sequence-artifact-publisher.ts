import { createHash } from "node:crypto"
import type { ReplayPortfolioCycleSequenceReservationSnapshot } from
  "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import {
  REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_ARTIFACT_ROLES,
  assertReplayPortfolioProtectiveTerminalCycleSequenceArtifactManifest,
  replayPortfolioProtectiveTerminalCycleSequenceArtifactManifestHash,
  type ReplayPortfolioProtectiveTerminalCycleSequenceArtifactManifest,
  type ReplayPortfolioProtectiveTerminalCycleSequenceArtifactRole,
  type ReplayPortfolioProtectiveTerminalCycleSequenceResult,
} from "../../../contracts/src/lib/replay-portfolio-protective-terminal-cycle-sequence-contracts"
import type { ReplayPortfolioCycleSequencePlan } from
  "../../../contracts/src/lib/replay-portfolio-cycle-sequence-contracts"
import { canonicalHash, canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import {
  assertCertifiedReplayArtifactStore,
  type ReplayArtifactNamespace,
  type ReplayArtifactStore,
} from "./replay-artifact-store"

const MANIFEST = "portfolio-protective-terminal-cycle-sequence-artifact-manifest.json"
const NAMES: Record<ReplayPortfolioProtectiveTerminalCycleSequenceArtifactRole, string> = {
  cycle_sequence_plan: "cycle-sequence-plan.json",
  cycle_sequence_reservation: "cycle-sequence-reservation.json",
  cycle_commits: "cycle-commits.json",
  protective_terminal_cycle_sequence_fingerprint: "protective-terminal-cycle-sequence-fingerprint.json",
  protective_terminal_cycle_sequence_result: "protective-terminal-cycle-sequence-result.json",
}

export interface ReplayPortfolioProtectiveTerminalCycleSequenceArtifactPublishInput {
  plan: ReplayPortfolioCycleSequencePlan
  reservation: ReplayPortfolioCycleSequenceReservationSnapshot
  result: ReplayPortfolioProtectiveTerminalCycleSequenceResult
  artifact_store: ReplayArtifactStore
}

export function publishReplayPortfolioProtectiveTerminalCycleSequenceArtifact(
  input: ReplayPortfolioProtectiveTerminalCycleSequenceArtifactPublishInput,
): { manifest: ReplayPortfolioProtectiveTerminalCycleSequenceArtifactManifest; idempotent_replay: boolean } {
  const values: Record<ReplayPortfolioProtectiveTerminalCycleSequenceArtifactRole, unknown> = {
    cycle_sequence_plan: input.plan,
    cycle_sequence_reservation: input.reservation,
    cycle_commits: input.result.cycle_commits,
    protective_terminal_cycle_sequence_fingerprint: input.result.fingerprint,
    protective_terminal_cycle_sequence_result: input.result,
  }
  assertCertifiedReplayArtifactStore(input.artifact_store)
  const namespace = input.artifact_store.openAttempt({
    idempotency_key_hash: canonicalHash({
      sequence_plan_hash: input.plan.plan_hash,
      policy_version: input.result.policy_version,
    }),
    attempt_id_hash: input.result.result_hash,
  })
  if (namespace.exists(MANIFEST)) {
    return { manifest: readCommitted(namespace, input, values), idempotent_replay: true }
  }
  const files = REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_ARTIFACT_ROLES.map((role) => {
    const name = NAMES[role]
    return { role, name, ...namespace.writeImmutable(name, encode(values[role])) }
  })
  const body: Omit<ReplayPortfolioProtectiveTerminalCycleSequenceArtifactManifest, "manifest_hash"> = {
    schema_version: REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_ARTIFACT_MANIFEST_SCHEMA_VERSION,
    artifact_id: `replay-portfolio-protective-terminal-cycle-sequence:${input.result.fingerprint.fingerprint_hash}`,
    portfolio_id: input.result.portfolio_id,
    sequence_result_hash: input.result.result_hash,
    sequence_fingerprint_hash: input.result.fingerprint.fingerprint_hash,
    cycle_commits_hash: input.result.cycle_commits_hash,
    files,
    completeness: {
      authoritative_result: true,
      required_roles: REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_ARTIFACT_ROLES,
      commit_marker: MANIFEST,
      partial_payload_without_manifest_is_authoritative: false,
    },
    authority_frozen_at: input.reservation.issued_at,
  }
  const manifest = { ...body,
    manifest_hash: replayPortfolioProtectiveTerminalCycleSequenceArtifactManifestHash(body) }
  assertReplayPortfolioProtectiveTerminalCycleSequenceArtifactManifest(manifest)
  namespace.writeImmutable(MANIFEST, encode(manifest))
  return { manifest, idempotent_replay: false }
}

function readCommitted(
  namespace: ReplayArtifactNamespace,
  input: ReplayPortfolioProtectiveTerminalCycleSequenceArtifactPublishInput,
  values: Record<ReplayPortfolioProtectiveTerminalCycleSequenceArtifactRole, unknown>,
): ReplayPortfolioProtectiveTerminalCycleSequenceArtifactManifest {
  const manifest = JSON.parse(new TextDecoder().decode(namespace.read(MANIFEST).bytes)) as
    ReplayPortfolioProtectiveTerminalCycleSequenceArtifactManifest
  assertReplayPortfolioProtectiveTerminalCycleSequenceArtifactManifest(manifest)
  if (manifest.sequence_result_hash !== input.result.result_hash
      || manifest.sequence_fingerprint_hash !== input.result.fingerprint.fingerprint_hash
      || manifest.cycle_commits_hash !== input.result.cycle_commits_hash) {
    throw new Error("Portfolio Protective Terminal Cycle Sequence manifest identity drift")
  }
  for (const file of manifest.files) {
    const read = namespace.read(file.name)
    if (file.name !== NAMES[file.role] || file.ref !== read.ref || file.sha256 !== sha256(read.bytes)
        || canonicalHash(JSON.parse(new TextDecoder().decode(read.bytes))) !== canonicalHash(values[file.role])) {
      throw new Error("Portfolio Protective Terminal Cycle Sequence Artifact payload binding mismatch")
    }
  }
  return manifest
}

function encode(value: unknown): string { return `${canonicalJson(value)}\n` }
function sha256(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex") }
