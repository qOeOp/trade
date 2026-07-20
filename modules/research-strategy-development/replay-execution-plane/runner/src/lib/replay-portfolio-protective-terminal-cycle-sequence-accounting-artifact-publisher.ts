import { createHash } from "node:crypto"
import {
  REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_ACCOUNTING_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_ACCOUNTING_ARTIFACT_ROLES,
  assertReplayPortfolioProtectiveTerminalCycleSequenceAccountingArtifactManifest,
  replayPortfolioProtectiveTerminalCycleSequenceAccountingArtifactManifestHash,
  type ReplayPortfolioProtectiveTerminalCycleSequenceAccountingArtifactManifest,
  type ReplayPortfolioProtectiveTerminalCycleSequenceAccountingArtifactRole,
  type ReplayPortfolioProtectiveTerminalCycleSequenceAccountingEvidence,
} from "../../../contracts/src/lib/replay-portfolio-protective-terminal-cycle-sequence-accounting-contracts"
import type {
  ReplayPortfolioProtectiveTerminalCycleSequenceArtifactManifest,
  ReplayPortfolioProtectiveTerminalCycleSequenceResult,
} from "../../../contracts/src/lib/replay-portfolio-protective-terminal-cycle-sequence-contracts"
import type {
  ReplayPortfolioProtectiveTerminalAccountingArtifactManifest,
  ReplayPortfolioProtectiveTerminalAccountingEvidence,
} from "../../../contracts/src/lib/replay-portfolio-protective-terminal-accounting-contracts"
import { canonicalHash, canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import {
  assertCertifiedReplayArtifactStore,
  type ReplayArtifactNamespace,
  type ReplayArtifactStore,
} from "./replay-artifact-store"

const MANIFEST = "portfolio-protective-terminal-cycle-sequence-accounting-artifact-manifest.json"
const NAMES: Record<ReplayPortfolioProtectiveTerminalCycleSequenceAccountingArtifactRole, string> = {
  protective_terminal_cycle_sequence_result: "protective-terminal-cycle-sequence-result.json",
  protective_terminal_cycle_sequence_artifact_manifest:
    "protective-terminal-cycle-sequence-artifact-manifest.json",
  cycle_protective_terminal_accounting_artifact_manifests:
    "cycle-protective-terminal-accounting-artifact-manifests.json",
  cycle_protective_terminal_accounting_evidence: "cycle-protective-terminal-accounting-evidence.json",
  consolidated_ledger: "consolidated-ledger.json",
  consolidated_journal: "consolidated-journal.json",
  consolidated_trial_balance: "consolidated-trial-balance.json",
  consolidated_accounting_fingerprint: "consolidated-accounting-fingerprint.json",
  consolidated_accounting_evidence: "consolidated-accounting-evidence.json",
}

export interface ReplayPortfolioProtectiveTerminalCycleSequenceAccountingArtifactPublishInput {
  sequence_result: ReplayPortfolioProtectiveTerminalCycleSequenceResult
  sequence_manifest: ReplayPortfolioProtectiveTerminalCycleSequenceArtifactManifest
  cycle_manifests: ReplayPortfolioProtectiveTerminalAccountingArtifactManifest[]
  cycle_evidence: ReplayPortfolioProtectiveTerminalAccountingEvidence[]
  evidence: ReplayPortfolioProtectiveTerminalCycleSequenceAccountingEvidence
  authority_frozen_at: string
  artifact_store: ReplayArtifactStore
}

export function publishReplayPortfolioProtectiveTerminalCycleSequenceAccountingArtifact(
  input: ReplayPortfolioProtectiveTerminalCycleSequenceAccountingArtifactPublishInput,
): {
  manifest: ReplayPortfolioProtectiveTerminalCycleSequenceAccountingArtifactManifest
  idempotent_replay: boolean
} {
  const values: Record<ReplayPortfolioProtectiveTerminalCycleSequenceAccountingArtifactRole, unknown> = {
    protective_terminal_cycle_sequence_result: input.sequence_result,
    protective_terminal_cycle_sequence_artifact_manifest: input.sequence_manifest,
    cycle_protective_terminal_accounting_artifact_manifests: input.cycle_manifests,
    cycle_protective_terminal_accounting_evidence: input.cycle_evidence,
    consolidated_ledger: input.evidence.consolidated_ledger,
    consolidated_journal: input.evidence.consolidated_journal,
    consolidated_trial_balance: input.evidence.consolidated_trial_balance,
    consolidated_accounting_fingerprint: input.evidence.fingerprint,
    consolidated_accounting_evidence: input.evidence,
  }
  assertCertifiedReplayArtifactStore(input.artifact_store)
  const namespace = input.artifact_store.openAttempt({
    idempotency_key_hash: canonicalHash({
      sequence_result_hash: input.sequence_result.result_hash,
      accounting_policy: input.evidence.consolidated_trial_balance.journal_policy_version,
    }),
    attempt_id_hash: input.evidence.evidence_hash,
  })
  if (namespace.exists(MANIFEST)) {
    return { manifest: readCommitted(namespace, input, values), idempotent_replay: true }
  }
  const files = REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_ACCOUNTING_ARTIFACT_ROLES.map((role) => {
    const name = NAMES[role]
    return { role, name, ...namespace.writeImmutable(name, encode(values[role])) }
  })
  const body: Omit<
    ReplayPortfolioProtectiveTerminalCycleSequenceAccountingArtifactManifest,
    "manifest_hash"
  > = {
    schema_version:
      REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_ACCOUNTING_ARTIFACT_MANIFEST_SCHEMA_VERSION,
    artifact_id:
      `replay-portfolio-protective-terminal-cycle-sequence-accounting:${input.evidence.fingerprint.fingerprint_hash}`,
    portfolio_id: input.sequence_result.portfolio_id,
    accounting_evidence_hash: input.evidence.evidence_hash,
    accounting_fingerprint_hash: input.evidence.fingerprint.fingerprint_hash,
    sequence_result_hash: input.sequence_result.result_hash,
    files,
    completeness: {
      authoritative_result: true,
      required_roles: REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_ACCOUNTING_ARTIFACT_ROLES,
      commit_marker: MANIFEST,
      partial_payload_without_manifest_is_authoritative: false,
    },
    authority_frozen_at: input.authority_frozen_at,
  }
  const manifest = { ...body,
    manifest_hash: replayPortfolioProtectiveTerminalCycleSequenceAccountingArtifactManifestHash(body) }
  assertReplayPortfolioProtectiveTerminalCycleSequenceAccountingArtifactManifest(manifest)
  namespace.writeImmutable(MANIFEST, encode(manifest))
  return { manifest, idempotent_replay: false }
}

function readCommitted(
  namespace: ReplayArtifactNamespace,
  input: ReplayPortfolioProtectiveTerminalCycleSequenceAccountingArtifactPublishInput,
  values: Record<ReplayPortfolioProtectiveTerminalCycleSequenceAccountingArtifactRole, unknown>,
): ReplayPortfolioProtectiveTerminalCycleSequenceAccountingArtifactManifest {
  const manifest = JSON.parse(new TextDecoder().decode(namespace.read(MANIFEST).bytes)) as
    ReplayPortfolioProtectiveTerminalCycleSequenceAccountingArtifactManifest
  assertReplayPortfolioProtectiveTerminalCycleSequenceAccountingArtifactManifest(manifest)
  if (manifest.accounting_evidence_hash !== input.evidence.evidence_hash
      || manifest.accounting_fingerprint_hash !== input.evidence.fingerprint.fingerprint_hash
      || manifest.sequence_result_hash !== input.sequence_result.result_hash) {
    throw new Error("Protective Terminal Cycle Sequence Accounting manifest identity drift")
  }
  for (const file of manifest.files) {
    const read = namespace.read(file.name)
    if (file.name !== NAMES[file.role] || file.ref !== read.ref || file.sha256 !== sha256(read.bytes)
        || canonicalHash(JSON.parse(new TextDecoder().decode(read.bytes))) !== canonicalHash(values[file.role])) {
      throw new Error("Protective Terminal Cycle Sequence Accounting Artifact payload binding mismatch")
    }
  }
  return manifest
}

function encode(value: unknown): string { return `${canonicalJson(value)}\n` }
function sha256(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex") }
