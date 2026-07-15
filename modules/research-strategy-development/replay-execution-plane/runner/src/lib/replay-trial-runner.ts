import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { basename, dirname, join, relative, resolve, sep } from "node:path"
import {
  assertReplayAttemptLeaseSnapshot,
  assertReplayResumeAuthorizationSnapshot,
  assertTrialReservationSnapshot,
  REPLAY_CHECKPOINT_STORAGE_POLICY_VERSION,
  hashReplayAttemptLeaseSnapshot,
  hashReplayResumeAuthorizationSnapshot,
  hashTrialReservationSnapshot,
  type ReplayAttemptLeaseSnapshot,
  type ReplayResumeAuthorizationSnapshot,
  type TrialReservationSnapshot,
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import {
  REPLAY_ARTIFACT_SCHEMA_VERSION,
  REPLAY_CERTIFIED_CAPABILITIES,
  REPLAY_REQUIRED_ARTIFACT_ROLES,
  REPLAY_RESULT_SCHEMA_VERSION,
  canonicalHash,
  canonicalJson,
  replayExecutionSpecHash,
  type ReplayArtifactManifest,
  type ReplayDatasetManifest,
  type ReplayExecutionRequest,
  type ReplayEventKey,
  type ReplayFundingEvent,
  type ReplayMarkEvent,
  type ReplayMaintenanceBreachObservation,
  type ReplayMarketBar,
  type ReplayMarginSnapshot,
  type ReplayResult,
} from "../../../contracts/src/lib/replay-contracts"
import {
  ReplayExecutionInterruptedError,
  assertReplayEngineCheckpoint,
  executeReplayKernel,
  type ReplayEngineCheckpoint,
} from "../../../engine/src/lib/replay-reference-engine"
import { ReplayLiquidationDeficitError, ReplayMarginTerminalError } from "../../../engine/src/lib/replay-margin-path"
import { ReplayInstrumentTerminalError } from "../../../engine/src/lib/replay-source-reducer"
import {
  ensureReplayDurableDirectory,
  removeReplayDurableFile,
  writeReplayImmutableCas,
} from "./replay-local-artifact-store"

export interface ReplayTrialRunInput {
  request: ReplayExecutionRequest
  trial_reservation: TrialReservationSnapshot
  attempt_lease: ReplayAttemptLeaseSnapshot
  observed_at: string
  dataset_manifest: ReplayDatasetManifest
  bars: ReplayMarketBar[]
  funding_events?: ReplayFundingEvent[]
  mark_events?: ReplayMarkEvent[]
  artifact_root?: string
  cancel_requested?: boolean
  execution_control?: {
    resume_checkpoint?: ReplayEngineCheckpoint
    resume_authorization?: ReplayResumeAuthorizationSnapshot
    on_checkpoint?: (
      checkpoint: ReplayEngineCheckpoint,
      diagnosticCheckpointCommit: ReplayDiagnosticCheckpointCommitRef | undefined,
    ) => {
      command: "continue" | "cancel"
      attempt_lease: ReplayAttemptLeaseSnapshot
      observed_at: string
    }
  }
}

export interface ReplayTrialRunOutcome {
  schema_version: "trade.rd-replay-run-outcome.v11"
  run_id: string
  attempt_id: string
  lease_generation: number
  attempt_lease_hash?: string
  resume_authorization_hash?: string
  status: "completed" | "cancelled" | "failed"
  idempotent_replay: boolean
  result?: ReplayResult
  artifact_manifest?: ReplayArtifactManifest
  artifact_commit?: ReplayArtifactCommit
  resumable_checkpoint?: ReplayEngineCheckpoint
  diagnostic_checkpoint_commit?: ReplayDiagnosticCheckpointCommitRef
  failure?: {
    code: "trial-reservation-rejected" | "attempt-lease-rejected" | "resume-authorization-rejected" | "cancelled-before-start" | "execution-cancelled-at-checkpoint" | "instrument-delisted-with-open-position" | "initial-margin-deficit-without-resize" | "maintenance-margin-breach-without-liquidation" | "liquidation-deficit-unsupported" | "replay-execution-failed"
    failure_class: "input_invalid" | "unsupported_contract" | "data_integrity" | "deterministic_engine" | "resource" | "external_io"
    message: string
    retryable: boolean
    partial_result_published: false
    event_key?: ReplayEventKey
    margin_snapshot?: ReplayMarginSnapshot
    maintenance_breach?: ReplayMaintenanceBreachObservation
    remaining_collateral?: number
  }
}

export interface ReplayArtifactCommit {
  ref: string
  sha256: string
  producer_attempt_id: string
  terminal_checkpoint_hash: string
  storage_policy_version: typeof REPLAY_CHECKPOINT_STORAGE_POLICY_VERSION
}

export const REPLAY_DIAGNOSTIC_CHECKPOINT_COMMIT_SCHEMA_VERSION = "trade.rd-replay-diagnostic-checkpoint-commit.v2" as const

export interface ReplayDiagnosticCheckpointCommitRef {
  ref: string
  sha256: string
  checkpoint_ref: string
  checkpoint_sha256: string
  checkpoint_hash: string
  producer_attempt_id: string
  producer_lease_generation: number
  storage_policy_version: typeof REPLAY_CHECKPOINT_STORAGE_POLICY_VERSION
  next_source_offset: number
}

interface ReplayDiagnosticCheckpointCommitRecord {
  schema_version: typeof REPLAY_DIAGNOSTIC_CHECKPOINT_COMMIT_SCHEMA_VERSION
  run_id: string
  request_hash: string
  dataset_hash: string
  producer_attempt_id: string
  producer_lease_generation: number
  producer_attempt_lease_hash: string
  storage_policy_version: typeof REPLAY_CHECKPOINT_STORAGE_POLICY_VERSION
  checkpoint_ref: string
  checkpoint_sha256: string
  checkpoint_hash: string
  next_source_offset: number
  last_committed_event_key: ReplayEventKey
  created_at: string
}

export function runReplayTrial(input: ReplayTrialRunInput): ReplayTrialRunOutcome {
  try {
    validateTrialReservation(input.request, input.trial_reservation)
  } catch (error) {
    return {
      schema_version: "trade.rd-replay-run-outcome.v11",
      run_id: input.request.run_id,
      attempt_id: input.attempt_lease.attempt_id,
      lease_generation: input.attempt_lease.lease_generation,
      status: "failed",
      idempotent_replay: false,
      failure: {
        code: "trial-reservation-rejected",
        failure_class: "unsupported_contract",
        message: error instanceof Error ? error.message : String(error),
        retryable: false,
        partial_result_published: false,
      },
    }
  }
  let attemptLeaseHash: string
  try {
    validateAttemptLease(input.request, input.trial_reservation, input.attempt_lease, input.observed_at)
    attemptLeaseHash = hashReplayAttemptLeaseSnapshot(input.attempt_lease)
  } catch (error) {
    const expired = error instanceof ReplayAttemptLeaseExpiredError
    return {
      schema_version: "trade.rd-replay-run-outcome.v11",
      run_id: input.request.run_id,
      attempt_id: input.attempt_lease.attempt_id,
      lease_generation: input.attempt_lease.lease_generation,
      status: "failed",
      idempotent_replay: false,
      failure: {
        code: "attempt-lease-rejected",
        failure_class: expired ? "resource" : "unsupported_contract",
        message: error instanceof Error ? error.message : String(error),
        retryable: expired,
        partial_result_published: false,
      },
    }
  }
  if (input.cancel_requested) {
    return {
      schema_version: "trade.rd-replay-run-outcome.v11",
      run_id: input.request.run_id,
      attempt_id: input.attempt_lease.attempt_id,
      lease_generation: input.attempt_lease.lease_generation,
      attempt_lease_hash: attemptLeaseHash,
      status: "cancelled",
      idempotent_replay: false,
      failure: {
        code: "cancelled-before-start",
        failure_class: "resource",
        message: "Replay cancellation was observed before engine execution.",
        retryable: false,
        partial_result_published: false,
      },
    }
  }
  let activeAttemptLease = input.attempt_lease
  let activeAttemptLeaseHash = attemptLeaseHash
  let resumeAuthorizationHash: string | undefined
  let lastDiagnosticCheckpointCommit: ReplayDiagnosticCheckpointCommitRef | undefined
  try {
    if (input.execution_control?.resume_checkpoint && input.execution_control.resume_authorization) {
      throw new ReplayResumeAuthorizationError("Replay resume must provide either an inline checkpoint or a Resume Authorization, not both")
    }
    if (input.execution_control?.resume_authorization) {
      validateResumeAuthorization(
        input.request,
        input.trial_reservation,
        input.attempt_lease,
        input.execution_control.resume_authorization,
      )
      resumeAuthorizationHash = hashReplayResumeAuthorizationSnapshot(input.execution_control.resume_authorization)
    }
    const committed = input.artifact_root ? readCommitted(input.artifact_root, input.request, input.trial_reservation, input.attempt_lease, input.dataset_manifest) : undefined
    if (committed) {
      cleanupDiagnosticCheckpoint(input.artifact_root!, input.request, input.attempt_lease.attempt_id)
      return {
        schema_version: "trade.rd-replay-run-outcome.v11",
        run_id: input.request.run_id,
        attempt_id: input.attempt_lease.attempt_id,
        lease_generation: input.attempt_lease.lease_generation,
        attempt_lease_hash: attemptLeaseHash,
        ...(resumeAuthorizationHash ? { resume_authorization_hash: resumeAuthorizationHash } : {}),
        status: "completed",
        idempotent_replay: true,
        ...committed,
      }
    }
    const resumeCheckpoint = input.execution_control?.resume_authorization
      ? loadReplayDiagnosticCheckpoint(
        input.artifact_root,
        {
          ref: input.execution_control.resume_authorization.diagnostic_checkpoint_ref,
          sha256: input.execution_control.resume_authorization.diagnostic_checkpoint_hash,
        },
        input.request,
        input.dataset_manifest,
        input.execution_control.resume_authorization.source_attempt_id,
      )
      : input.execution_control?.resume_checkpoint
    const result = executeReplayKernel({
      request: input.request,
      dataset_manifest: input.dataset_manifest,
      bars: input.bars,
      funding_events: input.funding_events,
      mark_events: input.mark_events,
      execution_control: {
        resume_checkpoint: resumeCheckpoint,
        on_checkpoint: input.artifact_root || input.execution_control?.on_checkpoint
          ? (checkpoint) => {
            if (input.artifact_root) {
              lastDiagnosticCheckpointCommit = commitDiagnosticCheckpoint(
                input.artifact_root, input.request, activeAttemptLease, checkpoint,
              )
            }
            if (!input.execution_control?.on_checkpoint) return "continue"
            const decision = input.execution_control.on_checkpoint(checkpoint, lastDiagnosticCheckpointCommit)
            try {
              validateAttemptLease(input.request, input.trial_reservation, decision.attempt_lease, decision.observed_at)
              assertAttemptLeaseSuccessor(activeAttemptLease, decision.attempt_lease)
            } catch (error) {
              throw new ReplayAttemptLeaseControlError(error instanceof Error ? error.message : String(error))
            }
            activeAttemptLease = decision.attempt_lease
            activeAttemptLeaseHash = hashReplayAttemptLeaseSnapshot(activeAttemptLease)
            return decision.command
          }
          : undefined,
      },
    })
    const committedArtifact = input.artifact_root
      ? commitArtifacts(input.artifact_root, input.request, input.trial_reservation, activeAttemptLease, input.dataset_manifest, result)
      : undefined
    if (input.artifact_root) cleanupDiagnosticCheckpoint(input.artifact_root, input.request, activeAttemptLease.attempt_id)
    return {
      schema_version: "trade.rd-replay-run-outcome.v11",
      run_id: input.request.run_id,
      attempt_id: activeAttemptLease.attempt_id,
      lease_generation: activeAttemptLease.lease_generation,
      attempt_lease_hash: activeAttemptLeaseHash,
      ...(resumeAuthorizationHash ? { resume_authorization_hash: resumeAuthorizationHash } : {}),
      status: "completed",
      idempotent_replay: false,
      result,
      artifact_manifest: committedArtifact?.artifact_manifest,
      artifact_commit: committedArtifact?.artifact_commit,
    }
  } catch (error) {
    const interrupted = error instanceof ReplayExecutionInterruptedError
    const leaseRejected = error instanceof ReplayAttemptLeaseControlError
    const resumeRejected = error instanceof ReplayResumeAuthorizationError
    const instrumentTerminal = error instanceof ReplayInstrumentTerminalError
    const marginTerminal = error instanceof ReplayMarginTerminalError
    const liquidationDeficit = error instanceof ReplayLiquidationDeficitError
    return {
      schema_version: "trade.rd-replay-run-outcome.v11",
      run_id: input.request.run_id,
      attempt_id: activeAttemptLease.attempt_id,
      lease_generation: activeAttemptLease.lease_generation,
      attempt_lease_hash: activeAttemptLeaseHash,
      ...(resumeAuthorizationHash ? { resume_authorization_hash: resumeAuthorizationHash } : {}),
      status: interrupted ? "cancelled" : "failed",
      idempotent_replay: false,
      ...(interrupted ? { resumable_checkpoint: error.checkpoint } : {}),
      ...(interrupted && lastDiagnosticCheckpointCommit
        ? { diagnostic_checkpoint_commit: lastDiagnosticCheckpointCommit }
        : {}),
      failure: {
        code: interrupted ? error.code : leaseRejected ? "attempt-lease-rejected" : resumeRejected ? "resume-authorization-rejected" : instrumentTerminal || marginTerminal || liquidationDeficit ? error.code : "replay-execution-failed",
        failure_class: interrupted || leaseRejected ? "resource" : resumeRejected ? "unsupported_contract" : instrumentTerminal || marginTerminal || liquidationDeficit ? "deterministic_engine" : "data_integrity",
        message: error instanceof Error ? error.message : String(error),
        retryable: false,
        partial_result_published: false,
        ...(instrumentTerminal ? { event_key: error.terminal_event.event_key } : {}),
        ...(marginTerminal ? {
          event_key: error.terminal_snapshot.event_key,
          margin_snapshot: error.terminal_snapshot,
          ...(error.maintenance_breach ? { maintenance_breach: error.maintenance_breach } : {}),
        } : {}),
        ...(liquidationDeficit ? {
          event_key: error.terminal_snapshot.event_key,
          margin_snapshot: error.terminal_snapshot,
          maintenance_breach: error.maintenance_breach,
          remaining_collateral: error.remaining_collateral,
        } : {}),
      },
    }
  }
}

class ReplayAttemptLeaseControlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ReplayAttemptLeaseControlError"
  }
}

class ReplayResumeAuthorizationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ReplayResumeAuthorizationError"
  }
}

function validateResumeAuthorization(
  request: ReplayExecutionRequest,
  reservation: TrialReservationSnapshot,
  lease: ReplayAttemptLeaseSnapshot,
  authorization: ReplayResumeAuthorizationSnapshot,
): void {
  try {
    assertReplayResumeAuthorizationSnapshot(authorization)
  } catch (error) {
    throw new ReplayResumeAuthorizationError(error instanceof Error ? error.message : String(error))
  }
  if (authorization.trial_id !== request.trial_id
      || authorization.run_id !== request.run_id
      || authorization.request_hash !== canonicalHash(request)
      || authorization.reservation_ref !== reservation.reservation_ref
      || authorization.reservation_hash !== hashTrialReservationSnapshot(reservation)) {
    throw new ReplayResumeAuthorizationError("Replay Resume Authorization does not match request and reservation")
  }
  if (authorization.target_attempt_id !== lease.attempt_id
      || authorization.target_attempt_ordinal !== lease.attempt_ordinal
      || authorization.target_worker_id !== lease.worker_id
      || authorization.target_claimed_at !== lease.claimed_at) {
    throw new ReplayResumeAuthorizationError("Replay Resume Authorization does not target the active Attempt lease")
  }
  if (lease.lease_generation < authorization.target_lease_generation_floor) {
    throw new ReplayResumeAuthorizationError("Replay Attempt lease generation predates Resume Authorization")
  }
  if (lease.lease_generation === authorization.target_lease_generation_floor
      && hashReplayAttemptLeaseSnapshot(lease) !== authorization.target_attempt_lease_hash) {
    throw new ReplayResumeAuthorizationError("Replay Resume Authorization target lease hash mismatch")
  }
}

function assertAttemptLeaseSuccessor(
  previous: ReplayAttemptLeaseSnapshot,
  next: ReplayAttemptLeaseSnapshot,
): void {
  if (next.attempt_id !== previous.attempt_id
      || next.worker_id !== previous.worker_id
      || next.trial_id !== previous.trial_id
      || next.run_id !== previous.run_id
      || next.reservation_ref !== previous.reservation_ref
      || next.reservation_hash !== previous.reservation_hash
      || next.request_hash !== previous.request_hash
      || next.claimed_at !== previous.claimed_at) {
    throw new Error("Replay Attempt lease renewal changed immutable attempt authority")
  }
  if (next.lease_generation < previous.lease_generation) {
    throw new Error("Replay Attempt lease generation cannot move backward")
  }
  if (next.lease_generation === previous.lease_generation
      && hashReplayAttemptLeaseSnapshot(next) !== hashReplayAttemptLeaseSnapshot(previous)) {
    throw new Error("Replay Attempt lease changed without advancing its generation")
  }
  if (Date.parse(next.heartbeat_at) < Date.parse(previous.heartbeat_at)) {
    throw new Error("Replay Attempt heartbeat cannot move backward")
  }
}

function validateAttemptLease(
  request: ReplayExecutionRequest,
  reservation: TrialReservationSnapshot,
  lease: ReplayAttemptLeaseSnapshot,
  observedAt: string,
): void {
  assertReplayAttemptLeaseSnapshot(lease)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(observedAt) || !Number.isFinite(Date.parse(observedAt))) {
    throw new Error("Replay Attempt observed_at must be an RFC 3339 UTC timestamp")
  }
  if (lease.trial_id !== request.trial_id || lease.run_id !== request.run_id
      || lease.reservation_ref !== reservation.reservation_ref
      || lease.reservation_hash !== hashTrialReservationSnapshot(reservation)
      || lease.request_hash !== canonicalHash(request)) {
    throw new Error("Replay Attempt lease authority does not match request and reservation")
  }
  const observed = Date.parse(observedAt)
  if (observed < Date.parse(lease.heartbeat_at)) {
    throw new Error("Replay Attempt observed_at precedes its fencing heartbeat")
  }
  if (observed >= Date.parse(lease.lease_expires_at)) {
    throw new ReplayAttemptLeaseExpiredError("Replay Attempt lease expired before observed_at")
  }
}

class ReplayAttemptLeaseExpiredError extends Error {}

function validateTrialReservation(request: ReplayExecutionRequest, reservation: TrialReservationSnapshot): void {
  assertTrialReservationSnapshot(reservation)
  if (reservation.reservation_ref !== request.trial_reservation_ref
      || hashTrialReservationSnapshot(reservation) !== request.trial_reservation_hash) {
    throw new Error("Trial Reservation ref/hash does not match Replay request")
  }
  const identity = reservation.identity
  for (const field of ["experiment_id", "trial_group_id", "trial_id", "candidate_id", "identity_hash_policy_version"] as const) {
    if (identity[field] !== request[field]) throw new Error(`Trial Reservation identity mismatch: ${field}`)
  }
  for (const field of ["trial_group_hash", "candidate_hash", "experiment_contract_hash"] as const) {
    if (identity[field] !== request[field]) throw new Error(`Trial Reservation identity hash mismatch: ${field}`)
  }
  if (reservation.run_id !== request.run_id) throw new Error("Trial Reservation run_id does not match Replay request")
  const bindings = reservation.bindings
  if (bindings.replay_idempotency_key !== request.idempotency_key
      || bindings.execution_spec_hash !== replayExecutionSpecHash(request)
      || bindings.dataset_manifest_ref !== request.dataset_manifest_ref
      || bindings.dataset_hash !== request.dataset_hash
      || bindings.venue_risk_policy_snapshot_hash !== request.venue_risk_policy_snapshot_hash
      || bindings.instrument_spec_snapshot_hash !== request.instrument_spec_snapshot_hash
      || bindings.harness_hash !== request.harness_hash
      || bindings.assumptions_hash !== request.assumptions_hash
      || bindings.cost_policy_hash !== canonicalHash(request.cost_policy)
      || bindings.margin_policy_hash !== canonicalHash(request.margin_policy)
      || bindings.simulator_policy_version !== request.simulator_policy.version
      || bindings.execution_mode !== "step") {
    throw new Error("Trial Reservation execution bindings do not match Replay request")
  }
  const supported = new Set<string>(REPLAY_CERTIFIED_CAPABILITIES)
  if (reservation.required_capabilities.some((capability) => !supported.has(capability))) {
    throw new Error("Trial Reservation requires an unsupported Replay capability")
  }
  if (REPLAY_CERTIFIED_CAPABILITIES.some((capability) => !reservation.required_capabilities.includes(capability))) {
    throw new Error("Trial Reservation does not authorize the complete certified Replay capability set")
  }
}

const ARTIFACT_FILE_NAMES: Readonly<Record<(typeof REPLAY_REQUIRED_ARTIFACT_ROLES)[number], string>> = {
  request: "request.json", trial_reservation: "trial-reservation.json", attempt_lease: "attempt-lease.json",
  dataset_manifest: "dataset-manifest.json", result: "result.json", source_events: "source-events.jsonl",
  order_events: "order-events.jsonl", fills: "fills.jsonl", positions: "positions.jsonl", ledger: "ledger.jsonl",
  valuation_snapshot: "valuation-snapshot.json", equity_bridge: "equity-bridge.json", margin_snapshots: "margin-snapshots.json",
  liquidation: "liquidation.json", journal: "journal.jsonl", trial_balance: "trial-balance.json",
}

function commitArtifacts(
  root: string,
  request: ReplayExecutionRequest,
  trialReservation: TrialReservationSnapshot,
  attemptLease: ReplayAttemptLeaseSnapshot,
  datasetManifest: ReplayDatasetManifest,
  result: ReplayResult,
): { artifact_manifest: ReplayArtifactManifest; artifact_commit: ReplayArtifactCommit } {
  const directory = runDirectory(root, request.idempotency_key, attemptLease.attempt_id)
  ensureReplayDurableDirectory(directory)
  const requestText = `${canonicalJson(request)}\n`
  const trialReservationText = `${canonicalJson(trialReservation)}\n`
  const attemptLeaseText = `${canonicalJson(attemptLease)}\n`
  const datasetManifestText = `${canonicalJson(datasetManifest)}\n`
  const resultText = `${canonicalJson(result)}\n`
  const sourceEventsText = result.source_events.map((event) => canonicalJson(event)).join("\n") + "\n"
  const orderEventsText = result.order_events.map((event) => canonicalJson(event)).join("\n") + "\n"
  const fillsText = result.fills.map((fill) => canonicalJson(fill)).join("\n") + "\n"
  const positionsText = result.positions.map((position) => canonicalJson(position)).join("\n") + "\n"
  const ledgerText = result.ledger.map((entry) => canonicalJson(entry)).join("\n") + "\n"
  const valuationSnapshotText = `${canonicalJson(result.valuation_snapshot)}\n`
  const equityBridgeText = `${canonicalJson(result.equity_bridge)}\n`
  const marginSnapshotsText = `${canonicalJson(result.margin_snapshots)}\n`
  const liquidationText = `${canonicalJson(result.liquidation)}\n`
  const journalText = result.journal.map((entry) => canonicalJson(entry)).join("\n") + "\n"
  const trialBalanceText = `${canonicalJson(result.trial_balance)}\n`
  const files = [
    writeImmutable(directory, "request.json", requestText, "request"),
    writeImmutable(directory, "trial-reservation.json", trialReservationText, "trial_reservation"),
    writeImmutable(directory, "attempt-lease.json", attemptLeaseText, "attempt_lease"),
    writeImmutable(directory, "dataset-manifest.json", datasetManifestText, "dataset_manifest"),
    writeImmutable(directory, "result.json", resultText, "result"),
    writeImmutable(directory, "source-events.jsonl", sourceEventsText, "source_events"),
    writeImmutable(directory, "order-events.jsonl", orderEventsText, "order_events"),
    writeImmutable(directory, "fills.jsonl", fillsText, "fills"),
    writeImmutable(directory, "positions.jsonl", positionsText, "positions"),
    writeImmutable(directory, "ledger.jsonl", ledgerText, "ledger"),
    writeImmutable(directory, "valuation-snapshot.json", valuationSnapshotText, "valuation_snapshot"),
    writeImmutable(directory, "equity-bridge.json", equityBridgeText, "equity_bridge"),
    writeImmutable(directory, "margin-snapshots.json", marginSnapshotsText, "margin_snapshots"),
    writeImmutable(directory, "liquidation.json", liquidationText, "liquidation"),
    writeImmutable(directory, "journal.jsonl", journalText, "journal"),
    writeImmutable(directory, "trial-balance.json", trialBalanceText, "trial_balance"),
  ]
  const lastCommittedEventKey = result.source_events.at(-1)?.event_key ?? null
  const terminalCheckpointHash = computeTerminalCheckpointHash(request, trialReservation, result, lastCommittedEventKey)
  const manifest: ReplayArtifactManifest = {
    schema_version: REPLAY_ARTIFACT_SCHEMA_VERSION,
    artifact_id: `replay-artifact:${request.run_id}`,
    run_id: request.run_id,
    result_hash: result.fingerprint.result_hash,
    producer_attempt_id: attemptLease.attempt_id,
    producer_attempt_lease_hash: hashReplayAttemptLeaseSnapshot(attemptLease),
    storage_policy_version: REPLAY_CHECKPOINT_STORAGE_POLICY_VERSION,
    files,
    completeness: {
      authoritative_result: true,
      required_roles: [...REPLAY_REQUIRED_ARTIFACT_ROLES],
      last_committed_event_key: lastCommittedEventKey,
      terminal_checkpoint_hash: terminalCheckpointHash,
    },
    created_at: result.completed_at,
  }
  const manifestFile = writeImmutable(directory, "artifact-manifest.json", `${canonicalJson(manifest)}\n`, "manifest")
  return {
    artifact_manifest: manifest,
    artifact_commit: {
      ref: manifestFile.ref, sha256: manifestFile.sha256,
      producer_attempt_id: attemptLease.attempt_id,
      terminal_checkpoint_hash: terminalCheckpointHash,
      storage_policy_version: REPLAY_CHECKPOINT_STORAGE_POLICY_VERSION,
    },
  }
}

function readCommitted(
  root: string,
  request: ReplayExecutionRequest,
  trialReservation: TrialReservationSnapshot,
  attemptLease: ReplayAttemptLeaseSnapshot,
  datasetManifest: ReplayDatasetManifest,
): { result: ReplayResult; artifact_manifest: ReplayArtifactManifest; artifact_commit: ReplayArtifactCommit } | undefined {
  const directory = runDirectory(root, request.idempotency_key, attemptLease.attempt_id)
  const manifestPath = join(directory, "artifact-manifest.json")
  if (!existsSync(manifestPath)) return undefined
  const manifestText = readFileSync(manifestPath, "utf8")
  const manifest = JSON.parse(manifestText) as ReplayArtifactManifest
  if (manifest.schema_version !== REPLAY_ARTIFACT_SCHEMA_VERSION) throw new Error("committed Replay artifact schema is not supported")
  if (manifest.storage_policy_version !== REPLAY_CHECKPOINT_STORAGE_POLICY_VERSION) {
    throw new Error("committed Replay artifact storage policy is not supported")
  }
  verifyArtifactCompleteness(directory, manifest)
  const requestPath = join(directory, ARTIFACT_FILE_NAMES.request)
  const trialReservationPath = join(directory, ARTIFACT_FILE_NAMES.trial_reservation)
  const attemptLeasePath = join(directory, ARTIFACT_FILE_NAMES.attempt_lease)
  const datasetManifestPath = join(directory, ARTIFACT_FILE_NAMES.dataset_manifest)
  const resultPath = join(directory, ARTIFACT_FILE_NAMES.result)
  const recordedRequest = JSON.parse(readFileSync(requestPath, "utf8")) as ReplayExecutionRequest
  if (canonicalHash(recordedRequest) !== canonicalHash(request)) throw new Error("Replay idempotency key was reused with a different request")
  const recordedTrialReservation = JSON.parse(readFileSync(trialReservationPath, "utf8")) as TrialReservationSnapshot
  if (hashTrialReservationSnapshot(recordedTrialReservation) !== hashTrialReservationSnapshot(trialReservation)) {
    throw new Error("Replay idempotency key was reused with a different Trial Reservation")
  }
  const producerAttemptLease = JSON.parse(readFileSync(attemptLeasePath, "utf8")) as ReplayAttemptLeaseSnapshot
  assertReplayAttemptLeaseSnapshot(producerAttemptLease)
  if (producerAttemptLease.attempt_id !== manifest.producer_attempt_id
      || hashReplayAttemptLeaseSnapshot(producerAttemptLease) !== manifest.producer_attempt_lease_hash
      || hashReplayAttemptLeaseSnapshot(producerAttemptLease) !== hashReplayAttemptLeaseSnapshot(attemptLease)) {
    throw new Error("committed Replay producer Attempt lease mismatch")
  }
  const recordedDatasetManifest = JSON.parse(readFileSync(datasetManifestPath, "utf8")) as ReplayDatasetManifest
  if (canonicalHash(recordedDatasetManifest) !== canonicalHash(datasetManifest)) throw new Error("Replay idempotency key was reused with a different dataset manifest")
  const result = JSON.parse(readFileSync(resultPath, "utf8")) as ReplayResult
  if (result.schema_version !== REPLAY_RESULT_SCHEMA_VERSION) throw new Error("committed Replay result schema is not supported")
  if (manifest.run_id !== request.run_id || result.run_id !== request.run_id
      || manifest.result_hash !== result.fingerprint.result_hash) {
    throw new Error("committed Replay identity or Result hash binding mismatch")
  }
  if (canonicalHash({
    schema_version: result.schema_version,
    run_id: result.run_id,
    status: result.status,
    started_at: result.started_at,
    completed_at: result.completed_at,
    source_events: result.source_events,
    order_events: result.order_events,
    fills: result.fills,
    positions: result.positions,
    ledger: result.ledger,
    valuation_snapshot: result.valuation_snapshot,
    equity_bridge: result.equity_bridge,
    margin_snapshots: result.margin_snapshots,
    liquidation: result.liquidation,
    journal: result.journal,
    trial_balance: result.trial_balance,
    metrics: result.metrics,
    limitations: result.limitations,
  }) !== manifest.result_hash) throw new Error("committed Replay result hash mismatch")
  const actualLastEventKey = result.source_events.at(-1)?.event_key ?? null
  if (canonicalJson(actualLastEventKey) !== canonicalJson(manifest.completeness.last_committed_event_key)) {
    throw new Error("committed Replay last EventKey mismatch")
  }
  const expectedCheckpoint = computeTerminalCheckpointHash(request, trialReservation, result, actualLastEventKey)
  if (expectedCheckpoint !== manifest.completeness.terminal_checkpoint_hash) throw new Error("committed Replay terminal checkpoint hash mismatch")
  return {
    result,
    artifact_manifest: manifest,
    artifact_commit: {
      ref: manifestPath,
      sha256: createHash("sha256").update(manifestText).digest("hex"),
      producer_attempt_id: manifest.producer_attempt_id,
      terminal_checkpoint_hash: manifest.completeness.terminal_checkpoint_hash,
      storage_policy_version: REPLAY_CHECKPOINT_STORAGE_POLICY_VERSION,
    },
  }
}

function verifyArtifactCompleteness(directory: string, manifest: ReplayArtifactManifest): void {
  const required = [...REPLAY_REQUIRED_ARTIFACT_ROLES]
  if (manifest.completeness?.authoritative_result !== true
      || canonicalJson(manifest.completeness.required_roles) !== canonicalJson(required)
      || manifest.files.length !== required.length) {
    throw new Error("committed Replay artifact role set is incomplete")
  }
  for (let index = 0; index < required.length; index += 1) {
    const role = required[index]
    const file = manifest.files[index]
    const expectedRef = join(directory, ARTIFACT_FILE_NAMES[role])
    if (!file || file.role !== role || file.ref !== expectedRef || !existsSync(expectedRef)) {
      throw new Error(`committed Replay artifact is missing required role ${role}`)
    }
    const actualHash = createHash("sha256").update(readFileSync(expectedRef)).digest("hex")
    if (actualHash !== file.sha256) throw new Error(`committed Replay artifact hash mismatch for ${role}`)
  }
}

function computeTerminalCheckpointHash(
  request: ReplayExecutionRequest,
  reservation: TrialReservationSnapshot,
  result: ReplayResult,
  lastCommittedEventKey: ReplayEventKey | null,
): string {
  return canonicalHash({
    schema_version: "trade.rd-replay-terminal-checkpoint.v1",
    request_hash: canonicalHash(request),
    reservation_hash: hashTrialReservationSnapshot(reservation),
    result_hash: result.fingerprint.result_hash,
    last_committed_event_key: lastCommittedEventKey,
  })
}

function writeImmutable(directory: string, name: string, content: string, role: string): { role: string; ref: string; sha256: string } {
  const path = join(directory, name)
  return { role, ...writeReplayImmutableCas(path, content) }
}

function runDirectory(root: string, idempotencyKey: string, attemptId: string): string {
  return join(root, canonicalHash(idempotencyKey).slice(0, 24), canonicalHash(attemptId).slice(0, 24))
}

function commitDiagnosticCheckpoint(
  root: string,
  request: ReplayExecutionRequest,
  attemptLease: ReplayAttemptLeaseSnapshot,
  checkpoint: ReplayEngineCheckpoint,
): ReplayDiagnosticCheckpointCommitRef {
  const directory = runDirectory(root, request.idempotency_key, attemptLease.attempt_id)
  ensureReplayDurableDirectory(directory)
  const versionSuffix = `${attemptLease.lease_generation}-${checkpoint.next_source_offset}-${checkpoint.checkpoint_hash.slice(0, 16)}`
  const checkpointName = `diagnostic-checkpoint-${versionSuffix}.json`
  const checkpointFile = writeImmutable(
    directory,
    checkpointName,
    `${canonicalJson(checkpoint)}\n`,
    "diagnostic_checkpoint",
  )
  const record: ReplayDiagnosticCheckpointCommitRecord = {
    schema_version: REPLAY_DIAGNOSTIC_CHECKPOINT_COMMIT_SCHEMA_VERSION,
    run_id: request.run_id,
    request_hash: canonicalHash(request),
    dataset_hash: checkpoint.dataset_hash,
    producer_attempt_id: attemptLease.attempt_id,
    producer_lease_generation: attemptLease.lease_generation,
    producer_attempt_lease_hash: hashReplayAttemptLeaseSnapshot(attemptLease),
    storage_policy_version: REPLAY_CHECKPOINT_STORAGE_POLICY_VERSION,
    checkpoint_ref: checkpointFile.ref,
    checkpoint_sha256: checkpointFile.sha256,
    checkpoint_hash: checkpoint.checkpoint_hash,
    next_source_offset: checkpoint.next_source_offset,
    last_committed_event_key: checkpoint.last_committed_event_key,
    created_at: checkpoint.last_committed_event_key.event_time,
  }
  const commitFile = writeImmutable(
    directory,
    `diagnostic-checkpoint-commit-${versionSuffix}.json`,
    `${canonicalJson(record)}\n`,
    "diagnostic_checkpoint_commit",
  )
  return {
    ref: commitFile.ref,
    sha256: commitFile.sha256,
    checkpoint_ref: checkpointFile.ref,
    checkpoint_sha256: checkpointFile.sha256,
    checkpoint_hash: checkpoint.checkpoint_hash,
    producer_attempt_id: attemptLease.attempt_id,
    producer_lease_generation: attemptLease.lease_generation,
    storage_policy_version: REPLAY_CHECKPOINT_STORAGE_POLICY_VERSION,
    next_source_offset: checkpoint.next_source_offset,
  }
}

function loadReplayDiagnosticCheckpoint(
  root: string | undefined,
  locator: { ref: string; sha256: string },
  request: ReplayExecutionRequest,
  datasetManifest: ReplayDatasetManifest,
  expectedProducerAttemptId: string,
): ReplayEngineCheckpoint {
  if (!root) throw new Error("durable Replay checkpoint resume requires artifact_root")
  requireHash(locator.sha256, "resume_authorization.diagnostic_checkpoint_hash")
  const rootPath = resolve(root)
  const commitPath = resolve(locator.ref)
  const commitRelative = relative(rootPath, commitPath)
  if (commitRelative === ".." || commitRelative.startsWith(`..${sep}`)
      || !/^diagnostic-checkpoint-commit-\d+-\d+-[a-f0-9]{16}\.json$/.test(basename(commitPath))) {
    throw new Error("Replay diagnostic checkpoint commit ref is outside artifact_root or has an invalid name")
  }
  if (!existsSync(commitPath)) throw new Error("Replay diagnostic checkpoint commit does not exist")
  const commitBytes = readFileSync(commitPath)
  if (createHash("sha256").update(commitBytes).digest("hex") !== locator.sha256) {
    throw new Error("Replay diagnostic checkpoint commit hash mismatch")
  }
  const record = JSON.parse(commitBytes.toString("utf8")) as ReplayDiagnosticCheckpointCommitRecord
  if (record.schema_version !== REPLAY_DIAGNOSTIC_CHECKPOINT_COMMIT_SCHEMA_VERSION
      || record.run_id !== request.run_id
      || record.request_hash !== canonicalHash(request)
      || record.dataset_hash !== datasetManifest.data_hash
      || record.producer_attempt_id !== expectedProducerAttemptId) {
    throw new Error("Replay diagnostic checkpoint commit authority binding mismatch")
  }
  if (record.storage_policy_version !== REPLAY_CHECKPOINT_STORAGE_POLICY_VERSION) {
    throw new Error("Replay diagnostic checkpoint storage policy is not supported")
  }
  requireHash(record.producer_attempt_lease_hash, "diagnostic_checkpoint.producer_attempt_lease_hash")
  requireHash(record.checkpoint_sha256, "diagnostic_checkpoint.checkpoint_sha256")
  requireHash(record.checkpoint_hash, "diagnostic_checkpoint.checkpoint_hash")
  if (!Number.isSafeInteger(record.producer_lease_generation) || record.producer_lease_generation < 1
      || !Number.isSafeInteger(record.next_source_offset) || record.next_source_offset < 1) {
    throw new Error("Replay diagnostic checkpoint commit sequence fields are invalid")
  }
  const expectedCommitName = `diagnostic-checkpoint-commit-${record.producer_lease_generation}-${record.next_source_offset}-${record.checkpoint_hash.slice(0, 16)}.json`
  if (basename(commitPath) !== expectedCommitName) {
    throw new Error("Replay diagnostic checkpoint commit ref does not match its fenced progress identity")
  }
  const checkpointPath = resolve(record.checkpoint_ref)
  const expectedCheckpointName = `diagnostic-checkpoint-${record.producer_lease_generation}-${record.next_source_offset}-${record.checkpoint_hash.slice(0, 16)}.json`
  if (checkpointPath !== resolve(dirname(commitPath), expectedCheckpointName)) {
    throw new Error("Replay diagnostic checkpoint payload ref is not attempt-local")
  }
  if (!existsSync(checkpointPath)) throw new Error("Replay diagnostic checkpoint payload does not exist")
  const checkpointBytes = readFileSync(checkpointPath)
  if (createHash("sha256").update(checkpointBytes).digest("hex") !== record.checkpoint_sha256) {
    throw new Error("Replay diagnostic checkpoint payload hash mismatch")
  }
  const checkpoint = JSON.parse(checkpointBytes.toString("utf8")) as ReplayEngineCheckpoint
  if (checkpoint.checkpoint_hash !== record.checkpoint_hash
      || checkpoint.next_source_offset !== record.next_source_offset
      || canonicalJson(checkpoint.last_committed_event_key) !== canonicalJson(record.last_committed_event_key)) {
    throw new Error("Replay diagnostic checkpoint commit does not match its payload")
  }
  assertReplayEngineCheckpoint(checkpoint, request, datasetManifest)
  return checkpoint
}

function cleanupDiagnosticCheckpoint(root: string, request: ReplayExecutionRequest, attemptId: string): void {
  const directory = runDirectory(root, request.idempotency_key, attemptId)
  if (!existsSync(directory)) return
  for (const name of readdirSync(directory)) {
    if (!/^diagnostic-checkpoint(?:-commit)?-\d+-\d+-[a-f0-9]{16}\.json$/.test(name)) continue
    removeReplayDurableFile(join(directory, name))
  }
}

function requireHash(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${field} must be a lowercase sha256 hex digest`)
  }
}
