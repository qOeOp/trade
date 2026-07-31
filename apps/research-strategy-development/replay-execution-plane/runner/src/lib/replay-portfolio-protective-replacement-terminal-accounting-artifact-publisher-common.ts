import { createHash } from "node:crypto"
import { canonicalHash, canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import {
  assertCertifiedReplayArtifactStore,
  type ReplayArtifactNamespace,
  type ReplayArtifactStore,
} from "./replay-artifact-store"

interface AccountingEvidence {
  portfolio_id: string
  evidence_hash: string
  fingerprint: { fingerprint_hash: string }
  ledger: unknown
  journal: unknown
  trial_balance: unknown
}

export interface ReplayPortfolioProtectiveReplacementTerminalAccountingArtifactCommonInput {
  replacement_terminal_manifest: { manifest_hash: string }
  replacement_terminal_evidence: { evidence_hash: string }
  risk_result: { result_hash: string }
  evidence: AccountingEvidence
  authority_frozen_at: string
  artifact_store: ReplayArtifactStore
}

export interface ReplayPortfolioProtectiveReplacementTerminalAccountingArtifactCommonConfig {
  source_kind?: "replacement" | "cancel"
  schema_version: string
  roles: readonly string[]
  names: Readonly<Record<string, string>>
  manifest_name: string
  artifact_id_prefix: string
  assert_manifest: (value: unknown) => void
}

export function publishReplayPortfolioProtectiveReplacementTerminalAccountingArtifact<T>(
  config: ReplayPortfolioProtectiveReplacementTerminalAccountingArtifactCommonConfig,
  input: ReplayPortfolioProtectiveReplacementTerminalAccountingArtifactCommonInput,
): { manifest: T; idempotent_replay: boolean } {
  const prefix = config.source_kind === "cancel" ? "cancel" : "replacement"
  const values: Record<string, unknown> = {
    [`${prefix}_terminal_artifact_manifest`]: input.replacement_terminal_manifest,
    risk_result: input.risk_result,
    [`${prefix}_terminal_evidence`]: input.replacement_terminal_evidence,
    [`${prefix}_terminal_ledger`]: input.evidence.ledger,
    [`${prefix}_terminal_journal`]: input.evidence.journal,
    [`${prefix}_terminal_trial_balance`]: input.evidence.trial_balance,
    [`${prefix}_terminal_accounting_fingerprint`]: input.evidence.fingerprint,
    [`${prefix}_terminal_accounting_evidence`]: input.evidence,
  }
  assertCertifiedReplayArtifactStore(input.artifact_store)
  const namespace = input.artifact_store.openAttempt({
    idempotency_key_hash: canonicalHash(config.source_kind === "cancel" ? {
      cancel_terminal_evidence_hash: input.replacement_terminal_evidence.evidence_hash,
      cancel_terminal_manifest_hash: input.replacement_terminal_manifest.manifest_hash,
      risk_result_hash: input.risk_result.result_hash,
    } : {
      replacement_terminal_evidence_hash: input.replacement_terminal_evidence.evidence_hash,
      replacement_terminal_manifest_hash: input.replacement_terminal_manifest.manifest_hash,
      risk_result_hash: input.risk_result.result_hash,
    }),
    attempt_id_hash: input.evidence.evidence_hash,
  })
  if (namespace.exists(config.manifest_name)) {
    return { manifest: readCommitted<T>(config, namespace, input, values), idempotent_replay: true }
  }
  const files = config.roles.map((role) => {
    const name = config.names[role]
    if (!name) throw new Error(`Replacement Terminal Accounting Artifact role ${role} has no filename`)
    return { role, name, ...namespace.writeImmutable(name, encode(values[role])) }
  })
  const identity = config.source_kind === "cancel" ? {
    cancel_terminal_accounting_evidence_hash: input.evidence.evidence_hash,
    cancel_terminal_accounting_fingerprint_hash: input.evidence.fingerprint.fingerprint_hash,
    cancel_terminal_evidence_hash: input.replacement_terminal_evidence.evidence_hash,
  } : {
    replacement_terminal_accounting_evidence_hash: input.evidence.evidence_hash,
    replacement_terminal_accounting_fingerprint_hash: input.evidence.fingerprint.fingerprint_hash,
    replacement_terminal_evidence_hash: input.replacement_terminal_evidence.evidence_hash,
  }
  const body = {
    schema_version: config.schema_version,
    artifact_id: `${config.artifact_id_prefix}:${input.evidence.fingerprint.fingerprint_hash}`,
    portfolio_id: input.evidence.portfolio_id,
    ...identity,
    files,
    completeness: {
      authoritative_result: true as const,
      required_roles: config.roles,
      commit_marker: config.manifest_name,
      partial_payload_without_manifest_is_authoritative: false as const,
    },
    authority_frozen_at: input.authority_frozen_at,
  }
  const manifest = { ...body, manifest_hash: canonicalHash(body) }
  config.assert_manifest(manifest)
  namespace.writeImmutable(config.manifest_name, encode(manifest))
  return { manifest: manifest as T, idempotent_replay: false }
}

function readCommitted<T>(config: ReplayPortfolioProtectiveReplacementTerminalAccountingArtifactCommonConfig,
  namespace: ReplayArtifactNamespace,
  input: ReplayPortfolioProtectiveReplacementTerminalAccountingArtifactCommonInput,
  values: Record<string, unknown>): T {
  const manifest = JSON.parse(new TextDecoder().decode(namespace.read(config.manifest_name).bytes)) as {
    replacement_terminal_accounting_evidence_hash?: string
    replacement_terminal_accounting_fingerprint_hash?: string
    replacement_terminal_evidence_hash?: string
    cancel_terminal_accounting_evidence_hash?: string
    cancel_terminal_accounting_fingerprint_hash?: string
    cancel_terminal_evidence_hash?: string
    files: Array<{ role: string; name: string; ref: string; sha256: string }>
  }
  config.assert_manifest(manifest)
  const evidenceHash = config.source_kind === "cancel"
    ? manifest.cancel_terminal_accounting_evidence_hash : manifest.replacement_terminal_accounting_evidence_hash
  const fingerprintHash = config.source_kind === "cancel"
    ? manifest.cancel_terminal_accounting_fingerprint_hash
    : manifest.replacement_terminal_accounting_fingerprint_hash
  const terminalHash = config.source_kind === "cancel"
    ? manifest.cancel_terminal_evidence_hash : manifest.replacement_terminal_evidence_hash
  if (evidenceHash !== input.evidence.evidence_hash
      || fingerprintHash !== input.evidence.fingerprint.fingerprint_hash
      || terminalHash !== input.replacement_terminal_evidence.evidence_hash) {
    throw new Error("Replacement Terminal Accounting manifest identity drift")
  }
  for (const file of manifest.files) {
    const read = namespace.read(file.name)
    if (file.name !== config.names[file.role] || file.ref !== read.ref || file.sha256 !== sha256(read.bytes)
        || canonicalHash(JSON.parse(new TextDecoder().decode(read.bytes)))
          !== canonicalHash(values[file.role])) {
      throw new Error("Replacement Terminal Accounting Artifact payload binding mismatch")
    }
  }
  return manifest as T
}

function encode(value: unknown): string { return `${canonicalJson(value)}\n` }
function sha256(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex") }
