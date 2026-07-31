import { createHash } from "node:crypto"
import {
  REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ACCOUNTING_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ACCOUNTING_ARTIFACT_ROLES,
  assertReplayPortfolioProtectiveTerminalAccountingArtifactManifest,
  replayPortfolioProtectiveTerminalAccountingArtifactManifestHash,
  type ReplayPortfolioProtectiveTerminalAccountingArtifactManifest,
  type ReplayPortfolioProtectiveTerminalAccountingArtifactRole,
  type ReplayPortfolioProtectiveTerminalAccountingEvidence,
} from "../../../contracts/src/lib/replay-portfolio-protective-terminal-accounting-contracts"
import type {
  ReplayPortfolioProtectiveTerminalArtifactManifest,
  ReplayPortfolioProtectiveTerminalEvidence,
} from "../../../contracts/src/lib/replay-portfolio-protective-terminal-contracts"
import type { ReplayRuntimeSharedWalletRiskResult } from "../../../contracts/src/lib/replay-runtime-shared-wallet-risk-contracts"
import { canonicalHash, canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import {
  assertCertifiedReplayArtifactStore,
  type ReplayArtifactNamespace,
  type ReplayArtifactStore,
} from "./replay-artifact-store"

const MANIFEST = "portfolio-protective-terminal-accounting-artifact-manifest.json"
const NAMES: Record<ReplayPortfolioProtectiveTerminalAccountingArtifactRole, string> = {
  protective_terminal_artifact_manifest: "protective-terminal-artifact-manifest.json",
  risk_result: "risk-result.json",
  protective_terminal_evidence: "protective-terminal-evidence.json",
  protective_terminal_ledger: "protective-terminal-ledger.json",
  protective_terminal_journal: "protective-terminal-journal.json",
  protective_terminal_trial_balance: "protective-terminal-trial-balance.json",
  protective_terminal_accounting_fingerprint: "protective-terminal-accounting-fingerprint.json",
  protective_terminal_accounting_evidence: "protective-terminal-accounting-evidence.json",
}

export interface ReplayPortfolioProtectiveTerminalAccountingArtifactPublishInput {
  protective_terminal_manifest: ReplayPortfolioProtectiveTerminalArtifactManifest
  protective_terminal_evidence: ReplayPortfolioProtectiveTerminalEvidence
  risk_result: ReplayRuntimeSharedWalletRiskResult
  evidence: ReplayPortfolioProtectiveTerminalAccountingEvidence
  authority_frozen_at: string
  artifact_store: ReplayArtifactStore
}

export function publishReplayPortfolioProtectiveTerminalAccountingArtifact(
  input: ReplayPortfolioProtectiveTerminalAccountingArtifactPublishInput,
): { manifest: ReplayPortfolioProtectiveTerminalAccountingArtifactManifest; idempotent_replay: boolean } {
  const values: Record<ReplayPortfolioProtectiveTerminalAccountingArtifactRole, unknown> = {
    protective_terminal_artifact_manifest: input.protective_terminal_manifest,
    risk_result: input.risk_result,
    protective_terminal_evidence: input.protective_terminal_evidence,
    protective_terminal_ledger: input.evidence.ledger,
    protective_terminal_journal: input.evidence.journal,
    protective_terminal_trial_balance: input.evidence.trial_balance,
    protective_terminal_accounting_fingerprint: input.evidence.fingerprint,
    protective_terminal_accounting_evidence: input.evidence,
  }
  assertCertifiedReplayArtifactStore(input.artifact_store)
  const namespace = input.artifact_store.openAttempt({
    idempotency_key_hash: canonicalHash({
      protective_terminal_evidence_hash: input.protective_terminal_evidence.evidence_hash,
      accounting_policy: input.evidence.accounting_policy_version,
    }),
    attempt_id_hash: input.evidence.evidence_hash,
  })
  if (namespace.exists(MANIFEST)) {
    return { manifest: readCommitted(namespace, input, values), idempotent_replay: true }
  }
  const files = REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ACCOUNTING_ARTIFACT_ROLES.map((role) => {
    const name = NAMES[role]
    return { role, name, ...namespace.writeImmutable(name, encode(values[role])) }
  })
  const body: Omit<ReplayPortfolioProtectiveTerminalAccountingArtifactManifest, "manifest_hash"> = {
    schema_version: REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ACCOUNTING_ARTIFACT_MANIFEST_SCHEMA_VERSION,
    artifact_id: `replay-portfolio-protective-terminal-accounting:${input.evidence.fingerprint.fingerprint_hash}`,
    portfolio_id: input.evidence.portfolio_id,
    protective_terminal_accounting_evidence_hash: input.evidence.evidence_hash,
    protective_terminal_accounting_fingerprint_hash: input.evidence.fingerprint.fingerprint_hash,
    protective_terminal_evidence_hash: input.protective_terminal_evidence.evidence_hash,
    files,
    completeness: {
      authoritative_result: true,
      required_roles: REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ACCOUNTING_ARTIFACT_ROLES,
      commit_marker: MANIFEST,
      partial_payload_without_manifest_is_authoritative: false,
    },
    authority_frozen_at: input.authority_frozen_at,
  }
  const manifest = {
    ...body,
    manifest_hash: replayPortfolioProtectiveTerminalAccountingArtifactManifestHash(body),
  }
  assertReplayPortfolioProtectiveTerminalAccountingArtifactManifest(manifest)
  namespace.writeImmutable(MANIFEST, encode(manifest))
  return { manifest, idempotent_replay: false }
}

function readCommitted(
  namespace: ReplayArtifactNamespace,
  input: ReplayPortfolioProtectiveTerminalAccountingArtifactPublishInput,
  values: Record<ReplayPortfolioProtectiveTerminalAccountingArtifactRole, unknown>,
): ReplayPortfolioProtectiveTerminalAccountingArtifactManifest {
  const manifest = JSON.parse(new TextDecoder().decode(namespace.read(MANIFEST).bytes)) as
    ReplayPortfolioProtectiveTerminalAccountingArtifactManifest
  assertReplayPortfolioProtectiveTerminalAccountingArtifactManifest(manifest)
  if (manifest.protective_terminal_accounting_evidence_hash !== input.evidence.evidence_hash
      || manifest.protective_terminal_accounting_fingerprint_hash !== input.evidence.fingerprint.fingerprint_hash
      || manifest.protective_terminal_evidence_hash !== input.protective_terminal_evidence.evidence_hash) {
    throw new Error("Portfolio Protective Terminal Accounting manifest identity drift")
  }
  for (const file of manifest.files) {
    const read = namespace.read(file.name)
    if (file.name !== NAMES[file.role] || file.ref !== read.ref || file.sha256 !== sha256(read.bytes)
        || canonicalHash(JSON.parse(new TextDecoder().decode(read.bytes))) !== canonicalHash(values[file.role])) {
      throw new Error("Portfolio Protective Terminal Accounting Artifact payload binding mismatch")
    }
  }
  return manifest
}

function encode(value: unknown): string { return `${canonicalJson(value)}\n` }
function sha256(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex") }
