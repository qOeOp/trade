import { createHash } from "node:crypto"
import { canonicalHash, canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import {
  assertCertifiedReplayArtifactStore,
  type ReplayArtifactNamespace,
  type ReplayArtifactStore,
} from "./replay-artifact-store"

interface ReplacementCycle {
  replacement_terminal_manifest: unknown
  replacement_terminal_evidence: unknown
  accounting_manifest: unknown
  accounting_evidence: unknown
}

interface ReplacementCycleEvidence {
  portfolio_id: string
  policy_version: string
  evidence_hash: string
  cycle_commits_hash: string
  consolidated_ledger: unknown
  consolidated_journal: unknown
  consolidated_trial_balance: unknown
  fingerprint: { fingerprint_hash: string }
}

export interface ReplayPortfolioProtectiveReplacementCycleArtifactCommonInput {
  plan: { plan_hash: string }
  reservation: { reservation_hash: string; issued_at: string }
  cycles: ReplacementCycle[]
  evidence: ReplacementCycleEvidence
  artifact_store: ReplayArtifactStore
}

export interface ReplayPortfolioProtectiveReplacementCycleArtifactCommonConfig {
  source_kind?: "replacement" | "cancel"
  schema_version: string
  roles: readonly string[]
  names: Readonly<Record<string, string>>
  manifest_name: string
  artifact_id_prefix: string
  assert_manifest: (value: unknown) => void
}

export function publishReplayPortfolioProtectiveReplacementCycleSequenceArtifact<T>(
  config: ReplayPortfolioProtectiveReplacementCycleArtifactCommonConfig,
  input: ReplayPortfolioProtectiveReplacementCycleArtifactCommonInput,
): { manifest: T; idempotent_replay: boolean } {
  const prefix = config.source_kind === "cancel" ? "cancel" : "replacement"
  const values: Record<string, unknown> = {
    cycle_sequence_plan: input.plan,
    cycle_sequence_reservation: input.reservation,
    [`cycle_${prefix}_terminal_artifact_manifests`]:
      input.cycles.map((cycle) => cycle.replacement_terminal_manifest),
    [`cycle_${prefix}_terminal_evidence`]:
      input.cycles.map((cycle) => cycle.replacement_terminal_evidence),
    [`cycle_${prefix}_terminal_accounting_artifact_manifests`]:
      input.cycles.map((cycle) => cycle.accounting_manifest),
    [`cycle_${prefix}_terminal_accounting_evidence`]:
      input.cycles.map((cycle) => cycle.accounting_evidence),
    consolidated_ledger: input.evidence.consolidated_ledger,
    consolidated_journal: input.evidence.consolidated_journal,
    consolidated_trial_balance: input.evidence.consolidated_trial_balance,
    consolidated_fingerprint: input.evidence.fingerprint,
    [`${prefix}_cycle_sequence_evidence`]: input.evidence,
  }
  assertCertifiedReplayArtifactStore(input.artifact_store)
  const namespace = input.artifact_store.openAttempt({
    idempotency_key_hash: canonicalHash({
      sequence_plan_hash: input.plan.plan_hash,
      sequence_reservation_hash: input.reservation.reservation_hash,
      policy_version: input.evidence.policy_version,
    }),
    attempt_id_hash: input.evidence.evidence_hash,
  })
  if (namespace.exists(config.manifest_name)) {
    return { manifest: readCommitted<T>(config, namespace, input, values), idempotent_replay: true }
  }
  const files = config.roles.map((role) => {
    const name = config.names[role]
    if (!name) throw new Error(`Replacement Cycle Sequence Artifact role ${role} has no filename`)
    return { role, name, ...namespace.writeImmutable(name, encode(values[role])) }
  })
  const body = {
    schema_version: config.schema_version,
    artifact_id: `${config.artifact_id_prefix}:${input.evidence.fingerprint.fingerprint_hash}`,
    portfolio_id: input.evidence.portfolio_id,
    sequence_evidence_hash: input.evidence.evidence_hash,
    sequence_fingerprint_hash: input.evidence.fingerprint.fingerprint_hash,
    cycle_commits_hash: input.evidence.cycle_commits_hash,
    files,
    completeness: {
      authoritative_result: true as const,
      required_roles: config.roles,
      commit_marker: config.manifest_name,
      partial_payload_without_manifest_is_authoritative: false as const,
    },
    authority_frozen_at: input.reservation.issued_at,
  }
  const manifest = { ...body, manifest_hash: canonicalHash(body) }
  config.assert_manifest(manifest)
  namespace.writeImmutable(config.manifest_name, encode(manifest))
  return { manifest: manifest as T, idempotent_replay: false }
}

function readCommitted<T>(config: ReplayPortfolioProtectiveReplacementCycleArtifactCommonConfig,
  namespace: ReplayArtifactNamespace, input: ReplayPortfolioProtectiveReplacementCycleArtifactCommonInput,
  values: Record<string, unknown>): T {
  const manifest = JSON.parse(new TextDecoder().decode(namespace.read(config.manifest_name).bytes)) as {
    sequence_evidence_hash: string
    sequence_fingerprint_hash: string
    cycle_commits_hash: string
    files: Array<{ role: string; name: string; ref: string; sha256: string }>
  }
  config.assert_manifest(manifest)
  if (manifest.sequence_evidence_hash !== input.evidence.evidence_hash
      || manifest.sequence_fingerprint_hash !== input.evidence.fingerprint.fingerprint_hash
      || manifest.cycle_commits_hash !== input.evidence.cycle_commits_hash) {
    throw new Error("Replacement Cycle Sequence manifest identity drift")
  }
  for (const file of manifest.files) {
    const read = namespace.read(file.name)
    if (file.name !== config.names[file.role] || file.ref !== read.ref || file.sha256 !== sha256(read.bytes)
        || canonicalHash(JSON.parse(new TextDecoder().decode(read.bytes)))
          !== canonicalHash(values[file.role])) {
      throw new Error("Replacement Cycle Sequence Artifact payload binding mismatch")
    }
  }
  return manifest as T
}

function encode(value: unknown): string { return `${canonicalJson(value)}\n` }
function sha256(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex") }
