import { createHash } from "node:crypto"
import {
  REPLAY_PORTFOLIO_FIXED_PARTIAL_TERMINAL_ACCOUNTING_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  assertReplayPortfolioFixedPartialTerminalAccountingArtifactManifest,
  assertReplayPortfolioFixedPartialTerminalAccountingEvidence,
  replayPortfolioFixedPartialTerminalAccountingArtifactManifestHash,
  type ReplayPortfolioFixedPartialTerminalAccountingArtifactManifest,
  type ReplayPortfolioFixedPartialTerminalAccountingEvidence,
} from "../../../contracts/src/lib/replay-portfolio-fixed-partial-terminal-accounting-contracts"
import { canonicalHash, canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import { createReplayPortfolioFixedPartialTerminalAccountingEvidence } from
  "../../../accounting/src/lib/replay-portfolio-fixed-partial-terminal-accounting"
import { assertCertifiedReplayArtifactStore, type ReplayArtifactNamespace } from "./replay-artifact-store"
import {
  runReplayPortfolioFixedPartialTerminal,
  type ReplayPortfolioFixedPartialTerminalRunInput,
} from "./replay-portfolio-fixed-partial-terminal-runner"

const MANIFEST = "portfolio-fixed-partial-terminal-accounting-artifact-manifest.json"
const ROLES = ["terminal_artifact_manifest", "terminal_evidence", "ledger", "journal",
  "trial_balance", "accounting_evidence"] as const
const NAMES: Record<typeof ROLES[number], string> = {
  terminal_artifact_manifest: "terminal-artifact-manifest.json", terminal_evidence: "terminal-evidence.json",
  ledger: "ledger.json", journal: "journal.json", trial_balance: "trial-balance.json",
  accounting_evidence: "accounting-evidence.json",
}
export interface ReplayPortfolioFixedPartialTerminalAccountingOutcome {
  status: "completed" | "failed"; evidence: ReplayPortfolioFixedPartialTerminalAccountingEvidence | null
  artifact_manifest: ReplayPortfolioFixedPartialTerminalAccountingArtifactManifest | null
  terminal_evidence: NonNullable<ReturnType<typeof runReplayPortfolioFixedPartialTerminal>["evidence"]> | null
  idempotent_replay: boolean
  failure: { code: "terminal-failed" | "accounting-failed" | "accounting-artifact-failed"
    message: string; partial_result_published: false } | null
}
export function runReplayPortfolioFixedPartialTerminalAccounting(
  input: ReplayPortfolioFixedPartialTerminalRunInput,
): ReplayPortfolioFixedPartialTerminalAccountingOutcome {
  const terminal = runReplayPortfolioFixedPartialTerminal(input)
  if (!terminal.evidence || !terminal.artifact_manifest) return failed("terminal-failed",
    terminal.failure?.message ?? "fixed-partial terminal failed")
  let evidence
  try { evidence = createReplayPortfolioFixedPartialTerminalAccountingEvidence({
    terminal_evidence: terminal.evidence, terminal_manifest: terminal.artifact_manifest,
  }) } catch (error) { return failed("accounting-failed", error) }
  try {
    const published = publishReplayPortfolioFixedPartialTerminalAccountingArtifact({
      terminal_evidence: terminal.evidence, terminal_manifest: terminal.artifact_manifest, evidence,
      authority_frozen_at: input.allocation_reservation.issued_at, artifact_store: input.artifact_store,
    })
    return { status: "completed", evidence, artifact_manifest: published.manifest,
      terminal_evidence: terminal.evidence,
      idempotent_replay: terminal.idempotent_replay && published.idempotent_replay, failure: null }
  } catch (error) { return failed("accounting-artifact-failed", error) }
}
export function publishReplayPortfolioFixedPartialTerminalAccountingArtifact(input: {
  terminal_evidence: NonNullable<ReturnType<typeof runReplayPortfolioFixedPartialTerminal>["evidence"]>
  terminal_manifest: NonNullable<ReturnType<typeof runReplayPortfolioFixedPartialTerminal>["artifact_manifest"]>
  evidence: ReplayPortfolioFixedPartialTerminalAccountingEvidence
  authority_frozen_at: string; artifact_store: ReplayPortfolioFixedPartialTerminalRunInput["artifact_store"]
}) {
  assertReplayPortfolioFixedPartialTerminalAccountingEvidence(input.evidence)
  const values: Record<typeof ROLES[number], unknown> = { terminal_artifact_manifest: input.terminal_manifest,
    terminal_evidence: input.terminal_evidence, ledger: input.evidence.ledger, journal: input.evidence.journal,
    trial_balance: input.evidence.trial_balance, accounting_evidence: input.evidence }
  assertCertifiedReplayArtifactStore(input.artifact_store)
  const namespace = input.artifact_store.openAttempt({ idempotency_key_hash: canonicalHash({
    terminal: input.terminal_evidence.evidence_hash, accounting: input.evidence.accounting_policy_version,
  }), attempt_id_hash: input.evidence.evidence_hash })
  if (namespace.exists(MANIFEST)) return { manifest: readCommitted(namespace, input.evidence, values), idempotent_replay: true }
  const files = ROLES.map((role) => { const name = NAMES[role]
    return { role, name, ...namespace.writeImmutable(name, encode(values[role])) } })
  const body: Omit<ReplayPortfolioFixedPartialTerminalAccountingArtifactManifest, "manifest_hash"> = {
    schema_version: REPLAY_PORTFOLIO_FIXED_PARTIAL_TERMINAL_ACCOUNTING_ARTIFACT_MANIFEST_SCHEMA_VERSION,
    artifact_id: `replay-portfolio-fixed-partial-accounting:${input.evidence.fingerprint.fingerprint_hash}`,
    portfolio_id: input.evidence.portfolio_id, evidence_hash: input.evidence.evidence_hash,
    terminal_evidence_hash: input.terminal_evidence.evidence_hash, files,
    completeness: { authoritative_result: true, required_roles: ROLES, commit_marker: MANIFEST,
      partial_payload_without_manifest_is_authoritative: false }, authority_frozen_at: input.authority_frozen_at,
  }
  const manifest = { ...body, manifest_hash: replayPortfolioFixedPartialTerminalAccountingArtifactManifestHash(body) }
  assertReplayPortfolioFixedPartialTerminalAccountingArtifactManifest(manifest)
  namespace.writeImmutable(MANIFEST, encode(manifest)); return { manifest, idempotent_replay: false }
}
function readCommitted(namespace: ReplayArtifactNamespace,
  evidence: ReplayPortfolioFixedPartialTerminalAccountingEvidence, values: Record<typeof ROLES[number], unknown>) {
  const manifest = JSON.parse(new TextDecoder().decode(namespace.read(MANIFEST).bytes)) as
    ReplayPortfolioFixedPartialTerminalAccountingArtifactManifest
  assertReplayPortfolioFixedPartialTerminalAccountingArtifactManifest(manifest)
  if (manifest.evidence_hash !== evidence.evidence_hash) throw new Error("Fixed-partial accounting manifest identity drift")
  for (const file of manifest.files) { const read = namespace.read(file.name)
    if (file.name !== NAMES[file.role] || read.ref !== file.ref || sha256(read.bytes) !== file.sha256
        || canonicalHash(JSON.parse(new TextDecoder().decode(read.bytes))) !== canonicalHash(values[file.role])) {
      throw new Error("Fixed-partial accounting committed payload drift")
    } }
  return manifest
}
function failed(code: NonNullable<ReplayPortfolioFixedPartialTerminalAccountingOutcome["failure"]>["code"],
  error: unknown): ReplayPortfolioFixedPartialTerminalAccountingOutcome {
  return { status: "failed", evidence: null, artifact_manifest: null, terminal_evidence: null,
    idempotent_replay: false, failure: { code, message: error instanceof Error ? error.message : String(error),
      partial_result_published: false } }
}
function encode(value: unknown): string { return `${canonicalJson(value)}\n` }
function sha256(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex") }
