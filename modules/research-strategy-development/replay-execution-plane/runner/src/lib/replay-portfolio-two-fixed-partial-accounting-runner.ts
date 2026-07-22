import { createHash } from "node:crypto"
import {
  REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_ACCOUNTING_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_ACCOUNTING_ARTIFACT_ROLES,
  assertReplayPortfolioTwoFixedPartialAccountingArtifactManifest,
  assertReplayPortfolioTwoFixedPartialAccountingEvidence,
  replayPortfolioTwoFixedPartialAccountingArtifactManifestHash,
  type ReplayPortfolioTwoFixedPartialAccountingArtifactManifest,
  type ReplayPortfolioTwoFixedPartialAccountingArtifactRole,
  type ReplayPortfolioTwoFixedPartialAccountingEvidence,
} from "../../../contracts/src/lib/replay-portfolio-two-fixed-partial-accounting-contracts"
import type { ReplayPortfolioTwoFixedPartialTerminalEvidence } from
  "../../../contracts/src/lib/replay-portfolio-two-fixed-partial-terminal-contracts"
import { canonicalHash, canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import { createReplayPortfolioTwoFixedPartialAccountingEvidence } from
  "../../../accounting/src/lib/replay-portfolio-two-fixed-partial-accounting"
import { assertReplayPortfolioTwoFixedPartialReservationSnapshot } from
  "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import { assertCertifiedReplayArtifactStore, type ReplayArtifactNamespace,
  type ReplayArtifactStore } from "./replay-artifact-store"
import {
  runReplayPortfolioTwoFixedPartialTerminalProjection,
  type ReplayPortfolioTwoFixedPartialProjectionInput,
  type ReplayPortfolioTwoFixedPartialProjectionResult,
} from "./replay-portfolio-two-fixed-partial-terminal-runner"

const MANIFEST = "portfolio-two-fixed-partial-accounting-artifact-manifest.json"
const NAMES: Record<ReplayPortfolioTwoFixedPartialAccountingArtifactRole, string> = {
  reservation: "reservation.json",
  lane_result_artifact_manifests: "lane-result-artifact-manifests.json",
  lane_results: "lane-results.json",
  terminal_evidence: "terminal-evidence.json",
  ledger: "ledger.json",
  journal: "journal.json",
  trial_balance: "trial-balance.json",
  accounting_evidence: "accounting-evidence.json",
}

export interface ReplayPortfolioTwoFixedPartialAccountingRunInput
  extends ReplayPortfolioTwoFixedPartialProjectionInput { artifact_store: ReplayArtifactStore }
export interface ReplayPortfolioTwoFixedPartialAccountingOutcome {
  status: "completed" | "failed"
  evidence: ReplayPortfolioTwoFixedPartialAccountingEvidence | null
  terminal_evidence: ReplayPortfolioTwoFixedPartialTerminalEvidence | null
  lane_results: ReplayPortfolioTwoFixedPartialProjectionResult["lane_results"] | null
  artifact_manifest: ReplayPortfolioTwoFixedPartialAccountingArtifactManifest | null
  idempotent_replay: boolean
  failure: { code: "terminal-projection-failed" | "accounting-projection-failed" | "artifact-publication-failed"
    message: string; partial_portfolio_result_published: false } | null
}

export function runReplayPortfolioTwoFixedPartialTerminalAccounting(
  input: ReplayPortfolioTwoFixedPartialAccountingRunInput,
): ReplayPortfolioTwoFixedPartialAccountingOutcome {
  let projection: ReplayPortfolioTwoFixedPartialProjectionResult
  try { projection = runReplayPortfolioTwoFixedPartialTerminalProjection(input) }
  catch (error) { return failed("terminal-projection-failed", error) }
  let evidence: ReplayPortfolioTwoFixedPartialAccountingEvidence
  try {
    evidence = createReplayPortfolioTwoFixedPartialAccountingEvidence({
      authority: input.authority, terminal_evidence: projection.evidence, lane_results: projection.lane_results,
    })
  } catch (error) { return failed("accounting-projection-failed", error) }
  try {
    const published = publishReplayPortfolioTwoFixedPartialAccountingArtifact({
      authority: input.authority, projection, evidence, artifact_store: input.artifact_store,
    })
    return { status: "completed", evidence, terminal_evidence: projection.evidence,
      lane_results: projection.lane_results,
      artifact_manifest: published.manifest,
      idempotent_replay: projection.idempotent_replay && published.idempotent_replay, failure: null }
  } catch (error) { return failed("artifact-publication-failed", error) }
}

export function publishReplayPortfolioTwoFixedPartialAccountingArtifact(input: {
  authority: ReplayPortfolioTwoFixedPartialAccountingRunInput["authority"]
  projection: ReplayPortfolioTwoFixedPartialProjectionResult
  evidence: ReplayPortfolioTwoFixedPartialAccountingEvidence
  artifact_store: ReplayArtifactStore
}) {
  assertReplayPortfolioTwoFixedPartialReservationSnapshot(input.authority)
  assertReplayPortfolioTwoFixedPartialAccountingEvidence(input.evidence)
  if (input.evidence.reservation_hash !== input.authority.reservation_hash
      || input.evidence.terminal_evidence_hash !== input.projection.evidence.evidence_hash) {
    throw new Error("Portfolio two-fixed-partial Artifact source closure drift")
  }
  assertCertifiedReplayArtifactStore(input.artifact_store)
  const laneManifests = input.projection.lane_results.map((lane) => ({ lane_id: lane.lane_id,
    artifact_manifest: lane.artifact_manifest }))
  const laneResults = input.projection.lane_results.map((lane) => ({ lane_id: lane.lane_id,
    result: lane.result }))
  const values: Record<ReplayPortfolioTwoFixedPartialAccountingArtifactRole, unknown> = {
    reservation: input.authority, lane_result_artifact_manifests: laneManifests,
    lane_results: laneResults, terminal_evidence: input.projection.evidence,
    ledger: input.evidence.ledger, journal: input.evidence.journal,
    trial_balance: input.evidence.trial_balance, accounting_evidence: input.evidence,
  }
  const namespace = input.artifact_store.openAttempt({
    idempotency_key_hash: canonicalHash({ reservation_hash: input.authority.reservation_hash,
      terminal_evidence_hash: input.projection.evidence.evidence_hash,
      accounting_policy_version: input.evidence.accounting_policy_version }),
    attempt_id_hash: input.evidence.evidence_hash,
  })
  if (namespace.exists(MANIFEST)) return {
    manifest: readCommitted(namespace, input.evidence, values), idempotent_replay: true,
  }
  const files = REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_ACCOUNTING_ARTIFACT_ROLES.map((role) => {
    const name = NAMES[role]
    return { role, name, ...namespace.writeImmutable(name, encode(values[role])) }
  })
  const body: Omit<ReplayPortfolioTwoFixedPartialAccountingArtifactManifest, "manifest_hash"> = {
    schema_version: REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_ACCOUNTING_ARTIFACT_MANIFEST_SCHEMA_VERSION,
    artifact_id: `replay-portfolio-two-fixed-partial-accounting:${input.evidence.fingerprint_hash}`,
    portfolio_id: input.evidence.portfolio_id, reservation_hash: input.authority.reservation_hash,
    terminal_evidence_hash: input.projection.evidence.evidence_hash,
    accounting_evidence_hash: input.evidence.evidence_hash, files,
    completeness: { authoritative_result: true,
      required_roles: REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_ACCOUNTING_ARTIFACT_ROLES,
      commit_marker: MANIFEST, partial_payload_without_manifest_is_authoritative: false },
    authority_frozen_at: input.authority.issued_at,
  }
  const manifest = { ...body,
    manifest_hash: replayPortfolioTwoFixedPartialAccountingArtifactManifestHash(body) }
  assertReplayPortfolioTwoFixedPartialAccountingArtifactManifest(manifest)
  namespace.writeImmutable(MANIFEST, encode(manifest))
  return { manifest, idempotent_replay: false }
}

function readCommitted(namespace: ReplayArtifactNamespace,
  evidence: ReplayPortfolioTwoFixedPartialAccountingEvidence,
  values: Record<ReplayPortfolioTwoFixedPartialAccountingArtifactRole, unknown>) {
  const manifest = JSON.parse(new TextDecoder().decode(namespace.read(MANIFEST).bytes)) as
    ReplayPortfolioTwoFixedPartialAccountingArtifactManifest
  assertReplayPortfolioTwoFixedPartialAccountingArtifactManifest(manifest)
  if (manifest.accounting_evidence_hash !== evidence.evidence_hash) {
    throw new Error("Portfolio two-fixed-partial committed manifest identity drift")
  }
  for (const file of manifest.files) {
    const read = namespace.read(file.name)
    if (file.name !== NAMES[file.role] || read.ref !== file.ref || sha256(read.bytes) !== file.sha256
        || canonicalHash(JSON.parse(new TextDecoder().decode(read.bytes))) !== canonicalHash(values[file.role])) {
      throw new Error("Portfolio two-fixed-partial committed payload drift")
    }
  }
  return manifest
}
function failed(code: NonNullable<ReplayPortfolioTwoFixedPartialAccountingOutcome["failure"]>["code"],
  error: unknown): ReplayPortfolioTwoFixedPartialAccountingOutcome {
  return { status: "failed", evidence: null, terminal_evidence: null, lane_results: null, artifact_manifest: null,
    idempotent_replay: false, failure: { code,
      message: error instanceof Error ? error.message : String(error), partial_portfolio_result_published: false } }
}
function encode(value: unknown): string { return `${canonicalJson(value)}\n` }
function sha256(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex") }
