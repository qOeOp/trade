import { createHash } from "node:crypto"
import {
  REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_ARTIFACT_ROLES,
  REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_OUTCOME_SCHEMA_VERSION,
  assertReplayPortfolioProtectiveStopCancelTerminalArtifactManifest,
  assertReplayPortfolioProtectiveStopCancelTerminalEvidence,
  assertReplayPortfolioProtectiveStopCancelTerminalOutcome,
  replayPortfolioProtectiveStopCancelTerminalArtifactManifestHash,
  replayPortfolioProtectiveStopCancelTerminalOutcomeHash,
  type ReplayPortfolioProtectiveStopCancelTerminalArtifactManifest,
  type ReplayPortfolioProtectiveStopCancelTerminalArtifactRole,
  type ReplayPortfolioProtectiveStopCancelTerminalEvidence,
  type ReplayPortfolioProtectiveStopCancelTerminalOutcome,
} from "../../../contracts/src/lib/replay-portfolio-protective-stop-cancel-terminal-contracts"
import {
  executeReplayPortfolioProtectiveStopCancelTerminal,
  type ReplayPortfolioProtectiveStopCancelTerminalLane,
} from "../../../engine/src/lib/replay-portfolio-protective-stop-cancel-terminal-engine"
import { canonicalHash, canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import {
  assertReplayPortfolioProtectiveTerminalArtifactManifest,
  assertReplayPortfolioProtectiveTerminalEvidence,
  type ReplayPortfolioProtectiveTerminalArtifactManifest,
  type ReplayPortfolioProtectiveTerminalEvidence,
} from "../../../contracts/src/lib/replay-portfolio-protective-terminal-contracts"
import { runReplayIntegratedPortfolio } from "./replay-integrated-portfolio-runner"
import { assertCertifiedReplayArtifactStore, type ReplayArtifactNamespace } from "./replay-artifact-store"
import { runReplayPortfolioProtectiveTerminal, type ReplayPortfolioProtectiveTerminalRunInput } from
  "./replay-portfolio-protective-terminal-runner"
import { materializeReplayPortfolioProtectiveMutationTerminalLanes } from
  "./replay-portfolio-protective-replacement-terminal-lane-materialization"

const MANIFEST = "portfolio-protective-stop-cancel-terminal-artifact-manifest.json"
const NAMES: Record<ReplayPortfolioProtectiveStopCancelTerminalArtifactRole, string> = {
  source_protective_terminal_artifact_manifest: "source-protective-terminal-artifact-manifest.json",
  source_protective_terminal_evidence: "source-protective-terminal-evidence.json",
  cancel_terminal_records: "cancel-terminal-records.json", ohlcv_resolutions: "ohlcv-resolutions.json",
  cancel_terminal_fingerprint: "cancel-terminal-fingerprint.json",
  cancel_terminal_evidence: "cancel-terminal-evidence.json",
}

export interface ReplayPortfolioProtectiveStopCancelTerminalRunInput
  extends ReplayPortfolioProtectiveTerminalRunInput {
  execute_cancel_terminal?: typeof executeReplayPortfolioProtectiveStopCancelTerminal
}

export function runReplayPortfolioProtectiveStopCancelTerminal(
  input: ReplayPortfolioProtectiveStopCancelTerminalRunInput,
): ReplayPortfolioProtectiveStopCancelTerminalOutcome {
  const projected = { ...input, allow_predeclared_protective_stop_cancel_projection: true as const }
  const source = runReplayPortfolioProtectiveTerminal(projected)
  if (source.status !== "completed" || !source.evidence || !source.artifact_manifest) {
    return failed(input, "protective-terminal-failed", source.failure?.message ?? "Protective Terminal failed")
  }
  const integrated = runReplayIntegratedPortfolio(projected)
  if (integrated.status !== "completed" || !integrated.risk_result) {
    return failed(input, "cancel-terminal-input-invalid", integrated.failure?.message ?? "Risk source missing")
  }
  let lanes: ReplayPortfolioProtectiveStopCancelTerminalLane[]
  let evidence: ReplayPortfolioProtectiveStopCancelTerminalEvidence
  try {
    lanes = materializeReplayPortfolioProtectiveStopCancelTerminalLanes(input)
    evidence = (input.execute_cancel_terminal ?? executeReplayPortfolioProtectiveStopCancelTerminal)({
      source_evidence: source.evidence, source_manifest: source.artifact_manifest,
      risk_result: integrated.risk_result, lanes,
    })
  } catch (error) {
    return failed(input, "cancel-terminal-engine-failed", error)
  }
  try {
    const published = publishReplayPortfolioProtectiveStopCancelTerminalArtifact({
      source_manifest: source.artifact_manifest, source_evidence: source.evidence, evidence,
      authority_frozen_at: input.allocation_reservation.issued_at, artifact_store: input.artifact_store,
    })
    const body: Omit<ReplayPortfolioProtectiveStopCancelTerminalOutcome, "outcome_hash"> = {
      schema_version: REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_OUTCOME_SCHEMA_VERSION,
      portfolio_id: input.integrated_plan.portfolio_id, status: "completed",
      source_protective_terminal_evidence: source.evidence, evidence,
      artifact_manifest: published.manifest,
      idempotent_replay: source.idempotent_replay && published.idempotent_replay, failure: null,
    }
    const outcome = { ...body, outcome_hash: replayPortfolioProtectiveStopCancelTerminalOutcomeHash(body) }
    assertReplayPortfolioProtectiveStopCancelTerminalOutcome(outcome)
    return outcome
  } catch (error) {
    return failed(input, "cancel-terminal-artifact-failed", error)
  }
}

export function materializeReplayPortfolioProtectiveStopCancelTerminalLanes(
  input: Pick<ReplayPortfolioProtectiveStopCancelTerminalRunInput, "risk_plan" | "lanes">,
): ReplayPortfolioProtectiveStopCancelTerminalLane[] {
  return materializeReplayPortfolioProtectiveMutationTerminalLanes(input, {
    mutation_effect: "authorized_protective_stop_cancel", select_intent: (entry) => entry.authorized_protective_stop_cancel,
    mutation_key: "cancel",
  })
}

export function readReplayPortfolioProtectiveStopCancelTerminalArtifactEvidence(
  input: ReplayPortfolioProtectiveStopCancelTerminalRunInput,
  expectedEvidence: ReplayPortfolioProtectiveStopCancelTerminalEvidence,
  expectedManifest: ReplayPortfolioProtectiveStopCancelTerminalArtifactManifest,
): {
  cancel_terminal_manifest: ReplayPortfolioProtectiveStopCancelTerminalArtifactManifest
  cancel_terminal_evidence: ReplayPortfolioProtectiveStopCancelTerminalEvidence
  source_protective_terminal_manifest: ReplayPortfolioProtectiveTerminalArtifactManifest
  source_protective_terminal_evidence: ReplayPortfolioProtectiveTerminalEvidence
} {
  assertCertifiedReplayArtifactStore(input.artifact_store)
  const namespace = input.artifact_store.openAttempt({
    idempotency_key_hash: canonicalHash({
      source_protective_terminal_evidence_hash: expectedEvidence.source_protective_terminal_evidence_hash,
      cancel_terminal_policy: expectedEvidence.policy_version,
    }),
    attempt_id_hash: expectedEvidence.evidence_hash,
  })
  const manifest = JSON.parse(new TextDecoder().decode(namespace.read(MANIFEST).bytes)) as
    ReplayPortfolioProtectiveStopCancelTerminalArtifactManifest
  assertReplayPortfolioProtectiveStopCancelTerminalArtifactManifest(manifest)
  if (canonicalHash(manifest) !== canonicalHash(expectedManifest)) {
    throw new Error("Cancel Terminal Artifact manifest read drift")
  }
  const values = new Map<ReplayPortfolioProtectiveStopCancelTerminalArtifactRole, unknown>()
  for (const file of manifest.files) {
    const read = namespace.read(file.name)
    if (file.name !== NAMES[file.role] || file.ref !== read.ref || file.sha256 !== sha256(read.bytes)) {
      throw new Error("Cancel Terminal Artifact payload hash drift")
    }
    values.set(file.role, JSON.parse(new TextDecoder().decode(read.bytes)))
  }
  const evidence = values.get("cancel_terminal_evidence") as
    ReplayPortfolioProtectiveStopCancelTerminalEvidence | undefined
  const sourceManifest = values.get("source_protective_terminal_artifact_manifest") as
    ReplayPortfolioProtectiveTerminalArtifactManifest | undefined
  const sourceEvidence = values.get("source_protective_terminal_evidence") as
    ReplayPortfolioProtectiveTerminalEvidence | undefined
  if (!evidence || !sourceManifest || !sourceEvidence) {
    throw new Error("Cancel Terminal Artifact accounting sources missing")
  }
  assertReplayPortfolioProtectiveStopCancelTerminalEvidence(evidence)
  assertReplayPortfolioProtectiveTerminalArtifactManifest(sourceManifest)
  assertReplayPortfolioProtectiveTerminalEvidence(sourceEvidence)
  if (canonicalHash(evidence) !== canonicalHash(expectedEvidence)
      || evidence.evidence_hash !== manifest.cancel_terminal_evidence_hash
      || sourceEvidence.evidence_hash !== evidence.source_protective_terminal_evidence_hash
      || sourceManifest.manifest_hash !== evidence.source_protective_terminal_artifact_manifest_hash
      || sourceManifest.protective_terminal_evidence_hash !== sourceEvidence.evidence_hash) {
    throw new Error("Cancel Terminal Artifact accounting source binding drift")
  }
  return { cancel_terminal_manifest: manifest, cancel_terminal_evidence: evidence,
    source_protective_terminal_manifest: sourceManifest, source_protective_terminal_evidence: sourceEvidence }
}

export interface ReplayPortfolioProtectiveStopCancelTerminalArtifactPublishInput {
  source_manifest: NonNullable<ReturnType<typeof runReplayPortfolioProtectiveTerminal>["artifact_manifest"]>
  source_evidence: NonNullable<ReturnType<typeof runReplayPortfolioProtectiveTerminal>["evidence"]>
  evidence: ReplayPortfolioProtectiveStopCancelTerminalEvidence
  authority_frozen_at: string
  artifact_store: ReplayPortfolioProtectiveStopCancelTerminalRunInput["artifact_store"]
}
export function publishReplayPortfolioProtectiveStopCancelTerminalArtifact(
  input: ReplayPortfolioProtectiveStopCancelTerminalArtifactPublishInput,
) {
  const sourceManifest = input.source_manifest; const sourceEvidence = input.source_evidence
  const evidence = input.evidence
  const values: Record<ReplayPortfolioProtectiveStopCancelTerminalArtifactRole, unknown> = {
    source_protective_terminal_artifact_manifest: sourceManifest,
    source_protective_terminal_evidence: sourceEvidence, cancel_terminal_records: evidence.lane_records,
    ohlcv_resolutions: evidence.ohlcv_resolutions, cancel_terminal_fingerprint: evidence.fingerprint,
    cancel_terminal_evidence: evidence,
  }
  assertCertifiedReplayArtifactStore(input.artifact_store)
  const namespace = input.artifact_store.openAttempt({
    idempotency_key_hash: canonicalHash({ source_protective_terminal_evidence_hash: sourceEvidence.evidence_hash,
      cancel_terminal_policy: evidence.policy_version }), attempt_id_hash: evidence.evidence_hash,
  })
  if (namespace.exists(MANIFEST)) {
    return { manifest: readCommitted(namespace, sourceManifest.manifest_hash, sourceEvidence.evidence_hash,
      evidence, values), idempotent_replay: true }
  }
  const files = REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_ARTIFACT_ROLES.map((role) => {
    const name = NAMES[role]
    return { role, name, ...namespace.writeImmutable(name, encode(values[role])) }
  })
  const body: Omit<ReplayPortfolioProtectiveStopCancelTerminalArtifactManifest, "manifest_hash"> = {
    schema_version: REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_ARTIFACT_MANIFEST_SCHEMA_VERSION,
    artifact_id: `replay-portfolio-protective-stop-cancel-terminal:${evidence.fingerprint.fingerprint_hash}`,
    portfolio_id: evidence.portfolio_id, cancel_terminal_evidence_hash: evidence.evidence_hash,
    cancel_terminal_fingerprint_hash: evidence.fingerprint.fingerprint_hash,
    source_protective_terminal_evidence_hash: sourceEvidence.evidence_hash,
    source_protective_terminal_artifact_manifest_hash: sourceManifest.manifest_hash, files,
    completeness: { authoritative_result: true,
      required_roles: REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_ARTIFACT_ROLES,
      commit_marker: MANIFEST, partial_payload_without_manifest_is_authoritative: false },
    authority_frozen_at: input.authority_frozen_at,
  }
  const manifest = { ...body, manifest_hash: replayPortfolioProtectiveStopCancelTerminalArtifactManifestHash(body) }
  assertReplayPortfolioProtectiveStopCancelTerminalArtifactManifest(manifest)
  namespace.writeImmutable(MANIFEST, encode(manifest))
  return { manifest, idempotent_replay: false }
}

function readCommitted(namespace: ReplayArtifactNamespace, sourceManifestHash: string, sourceEvidenceHash: string,
  evidence: ReplayPortfolioProtectiveStopCancelTerminalEvidence,
  values: Record<ReplayPortfolioProtectiveStopCancelTerminalArtifactRole, unknown>) {
  const manifest = JSON.parse(new TextDecoder().decode(namespace.read(MANIFEST).bytes)) as
    ReplayPortfolioProtectiveStopCancelTerminalArtifactManifest
  assertReplayPortfolioProtectiveStopCancelTerminalArtifactManifest(manifest)
  if (manifest.cancel_terminal_evidence_hash !== evidence.evidence_hash
      || manifest.cancel_terminal_fingerprint_hash !== evidence.fingerprint.fingerprint_hash
      || manifest.source_protective_terminal_evidence_hash !== sourceEvidenceHash
      || manifest.source_protective_terminal_artifact_manifest_hash !== sourceManifestHash) {
    throw new Error("Portfolio protective-stop cancel terminal manifest identity drift")
  }
  for (const file of manifest.files) {
    const read = namespace.read(file.name)
    if (file.name !== NAMES[file.role] || file.ref !== read.ref || file.sha256 !== sha256(read.bytes)
        || canonicalHash(JSON.parse(new TextDecoder().decode(read.bytes))) !== canonicalHash(values[file.role])) {
      throw new Error("Portfolio protective-stop cancel terminal Artifact payload binding mismatch")
    }
  }
  return manifest
}

function failed(input: ReplayPortfolioProtectiveStopCancelTerminalRunInput,
  code: NonNullable<ReplayPortfolioProtectiveStopCancelTerminalOutcome["failure"]>["code"], error: unknown) {
  const body: Omit<ReplayPortfolioProtectiveStopCancelTerminalOutcome, "outcome_hash"> = {
    schema_version: REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_OUTCOME_SCHEMA_VERSION,
    portfolio_id: input.integrated_plan.portfolio_id, status: "failed",
    source_protective_terminal_evidence: null, evidence: null, artifact_manifest: null,
    idempotent_replay: false,
    failure: { code, message: error instanceof Error ? error.message : String(error), partial_result_published: false },
  }
  const outcome = { ...body, outcome_hash: replayPortfolioProtectiveStopCancelTerminalOutcomeHash(body) }
  assertReplayPortfolioProtectiveStopCancelTerminalOutcome(outcome)
  return outcome
}
function encode(value: unknown): string { return `${canonicalJson(value)}\n` }
function sha256(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex") }
