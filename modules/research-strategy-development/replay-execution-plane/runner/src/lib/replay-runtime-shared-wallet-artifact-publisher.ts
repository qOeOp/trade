import { createHash } from "node:crypto"
import type { ReplayRuntimeSharedWalletRiskReservationSnapshot } from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import { createReplayRuntimeSharedWalletPortfolioEvidence } from "../../../accounting/src/lib/replay-runtime-shared-wallet-portfolio-accounting"
import {
  REPLAY_PORTFOLIO_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_ARTIFACT_OUTCOME_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_ARTIFACT_STORAGE_POLICY_VERSION,
  REPLAY_PORTFOLIO_REQUIRED_ARTIFACT_ROLES,
  assertReplayPortfolioArtifactManifest,
  assertReplayPortfolioArtifactOutcome,
  assertReplayRuntimeSharedWalletPortfolioEvidence,
  replayPortfolioArtifactManifestHash,
  replayPortfolioArtifactOutcomeHash,
  type ReplayPortfolioArtifactFile,
  type ReplayPortfolioArtifactManifest,
  type ReplayPortfolioArtifactOutcome,
  type ReplayPortfolioArtifactRole,
  type ReplayRuntimeSharedWalletPortfolioEvidence,
} from "../../../contracts/src/lib/replay-runtime-shared-wallet-artifact-contracts"
import type {
  ReplayRuntimeSharedWalletRiskPlan,
  ReplayRuntimeSharedWalletRiskResult,
} from "../../../contracts/src/lib/replay-runtime-shared-wallet-risk-contracts"
import { canonicalHash, canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import {
  assertCertifiedReplayArtifactStore,
  type ReplayArtifactNamespace,
  type ReplayArtifactStore,
} from "./replay-artifact-store"

const MANIFEST_NAME = "portfolio-artifact-manifest.json"
const FILE_NAMES: Readonly<Record<ReplayPortfolioArtifactRole, string>> = {
  portfolio_plan: "portfolio-plan.json",
  risk_reservation: "risk-reservation.json",
  risk_result: "risk-result.json",
  global_event_queue: "global-event-queue.json",
  open_positions: "open-positions.json",
  closed_positions: "closed-positions.json",
  portfolio_ledger: "portfolio-ledger.json",
  portfolio_journal: "portfolio-journal.json",
  portfolio_trial_balance: "portfolio-trial-balance.json",
  portfolio_fingerprint: "portfolio-fingerprint.json",
  portfolio_evidence: "portfolio-evidence.json",
}

export interface ReplayRuntimeSharedWalletArtifactPublishInput {
  plan: ReplayRuntimeSharedWalletRiskPlan
  risk_reservation: ReplayRuntimeSharedWalletRiskReservationSnapshot
  risk_result: ReplayRuntimeSharedWalletRiskResult
  artifact_store: ReplayArtifactStore
}

export function publishReplayRuntimeSharedWalletPortfolioArtifact(
  input: ReplayRuntimeSharedWalletArtifactPublishInput,
): ReplayPortfolioArtifactOutcome {
  let evidence: ReplayRuntimeSharedWalletPortfolioEvidence
  try {
    evidence = createReplayRuntimeSharedWalletPortfolioEvidence(input)
  } catch (error) {
    return failed(input.plan.portfolio_id, "portfolio-evidence-invalid", error)
  }
  try {
    assertCertifiedReplayArtifactStore(input.artifact_store)
    const identity = artifactIdentity(input)
    const namespace = input.artifact_store.openAttempt(identity)
    if (namespace.exists(MANIFEST_NAME)) return readCommitted(namespace, input, evidence)
    const files = writePayload(namespace, input, evidence)
    const manifestBody: Omit<ReplayPortfolioArtifactManifest, "manifest_hash"> = {
      schema_version: REPLAY_PORTFOLIO_ARTIFACT_MANIFEST_SCHEMA_VERSION,
      artifact_id: `replay-portfolio-artifact:${evidence.fingerprint.fingerprint_hash}`,
      portfolio_id: input.plan.portfolio_id,
      evidence_fingerprint_hash: evidence.fingerprint.fingerprint_hash,
      risk_result_hash: input.risk_result.result_hash,
      idempotency_key_hash: identity.idempotency_key_hash,
      attempt_id_hash: identity.attempt_id_hash,
      storage_policy_version: REPLAY_PORTFOLIO_ARTIFACT_STORAGE_POLICY_VERSION,
      files,
      completeness: {
        authoritative_result: true,
        required_roles: REPLAY_PORTFOLIO_REQUIRED_ARTIFACT_ROLES,
        commit_marker: MANIFEST_NAME,
        partial_payload_without_manifest_is_authoritative: false,
      },
      authority_frozen_at: input.risk_reservation.issued_at,
    }
    const manifest = {
      ...manifestBody,
      manifest_hash: replayPortfolioArtifactManifestHash(manifestBody as ReplayPortfolioArtifactManifest),
    }
    assertReplayPortfolioArtifactManifest(manifest)
    const manifestFile = namespace.writeImmutable(MANIFEST_NAME, encode(manifest))
    return committed(input.plan.portfolio_id, manifest, manifestFile.ref, manifestFile.sha256, false)
  } catch (error) {
    return failed(input.plan.portfolio_id, "portfolio-artifact-store-failed", error)
  }
}

function artifactIdentity(input: ReplayRuntimeSharedWalletArtifactPublishInput): {
  idempotency_key_hash: string
  attempt_id_hash: string
} {
  return {
    idempotency_key_hash: canonicalHash({
      portfolio_id: input.plan.portfolio_id,
      portfolio_plan_hash: input.plan.plan_hash,
      risk_reservation_hash: input.risk_reservation.reservation_hash,
    }),
    attempt_id_hash: input.risk_result.result_hash,
  }
}

function writePayload(
  namespace: ReplayArtifactNamespace,
  input: ReplayRuntimeSharedWalletArtifactPublishInput,
  evidence: ReplayRuntimeSharedWalletPortfolioEvidence,
): ReplayPortfolioArtifactFile[] {
  const values: Record<ReplayPortfolioArtifactRole, unknown> = {
    portfolio_plan: input.plan,
    risk_reservation: input.risk_reservation,
    risk_result: input.risk_result,
    global_event_queue: input.risk_result.global_source_event_queue,
    open_positions: input.risk_result.open_positions,
    closed_positions: input.risk_result.closed_positions,
    portfolio_ledger: evidence.portfolio_ledger,
    portfolio_journal: evidence.portfolio_journal,
    portfolio_trial_balance: evidence.trial_balance,
    portfolio_fingerprint: evidence.fingerprint,
    portfolio_evidence: evidence,
  }
  return REPLAY_PORTFOLIO_REQUIRED_ARTIFACT_ROLES.map((role) => {
    const name = FILE_NAMES[role]
    return { role, name, ...namespace.writeImmutable(name, encode(values[role])) }
  })
}

function readCommitted(
  namespace: ReplayArtifactNamespace,
  input: ReplayRuntimeSharedWalletArtifactPublishInput,
  expectedEvidence: ReplayRuntimeSharedWalletPortfolioEvidence,
): ReplayPortfolioArtifactOutcome {
  const manifestRead = namespace.read(MANIFEST_NAME)
  const manifest = JSON.parse(new TextDecoder().decode(manifestRead.bytes)) as ReplayPortfolioArtifactManifest
  assertReplayPortfolioArtifactManifest(manifest)
  const identity = artifactIdentity(input)
  if (manifest.portfolio_id !== input.plan.portfolio_id || manifest.risk_result_hash !== input.risk_result.result_hash
      || manifest.evidence_fingerprint_hash !== expectedEvidence.fingerprint.fingerprint_hash
      || manifest.idempotency_key_hash !== identity.idempotency_key_hash
      || manifest.attempt_id_hash !== identity.attempt_id_hash) {
    throw new Error("committed Portfolio artifact identity was reused with different evidence")
  }
  verifyManifestFiles(namespace, manifest)
  const recordedPlan = parse(namespace, FILE_NAMES.portfolio_plan)
  const recordedAuthority = parse(namespace, FILE_NAMES.risk_reservation)
  const recordedResult = parse(namespace, FILE_NAMES.risk_result)
  const recordedEvidence = parse(namespace, FILE_NAMES.portfolio_evidence) as ReplayRuntimeSharedWalletPortfolioEvidence
  if (canonicalHash(recordedPlan) !== canonicalHash(input.plan)
      || canonicalHash(recordedAuthority) !== canonicalHash(input.risk_reservation)
      || canonicalHash(recordedResult) !== canonicalHash(input.risk_result)
      || canonicalHash(recordedEvidence) !== canonicalHash(expectedEvidence)
      || canonicalHash(parse(namespace, FILE_NAMES.global_event_queue))
        !== canonicalHash(input.risk_result.global_source_event_queue)
      || canonicalHash(parse(namespace, FILE_NAMES.open_positions)) !== canonicalHash(input.risk_result.open_positions)
      || canonicalHash(parse(namespace, FILE_NAMES.closed_positions)) !== canonicalHash(input.risk_result.closed_positions)
      || canonicalHash(parse(namespace, FILE_NAMES.portfolio_ledger)) !== canonicalHash(expectedEvidence.portfolio_ledger)
      || canonicalHash(parse(namespace, FILE_NAMES.portfolio_journal)) !== canonicalHash(expectedEvidence.portfolio_journal)
      || canonicalHash(parse(namespace, FILE_NAMES.portfolio_trial_balance)) !== canonicalHash(expectedEvidence.trial_balance)
      || canonicalHash(parse(namespace, FILE_NAMES.portfolio_fingerprint)) !== canonicalHash(expectedEvidence.fingerprint)) {
    throw new Error("committed Portfolio artifact payload binding mismatch")
  }
  assertReplayRuntimeSharedWalletPortfolioEvidence(recordedEvidence)
  return committed(
    input.plan.portfolio_id,
    manifest,
    manifestRead.ref,
    sha256(manifestRead.bytes),
    true,
  )
}

function verifyManifestFiles(namespace: ReplayArtifactNamespace, manifest: ReplayPortfolioArtifactManifest): void {
  for (const file of manifest.files) {
    if (file.name !== FILE_NAMES[file.role]) throw new Error("Portfolio artifact role filename mismatch")
    const read = namespace.read(file.name)
    if (read.ref !== file.ref || sha256(read.bytes) !== file.sha256) {
      throw new Error("Portfolio artifact payload hash or ref mismatch")
    }
  }
}

function committed(
  portfolioId: string,
  manifest: ReplayPortfolioArtifactManifest,
  manifestRef: string,
  manifestSha256: string,
  idempotentReplay: boolean,
): ReplayPortfolioArtifactOutcome {
  const body: Omit<ReplayPortfolioArtifactOutcome, "outcome_hash"> = {
    schema_version: REPLAY_PORTFOLIO_ARTIFACT_OUTCOME_SCHEMA_VERSION,
    portfolio_id: portfolioId,
    status: "committed",
    idempotent_replay: idempotentReplay,
    artifact_manifest: manifest,
    artifact_commit: {
      manifest_ref: manifestRef,
      manifest_sha256: manifestSha256,
      manifest_hash: manifest.manifest_hash,
      evidence_fingerprint_hash: manifest.evidence_fingerprint_hash,
    },
    failure: null,
  }
  const outcome = { ...body, outcome_hash: replayPortfolioArtifactOutcomeHash(body as ReplayPortfolioArtifactOutcome) }
  assertReplayPortfolioArtifactOutcome(outcome)
  return outcome
}

function failed(
  portfolioId: string,
  code: NonNullable<ReplayPortfolioArtifactOutcome["failure"]>["code"],
  error: unknown,
): ReplayPortfolioArtifactOutcome {
  const body: Omit<ReplayPortfolioArtifactOutcome, "outcome_hash"> = {
    schema_version: REPLAY_PORTFOLIO_ARTIFACT_OUTCOME_SCHEMA_VERSION,
    portfolio_id: portfolioId,
    status: "failed",
    idempotent_replay: false,
    artifact_manifest: null,
    artifact_commit: null,
    failure: {
      code,
      message: error instanceof Error ? error.message : String(error),
      partial_result_published: false,
    },
  }
  const outcome = { ...body, outcome_hash: replayPortfolioArtifactOutcomeHash(body as ReplayPortfolioArtifactOutcome) }
  assertReplayPortfolioArtifactOutcome(outcome)
  return outcome
}

function encode(value: unknown): string {
  return `${canonicalJson(value)}\n`
}

function parse(namespace: ReplayArtifactNamespace, name: string): unknown {
  return JSON.parse(new TextDecoder().decode(namespace.read(name).bytes))
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}
