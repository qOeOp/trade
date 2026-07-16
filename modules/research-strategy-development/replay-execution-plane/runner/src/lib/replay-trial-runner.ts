import { createHash } from "node:crypto"
import {
  assertReplayAttemptCancellationSnapshot,
  assertReplayAttemptLeaseSnapshot,
  assertReplayResumeAuthorizationSnapshot,
  assertTrialReservationSnapshot,
  createReplayAttemptCancellationObservationSnapshot,
  REPLAY_CHECKPOINT_STORAGE_POLICY_VERSION,
  hashReplayAttemptLeaseSnapshot,
  hashReplayResumeAuthorizationSnapshot,
  hashTrialReservationSnapshot,
  type ReplayAttemptCancellationObservationSnapshot,
  type ReplayAttemptCancellationSnapshot,
  type ReplayAttemptLeaseSnapshot,
  type ReplayResumeAuthorizationSnapshot,
  type TrialReservationSnapshot,
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import {
  REPLAY_ARTIFACT_SCHEMA_VERSION,
  REPLAY_CERTIFIED_CAPABILITIES,
  REPLAY_REQUIRED_ARTIFACT_ROLES,
  REPLAY_RESULT_SCHEMA_VERSION,
  assertReplayDataGapFailureEvidence,
  assertReplayDecisionEvidenceTimeline,
  assertReplayOhlcvResolutionEvidence,
  assertReplayResultOhlcvResolutionBindings,
  assertReplayResultPendingOrderBindings,
  canonicalHash,
  canonicalJson,
  createReplayDecisionEvidenceTimeline,
  replayAuthorizedInitialDecisionEvidenceEntry,
  replayDecisionPhaseFor,
  replayExecutionSpecHash,
  type ReplayArtifactManifest,
  type ReplayDatasetManifest,
  type ReplayDataGapFailureEvidence,
  type ReplayDecisionEvidenceTimeline,
  type ReplayExecutionRequest,
  type ReplayEventKey,
  type ReplayFundingEvent,
  type ReplayMarkEvent,
  type ReplayMaintenanceBreachObservation,
  type ReplayMarketBar,
  type ReplayMarginSnapshot,
  type ReplayPendingOrderResolution,
  type ReplayResult,
  type ReplayStopEntrySameBarPathAmbiguity,
  type ReplaySupplementalFact,
} from "../../../contracts/src/lib/replay-contracts"
import {
  ReplayEntryCancelBoundaryError,
  ReplayExecutionInterruptedError,
  ReplayPendingOrderAmbiguityError,
  ReplayStopEntrySameBarPathAmbiguityError,
  assertReplayEngineCheckpoint,
  executeReplayKernel,
  prepareReplayDecisionEvidenceInputs,
  type ReplayEngineCheckpoint,
} from "../../../engine/src/lib/replay-reference-engine"
import { assertReplayOhlcvEconomicImpactBindings } from "../../../engine/src/lib/replay-ohlcv-resolution"
import { ReplayLiquidationDeficitError, ReplayMarginTerminalError } from "../../../engine/src/lib/replay-margin-path"
import { ReplayInstrumentTerminalError, ReplayPendingEntryDelistedError } from "../../../engine/src/lib/replay-source-reducer"
import {
  createReplayLocalArtifactStore,
} from "./replay-local-artifact-store"
import {
  ReplayArtifactStoreContractError,
  assertCertifiedReplayArtifactStore,
  type ReplayArtifactNamespace,
  type ReplayArtifactReadFile,
  type ReplayArtifactStore,
} from "./replay-artifact-store"
import {
  ReplayDecisionHarnessError,
  executeReplayDecisionHarness,
  type ReplayDecisionHarnessRegistry,
} from "./replay-decision-harness"

export interface ReplayTrialRunInput {
  request: ReplayExecutionRequest
  trial_reservation: TrialReservationSnapshot
  attempt_lease: ReplayAttemptLeaseSnapshot
  observed_at: string
  dataset_manifest: ReplayDatasetManifest
  bars: ReplayMarketBar[]
  funding_events?: ReplayFundingEvent[]
  mark_events?: ReplayMarkEvent[]
  supplemental_facts?: ReplaySupplementalFact[]
  decision_harness_registry?: ReplayDecisionHarnessRegistry
  artifact_root?: string
  artifact_store?: ReplayArtifactStore
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
      attempt_cancellation?: ReplayAttemptCancellationSnapshot
    }
  }
}

export interface ReplayTrialRunOutcome {
  schema_version: "trade.rd-replay-run-outcome.v35"
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
  cancellation_observation?: ReplayAttemptCancellationObservationSnapshot
  failure?: {
    code: "trial-reservation-rejected" | "trial-reservation-expired" | "attempt-lease-rejected" | "resume-authorization-rejected" | "artifact-store-rejected" | "decision-harness-rejected" | "cancelled-before-start" | "execution-cancelled-at-checkpoint" | "instrument-delisted-with-open-position" | "instrument-delisted-with-pending-entry" | "initial-margin-deficit-without-resize" | "maintenance-margin-breach-without-liquidation" | "maintenance-margin-breach-while-halted" | "liquidation-deficit-unsupported" | "dataset-grid-gap-in-execution-window" | "missing-entry-cancel-boundary" | "pending-order-resolution-ambiguous" | "stop-entry-same-bar-path-ambiguous" | "replay-execution-failed"
    failure_class: "input_invalid" | "unsupported_contract" | "data_integrity" | "deterministic_engine" | "resource" | "external_io"
    message: string
    retryable: boolean
    partial_result_published: false
    event_key?: ReplayEventKey
    margin_snapshot?: ReplayMarginSnapshot
    maintenance_breach?: ReplayMaintenanceBreachObservation
    remaining_collateral?: number
    data_gap?: ReplayDataGapFailureEvidence
    pending_order_resolution?: ReplayPendingOrderResolution
    stop_entry_path_ambiguity?: ReplayStopEntrySameBarPathAmbiguity
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
    validateTrialReservation(input.request, input.trial_reservation, input.dataset_manifest)
  } catch (error) {
    return {
      schema_version: "trade.rd-replay-run-outcome.v35",
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
    const reservationExpired = error instanceof ReplayTrialReservationExpiredError
    return {
      schema_version: "trade.rd-replay-run-outcome.v35",
      run_id: input.request.run_id,
      attempt_id: input.attempt_lease.attempt_id,
      lease_generation: input.attempt_lease.lease_generation,
      status: "failed",
      idempotent_replay: false,
      failure: {
        code: reservationExpired ? "trial-reservation-expired" : "attempt-lease-rejected",
        failure_class: expired ? "resource" : "unsupported_contract",
        message: error instanceof Error ? error.message : String(error),
        retryable: expired && !reservationExpired,
        partial_result_published: false,
      },
    }
  }
  if (input.cancel_requested) {
    return {
      schema_version: "trade.rd-replay-run-outcome.v35",
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
  let cancellationObservation: ReplayAttemptCancellationObservationSnapshot | undefined
  let authorityCancellationOutcome: ReplayTrialRunOutcome | undefined
  let activeArtifactNamespace: ReplayArtifactNamespace | undefined
  try {
    const artifactStore = resolveArtifactStore(input)
    activeArtifactNamespace = artifactStore
      ? openAttemptNamespace(artifactStore, input.request, input.attempt_lease.attempt_id)
      : undefined
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
    const committed = activeArtifactNamespace
      ? readCommitted(
        activeArtifactNamespace, input.request, input.trial_reservation, input.attempt_lease,
        input.dataset_manifest, input.supplemental_facts || [],
      )
      : undefined
    if (committed) {
      cleanupDiagnosticCheckpoint(activeArtifactNamespace!)
      return {
        schema_version: "trade.rd-replay-run-outcome.v35",
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
    const decisionInputs = prepareReplayDecisionEvidenceInputs({
      request: input.request,
      dataset_manifest: input.dataset_manifest,
      bars: input.bars,
      funding_events: input.funding_events,
      mark_events: input.mark_events,
      supplemental_facts: input.supplemental_facts,
    })
    const decisionEvidence = decisionInputs.decisions.map((decision) => {
      const decisionPhase = replayDecisionPhaseFor(input.request, decision.schedule_entry)
      if (decisionPhase === "position_open" || decisionPhase === "pending_entry") {
        return { ...decision, evaluation_status: "pending_runtime" as const }
      }
      const decisionHarnessAdmission = executeReplayDecisionHarness({
        registry: input.decision_harness_registry,
        request: input.request,
        schedule_entry: decision.schedule_entry,
        decision_input_snapshot: decision.decision_input_snapshot,
        decision_market_input_snapshot: decision.decision_market_input_snapshot,
      })
      return {
        ...decision,
        decision_harness_bundle: decisionHarnessAdmission.source_bundle,
        decision_harness_build: decisionHarnessAdmission.build_attestation,
        decision_harness_receipt: decisionHarnessAdmission.receipt,
      }
    })
    const decisionEvidenceTimeline = createReplayDecisionEvidenceTimeline({
      request: input.request,
      decisions: decisionEvidence,
    })
    const resumeCheckpoint = input.execution_control?.resume_authorization
      ? loadReplayDiagnosticCheckpoint(
        artifactStore,
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
      supplemental_facts: input.supplemental_facts,
      decision_evidence_timeline: decisionEvidenceTimeline,
      runtime_decision_evaluator: (decision) => executeReplayDecisionHarness({
        registry: input.decision_harness_registry,
        request: input.request,
        schedule_entry: decision.schedule_entry,
        decision_input_snapshot: decision.decision_input_snapshot,
        decision_market_input_snapshot: decision.decision_market_input_snapshot,
        decision_state_snapshot: decision.decision_state_snapshot,
      }),
      execution_control: {
        resume_checkpoint: resumeCheckpoint,
        on_checkpoint: activeArtifactNamespace || input.execution_control?.on_checkpoint
          ? (checkpoint) => {
            if (activeArtifactNamespace) {
              lastDiagnosticCheckpointCommit = commitDiagnosticCheckpoint(
                activeArtifactNamespace, input.request, activeAttemptLease, checkpoint,
              )
            }
            if (!input.execution_control?.on_checkpoint) return "continue"
            const decision = input.execution_control.on_checkpoint(checkpoint, lastDiagnosticCheckpointCommit)
            try {
              validateAttemptLease(input.request, input.trial_reservation, decision.attempt_lease, decision.observed_at)
              assertAttemptLeaseSuccessor(activeAttemptLease, decision.attempt_lease)
              if (decision.attempt_cancellation) {
                authorityCancellationOutcome = createReplayAuthorityCancellationOutcome({
                  request: input.request,
                  trial_reservation: input.trial_reservation,
                  active_attempt_lease: activeAttemptLease,
                  decision: { ...decision, attempt_cancellation: decision.attempt_cancellation },
                  source_offset: checkpoint.next_source_offset,
                  resume_authorization: input.execution_control?.resume_authorization,
                })
                cancellationObservation = authorityCancellationOutcome.cancellation_observation
              }
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
    assertReplayResultOhlcvResolutionBindings(result, input.request)
    assertReplayResultPendingOrderBindings(result, input.request, input.dataset_manifest)
    assertResultOhlcvEconomicImpactBindings(result, input.request, input.dataset_manifest)
    const committedArtifact = activeArtifactNamespace
      ? commitArtifacts(
        activeArtifactNamespace, input.request, input.trial_reservation, activeAttemptLease,
        input.dataset_manifest, input.supplemental_facts || [], result,
      )
      : undefined
    if (activeArtifactNamespace) cleanupDiagnosticCheckpoint(activeArtifactNamespace)
    return {
      schema_version: "trade.rd-replay-run-outcome.v35",
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
    const artifactStoreRejected = error instanceof ReplayArtifactStoreContractError
    const decisionHarnessRejected = error instanceof ReplayDecisionHarnessError
    const instrumentTerminal = error instanceof ReplayInstrumentTerminalError
    const pendingEntryDelisted = error instanceof ReplayPendingEntryDelistedError
    const marginTerminal = error instanceof ReplayMarginTerminalError
    const liquidationDeficit = error instanceof ReplayLiquidationDeficitError
    const pendingOrderAmbiguity = error instanceof ReplayPendingOrderAmbiguityError
    const stopEntryPathAmbiguity = error instanceof ReplayStopEntrySameBarPathAmbiguityError
    const entryCancelBoundary = error instanceof ReplayEntryCancelBoundaryError
    const dataContinuity = isReplayDataContinuityFailure(error)
    const authorityCancelled = interrupted && cancellationObservation !== undefined
    if (authorityCancelled && activeArtifactNamespace) cleanupDiagnosticCheckpoint(activeArtifactNamespace)
    if (authorityCancelled && authorityCancellationOutcome) {
      return structuredClone(authorityCancellationOutcome)
    }
    return {
      schema_version: "trade.rd-replay-run-outcome.v35",
      run_id: input.request.run_id,
      attempt_id: activeAttemptLease.attempt_id,
      lease_generation: activeAttemptLease.lease_generation,
      attempt_lease_hash: activeAttemptLeaseHash,
      ...(resumeAuthorizationHash ? { resume_authorization_hash: resumeAuthorizationHash } : {}),
      status: interrupted ? "cancelled" : "failed",
      idempotent_replay: false,
      ...(interrupted && !authorityCancelled ? { resumable_checkpoint: error.checkpoint } : {}),
      ...(interrupted && !authorityCancelled && lastDiagnosticCheckpointCommit
        ? { diagnostic_checkpoint_commit: lastDiagnosticCheckpointCommit }
        : {}),
      ...(interrupted && cancellationObservation
        ? { cancellation_observation: cancellationObservation }
        : {}),
      failure: {
        code: interrupted ? error.code : leaseRejected ? "attempt-lease-rejected" : resumeRejected ? "resume-authorization-rejected" : artifactStoreRejected ? "artifact-store-rejected" : decisionHarnessRejected ? error.code : instrumentTerminal || pendingEntryDelisted || marginTerminal || liquidationDeficit || dataContinuity || pendingOrderAmbiguity || stopEntryPathAmbiguity || entryCancelBoundary ? error.code : "replay-execution-failed",
        failure_class: interrupted || leaseRejected ? "resource" : resumeRejected || artifactStoreRejected || decisionHarnessRejected ? "unsupported_contract" : instrumentTerminal || pendingEntryDelisted || marginTerminal || liquidationDeficit || pendingOrderAmbiguity || stopEntryPathAmbiguity ? "deterministic_engine" : "data_integrity",
        message: error instanceof Error ? error.message : String(error),
        retryable: false,
        partial_result_published: false,
        ...(instrumentTerminal || pendingEntryDelisted ? { event_key: error.terminal_event.event_key } : {}),
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
        ...(dataContinuity ? { data_gap: structuredClone(error.data_gap) } : {}),
        ...(pendingOrderAmbiguity ? {
          event_key: structuredClone(error.pending_order_resolution.observation.source_event_key),
          pending_order_resolution: structuredClone(error.pending_order_resolution),
        } : {}),
        ...(stopEntryPathAmbiguity ? {
          event_key: structuredClone(error.stop_entry_path_ambiguity.source_event_key),
          pending_order_resolution: structuredClone(error.pending_order_resolution),
          stop_entry_path_ambiguity: structuredClone(error.stop_entry_path_ambiguity),
        } : {}),
      },
    }
  }
}

interface ReplayDataContinuityFailure extends Error {
  code: "dataset-grid-gap-in-execution-window"
  data_gap: ReplayDataGapFailureEvidence
}

function isReplayDataContinuityFailure(error: unknown): error is ReplayDataContinuityFailure {
  if (!(error instanceof Error) || typeof error !== "object" || error === null) return false
  const candidate = error as Partial<ReplayDataContinuityFailure>
  if (candidate.code !== "dataset-grid-gap-in-execution-window" || !candidate.data_gap) return false
  try {
    assertReplayDataGapFailureEvidence(candidate.data_gap)
    return true
  } catch {
    return false
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

export function createReplayAuthorityCancellationOutcome(input: {
  request: ReplayExecutionRequest
  trial_reservation: TrialReservationSnapshot
  active_attempt_lease: ReplayAttemptLeaseSnapshot
  decision: {
    command: "continue" | "cancel"
    attempt_lease: ReplayAttemptLeaseSnapshot
    observed_at: string
    attempt_cancellation: ReplayAttemptCancellationSnapshot
  }
  source_offset: number
  resume_authorization?: ReplayResumeAuthorizationSnapshot
}): ReplayTrialRunOutcome {
  const { request, trial_reservation: reservation, active_attempt_lease: activeLease, decision } = input
  if (!Number.isSafeInteger(input.source_offset) || input.source_offset < 0) {
    throw new Error("Replay authority cancellation source offset must be a non-negative integer")
  }
  validateAttemptLease(request, reservation, decision.attempt_lease, decision.observed_at)
  assertAttemptLeaseSuccessor(activeLease, decision.attempt_lease)
  assertReplayAttemptCancellationSnapshot(decision.attempt_cancellation)
  const cancellation = decision.attempt_cancellation
  if (decision.command !== "cancel") {
    throw new Error("Replay Attempt authority cancellation requires a cancel command")
  }
  if (hashReplayAttemptLeaseSnapshot(decision.attempt_lease) !== hashReplayAttemptLeaseSnapshot(activeLease)) {
    throw new Error("Replay Attempt authority cancellation cannot renew or replace its terminal lease")
  }
  if (cancellation.trial_id !== request.trial_id
      || cancellation.run_id !== request.run_id
      || cancellation.request_hash !== canonicalHash(request)
      || cancellation.reservation_ref !== reservation.reservation_ref
      || cancellation.reservation_hash !== hashTrialReservationSnapshot(reservation)
      || cancellation.attempt_id !== activeLease.attempt_id
      || cancellation.attempt_ordinal !== activeLease.attempt_ordinal
      || cancellation.worker_id !== activeLease.worker_id
      || cancellation.target_lease_generation !== activeLease.lease_generation) {
    throw new Error("Replay Attempt authority cancellation does not match the active execution authority")
  }
  if (Date.parse(decision.observed_at) < Date.parse(cancellation.recorded_at)) {
    throw new Error("Replay Attempt authority cancellation cannot be observed before it is recorded")
  }
  const observation = createReplayAttemptCancellationObservationSnapshot({
    schema_version: "trade.rd-replay-attempt-cancellation-observation.v1",
    observation_id: `cancellation-observation-${cancellation.cancellation_hash}`,
    observation_ref: `cancellation-observation://${activeLease.attempt_id}/${cancellation.cancellation_hash}`,
    status: "observed",
    observed_at: decision.observed_at,
    cancellation_id: cancellation.cancellation_id,
    cancellation_ref: cancellation.cancellation_ref,
    cancellation_hash: cancellation.cancellation_hash,
    trial_id: cancellation.trial_id,
    run_id: cancellation.run_id,
    reservation_ref: cancellation.reservation_ref,
    reservation_hash: cancellation.reservation_hash,
    request_hash: cancellation.request_hash,
    attempt_id: cancellation.attempt_id,
    attempt_ordinal: cancellation.attempt_ordinal,
    worker_id: cancellation.worker_id,
    target_lease_generation: cancellation.target_lease_generation,
    outcome_schema_version: "trade.rd-replay-run-outcome.v35",
    outcome_status: "cancelled",
    outcome_failure_code: "execution-cancelled-at-checkpoint",
    partial_result_published: false,
  })
  return {
    schema_version: "trade.rd-replay-run-outcome.v35",
    run_id: request.run_id,
    attempt_id: activeLease.attempt_id,
    lease_generation: activeLease.lease_generation,
    attempt_lease_hash: hashReplayAttemptLeaseSnapshot(activeLease),
    ...(input.resume_authorization
      ? { resume_authorization_hash: hashReplayResumeAuthorizationSnapshot(input.resume_authorization) }
      : {}),
    status: "cancelled",
    idempotent_replay: false,
    cancellation_observation: observation,
    failure: {
      code: "execution-cancelled-at-checkpoint",
      failure_class: "resource",
      message: `Replay execution was cancelled after source offset ${input.source_offset}`,
      retryable: false,
      partial_result_published: false,
    },
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
  const claimed = Date.parse(lease.claimed_at)
  if (claimed < Date.parse(reservation.issued_at) || claimed >= Date.parse(reservation.expires_at)) {
    throw new ReplayTrialReservationExpiredError("Replay Attempt claim is outside the Trial Reservation validity window")
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
class ReplayTrialReservationExpiredError extends Error {}

function validateTrialReservation(
  request: ReplayExecutionRequest,
  reservation: TrialReservationSnapshot,
  datasetManifest: ReplayDatasetManifest,
): void {
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
      || bindings.liquidity_capacity_attestation_hash !== (request.order.entry_execution.order_type === "market"
        ? null
        : request.order.entry_execution.liquidity_capacity_attestation_hash)
      || bindings.supplemental_facts_hash !== request.supplemental_facts_hash
      || bindings.supplemental_requirement_set_hash !== request.supplemental_requirement_set_hash
      || bindings.venue_risk_policy_schedule_hash !== request.venue_risk_policy_schedule_hash
      || bindings.instrument_spec_schedule_hash !== request.instrument_spec_schedule_hash
      || bindings.instrument_status_schedule_hash !== request.instrument_status_schedule_hash
      || bindings.instrument_status_provenance_hash !== request.instrument_status_provenance_hash
      || bindings.instrument_status_provider_capability_hash !== request.instrument_status_provider_capability_hash
      || bindings.instrument_status_provider_certification_hash !== request.instrument_status_provider_certification_hash
      || bindings.harness_hash !== request.harness_hash
      || bindings.assumptions_hash !== request.assumptions_hash
      || bindings.cost_policy_hash !== canonicalHash(request.cost_policy)
      || bindings.margin_policy_hash !== canonicalHash(request.margin_policy)
      || bindings.simulator_policy_version !== request.simulator_policy.version
      || bindings.execution_mode !== "step") {
    throw new Error("Trial Reservation execution bindings do not match Replay request")
  }
  if (reservation.instrument_status_provider_certification.provider_capability_hash !== request.instrument_status_provider_capability_hash
      || reservation.instrument_status_provider_certification.certification_hash !== request.instrument_status_provider_certification_hash) {
    throw new Error("Trial Reservation provider certification does not match Replay request")
  }
  const statusProvenance = datasetManifest.instrument.status_provenance
  if (statusProvenance.provider_certification_ref !== reservation.instrument_status_provider_certification.certification_ref
      || statusProvenance.provider_certification_hash !== reservation.instrument_status_provider_certification.certification_hash
      || statusProvenance.provider_capability_hash !== reservation.instrument_status_provider_certification.provider_capability_hash
      || statusProvenance.producer_domain !== reservation.instrument_status_provider_certification.producer_domain
      || statusProvenance.producer_id !== reservation.instrument_status_provider_certification.producer_id
      || statusProvenance.producer_version !== reservation.instrument_status_provider_certification.producer_version
      || statusProvenance.producer_build_hash !== reservation.instrument_status_provider_certification.producer_build_hash
      || statusProvenance.normalization_policy_version !== reservation.instrument_status_provider_certification.normalization_policy_version
      || statusProvenance.normalization_policy_hash !== reservation.instrument_status_provider_certification.normalization_policy_hash
      || statusProvenance.source_kind !== reservation.instrument_status_provider_certification.allowed_source_kind
      || statusProvenance.completeness !== reservation.instrument_status_provider_certification.allowed_completeness) {
    throw new Error("Dataset status provenance does not bind the reserved provider certification")
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
  liquidity_capacity_attestation: "liquidity-capacity-attestation.json",
  supplemental_facts: "supplemental-facts.json",
  decision_market_input_snapshot: "decision-market-input-snapshot.json",
  decision_evidence_timeline: "decision-evidence-timeline.json",
  order_events: "order-events.jsonl", fills: "fills.jsonl", positions: "positions.jsonl", ledger: "ledger.jsonl",
  ohlcv_resolution_evidence: "ohlcv-resolution-evidence.json",
  pending_order_resolutions: "pending-order-resolutions.json",
  valuation_snapshot: "valuation-snapshot.json", equity_bridge: "equity-bridge.json", margin_snapshots: "margin-snapshots.json",
  liquidation: "liquidation.json", journal: "journal.jsonl", trial_balance: "trial-balance.json",
}

function commitArtifacts(
  namespace: ReplayArtifactNamespace,
  request: ReplayExecutionRequest,
  trialReservation: TrialReservationSnapshot,
  attemptLease: ReplayAttemptLeaseSnapshot,
  datasetManifest: ReplayDatasetManifest,
  supplementalFacts: ReplaySupplementalFact[],
  result: ReplayResult,
): { artifact_manifest: ReplayArtifactManifest; artifact_commit: ReplayArtifactCommit } {
  const requestText = `${canonicalJson(request)}\n`
  const trialReservationText = `${canonicalJson(trialReservation)}\n`
  const attemptLeaseText = `${canonicalJson(attemptLease)}\n`
  const datasetManifestText = `${canonicalJson(datasetManifest)}\n`
  const liquidityCapacityAttestationText = `${canonicalJson(datasetManifest.liquidity_capacity_attestation ?? null)}\n`
  const supplementalFactsText = `${canonicalJson(supplementalFacts)}\n`
  const decisionMarketInputSnapshotText = `${canonicalJson(replayAuthorizedInitialDecisionEvidenceEntry(result.decision_evidence_timeline).decision_market_input_snapshot)}\n`
  const decisionEvidenceTimelineText = `${canonicalJson(result.decision_evidence_timeline)}\n`
  const resultText = `${canonicalJson(result)}\n`
  const sourceEventsText = result.source_events.map((event) => canonicalJson(event)).join("\n") + "\n"
  const orderEventsText = result.order_events.map((event) => canonicalJson(event)).join("\n") + "\n"
  const fillsText = result.fills.map((fill) => canonicalJson(fill)).join("\n") + "\n"
  const positionsText = result.positions.map((position) => canonicalJson(position)).join("\n") + "\n"
  const ledgerText = result.ledger.map((entry) => canonicalJson(entry)).join("\n") + "\n"
  const ohlcvResolutionEvidenceText = `${canonicalJson(result.ohlcv_resolution_evidence)}\n`
  const pendingOrderResolutionsText = `${canonicalJson(result.pending_order_resolutions)}\n`
  const valuationSnapshotText = `${canonicalJson(result.valuation_snapshot)}\n`
  const equityBridgeText = `${canonicalJson(result.equity_bridge)}\n`
  const marginSnapshotsText = `${canonicalJson(result.margin_snapshots)}\n`
  const liquidationText = `${canonicalJson(result.liquidation)}\n`
  const journalText = result.journal.map((entry) => canonicalJson(entry)).join("\n") + "\n"
  const trialBalanceText = `${canonicalJson(result.trial_balance)}\n`
  const files = [
    writeImmutable(namespace, "request.json", requestText, "request"),
    writeImmutable(namespace, "trial-reservation.json", trialReservationText, "trial_reservation"),
    writeImmutable(namespace, "attempt-lease.json", attemptLeaseText, "attempt_lease"),
    writeImmutable(namespace, "dataset-manifest.json", datasetManifestText, "dataset_manifest"),
    writeImmutable(namespace, "liquidity-capacity-attestation.json", liquidityCapacityAttestationText, "liquidity_capacity_attestation"),
    writeImmutable(namespace, "supplemental-facts.json", supplementalFactsText, "supplemental_facts"),
    writeImmutable(namespace, "decision-market-input-snapshot.json", decisionMarketInputSnapshotText, "decision_market_input_snapshot"),
    writeImmutable(namespace, "decision-evidence-timeline.json", decisionEvidenceTimelineText, "decision_evidence_timeline"),
    writeImmutable(namespace, "result.json", resultText, "result"),
    writeImmutable(namespace, "source-events.jsonl", sourceEventsText, "source_events"),
    writeImmutable(namespace, "order-events.jsonl", orderEventsText, "order_events"),
    writeImmutable(namespace, "fills.jsonl", fillsText, "fills"),
    writeImmutable(namespace, "positions.jsonl", positionsText, "positions"),
    writeImmutable(namespace, "ledger.jsonl", ledgerText, "ledger"),
    writeImmutable(namespace, "ohlcv-resolution-evidence.json", ohlcvResolutionEvidenceText, "ohlcv_resolution_evidence"),
    writeImmutable(namespace, "pending-order-resolutions.json", pendingOrderResolutionsText, "pending_order_resolutions"),
    writeImmutable(namespace, "valuation-snapshot.json", valuationSnapshotText, "valuation_snapshot"),
    writeImmutable(namespace, "equity-bridge.json", equityBridgeText, "equity_bridge"),
    writeImmutable(namespace, "margin-snapshots.json", marginSnapshotsText, "margin_snapshots"),
    writeImmutable(namespace, "liquidation.json", liquidationText, "liquidation"),
    writeImmutable(namespace, "journal.jsonl", journalText, "journal"),
    writeImmutable(namespace, "trial-balance.json", trialBalanceText, "trial_balance"),
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
  const manifestFile = writeImmutable(namespace, "artifact-manifest.json", `${canonicalJson(manifest)}\n`, "manifest")
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

function assertResultOhlcvEconomicImpactBindings(
  result: ReplayResult,
  request: ReplayExecutionRequest,
  datasetManifest: ReplayDatasetManifest,
): void {
  if (result.ohlcv_resolution_evidence.length === 0) return
  const entryFill = result.fills.find((fill) => fill.order_role === "entry")
  if (!entryFill) throw new Error("Replay OHLCV economic impact requires one entry Fill basis")
  const accounting = datasetManifest.instrument.accounting
  for (const evidence of result.ohlcv_resolution_evidence) {
    assertReplayOhlcvEconomicImpactBindings(evidence, {
      entry_basis_price: entryFill.price,
      exit_side: request.order.side === "long" ? "sell" : "buy",
      cost_policy_id: request.cost_policy.policy_id,
      cost_policy_version: request.cost_policy.version,
      fee_bps: request.cost_policy.fee_bps,
      slippage_bps: request.cost_policy.slippage_bps,
      price_increment: accounting.price_increment,
      settlement_increment: accounting.settlement_increment,
      settlement_asset: accounting.settlement_asset,
    })
  }
}

function readCommitted(
  namespace: ReplayArtifactNamespace,
  request: ReplayExecutionRequest,
  trialReservation: TrialReservationSnapshot,
  attemptLease: ReplayAttemptLeaseSnapshot,
  datasetManifest: ReplayDatasetManifest,
  supplementalFacts: ReplaySupplementalFact[],
): { result: ReplayResult; artifact_manifest: ReplayArtifactManifest; artifact_commit: ReplayArtifactCommit } | undefined {
  if (!namespace.exists("artifact-manifest.json")) return undefined
  const manifestFile = namespace.read("artifact-manifest.json")
  const manifestText = decode(manifestFile.bytes)
  const manifest = JSON.parse(manifestText) as ReplayArtifactManifest
  if (manifest.schema_version !== REPLAY_ARTIFACT_SCHEMA_VERSION) throw new Error("committed Replay artifact schema is not supported")
  if (manifest.storage_policy_version !== REPLAY_CHECKPOINT_STORAGE_POLICY_VERSION) {
    throw new Error("committed Replay artifact storage policy is not supported")
  }
  verifyArtifactCompleteness(namespace, manifest)
  const recordedRequest = JSON.parse(decode(namespace.read(ARTIFACT_FILE_NAMES.request).bytes)) as ReplayExecutionRequest
  if (canonicalHash(recordedRequest) !== canonicalHash(request)) throw new Error("Replay idempotency key was reused with a different request")
  const recordedTrialReservation = JSON.parse(decode(namespace.read(ARTIFACT_FILE_NAMES.trial_reservation).bytes)) as TrialReservationSnapshot
  if (hashTrialReservationSnapshot(recordedTrialReservation) !== hashTrialReservationSnapshot(trialReservation)) {
    throw new Error("Replay idempotency key was reused with a different Trial Reservation")
  }
  const producerAttemptLease = JSON.parse(decode(namespace.read(ARTIFACT_FILE_NAMES.attempt_lease).bytes)) as ReplayAttemptLeaseSnapshot
  assertReplayAttemptLeaseSnapshot(producerAttemptLease)
  if (producerAttemptLease.attempt_id !== manifest.producer_attempt_id
      || hashReplayAttemptLeaseSnapshot(producerAttemptLease) !== manifest.producer_attempt_lease_hash
      || hashReplayAttemptLeaseSnapshot(producerAttemptLease) !== hashReplayAttemptLeaseSnapshot(attemptLease)) {
    throw new Error("committed Replay producer Attempt lease mismatch")
  }
  const recordedDatasetManifest = JSON.parse(decode(namespace.read(ARTIFACT_FILE_NAMES.dataset_manifest).bytes)) as ReplayDatasetManifest
  if (canonicalHash(recordedDatasetManifest) !== canonicalHash(datasetManifest)) throw new Error("Replay idempotency key was reused with a different dataset manifest")
  const recordedLiquidityCapacityAttestation = JSON.parse(
    decode(namespace.read(ARTIFACT_FILE_NAMES.liquidity_capacity_attestation).bytes),
  ) as ReplayDatasetManifest["liquidity_capacity_attestation"] | null
  if (canonicalHash(recordedLiquidityCapacityAttestation) !== canonicalHash(datasetManifest.liquidity_capacity_attestation ?? null)) {
    throw new Error("committed Replay liquidity capacity attestation does not match dataset manifest")
  }
  const recordedSupplementalFacts = JSON.parse(decode(namespace.read(ARTIFACT_FILE_NAMES.supplemental_facts).bytes)) as ReplaySupplementalFact[]
  if (canonicalHash(recordedSupplementalFacts) !== canonicalHash(supplementalFacts)
      || canonicalHash(recordedSupplementalFacts) !== request.supplemental_facts_hash) {
    throw new Error("Replay idempotency key was reused with different supplemental facts")
  }
  const result = JSON.parse(decode(namespace.read(ARTIFACT_FILE_NAMES.result).bytes)) as ReplayResult
  if (result.schema_version !== REPLAY_RESULT_SCHEMA_VERSION) throw new Error("committed Replay result schema is not supported")
  assertReplayResultOhlcvResolutionBindings(result, request)
  assertReplayResultPendingOrderBindings(result, request, datasetManifest)
  assertResultOhlcvEconomicImpactBindings(result, request, datasetManifest)
  if (manifest.run_id !== request.run_id || result.run_id !== request.run_id
      || manifest.result_hash !== result.fingerprint.result_hash) {
    throw new Error("committed Replay identity or Result hash binding mismatch")
  }
  const recordedDecisionEvidenceTimeline = JSON.parse(
    decode(namespace.read(ARTIFACT_FILE_NAMES.decision_evidence_timeline).bytes),
  ) as ReplayDecisionEvidenceTimeline
  assertReplayDecisionEvidenceTimeline(recordedDecisionEvidenceTimeline, request, { source_events: result.source_events })
  if (canonicalHash(recordedDecisionEvidenceTimeline) !== canonicalHash(result.decision_evidence_timeline)) {
    throw new Error("committed Replay Decision Evidence Timeline does not match Result")
  }
  const decisionEntry = replayAuthorizedInitialDecisionEvidenceEntry(recordedDecisionEvidenceTimeline)
  const recordedDecisionMarketInputSnapshot = JSON.parse(
    decode(namespace.read(ARTIFACT_FILE_NAMES.decision_market_input_snapshot).bytes),
  ) as typeof decisionEntry.decision_market_input_snapshot
  if (canonicalHash(recordedDecisionMarketInputSnapshot) !== canonicalHash(decisionEntry.decision_market_input_snapshot)) {
    throw new Error("committed Replay Decision Market Input Snapshot does not match timeline")
  }
  const recordedDecisionInputSnapshot = decisionEntry.decision_input_snapshot
  const recordedDecisionHarnessBundle = decisionEntry.decision_harness_bundle
  const recordedDecisionHarnessBuild = decisionEntry.decision_harness_build
  const recordedDecisionHarnessReceipt = decisionEntry.decision_harness_receipt
  const recordedOhlcvResolutionEvidence = JSON.parse(
    decode(namespace.read(ARTIFACT_FILE_NAMES.ohlcv_resolution_evidence).bytes),
  ) as ReplayResult["ohlcv_resolution_evidence"]
  recordedOhlcvResolutionEvidence.forEach(assertReplayOhlcvResolutionEvidence)
  if (canonicalHash(recordedOhlcvResolutionEvidence) !== canonicalHash(result.ohlcv_resolution_evidence)
      || result.fingerprint.ohlcv_resolution_evidence_hash !== canonicalHash(recordedOhlcvResolutionEvidence)) {
    throw new Error("committed Replay OHLCV Resolution Evidence does not match Result")
  }
  const recordedPendingOrderResolutions = JSON.parse(
    decode(namespace.read(ARTIFACT_FILE_NAMES.pending_order_resolutions).bytes),
  ) as ReplayResult["pending_order_resolutions"]
  if (canonicalHash(recordedPendingOrderResolutions) !== canonicalHash(result.pending_order_resolutions)
      || result.fingerprint.pending_order_resolutions_hash !== canonicalHash(recordedPendingOrderResolutions)) {
    throw new Error("committed Replay pending-order resolutions do not match Result")
  }
  if (result.supplemental_evidence.decision_input_snapshot_hash !== recordedDecisionInputSnapshot.snapshot_hash
      || result.fingerprint.decision_evidence_timeline_hash !== recordedDecisionEvidenceTimeline.timeline_hash
      || canonicalHash(result.fingerprint.decision_state_snapshot_hashes) !== canonicalHash(
        recordedDecisionEvidenceTimeline.entries.map((entry) => entry.decision_state_snapshot?.snapshot_hash ?? null),
      )
      || result.fingerprint.decision_boundary_hash !== decisionEntry.decision_boundary.boundary_hash
      || result.fingerprint.decision_input_snapshot_hash !== recordedDecisionInputSnapshot.snapshot_hash
      || result.fingerprint.decision_market_input_requirement_hash !== request.decision_market_input_requirement_hash
      || result.fingerprint.decision_schedule_hash !== request.decision_schedule_hash
      || result.fingerprint.decision_market_input_snapshot_hash !== recordedDecisionMarketInputSnapshot.snapshot_hash
      || result.fingerprint.decision_harness_receipt_hash !== (recordedDecisionHarnessReceipt?.receipt_hash ?? null)
      || result.fingerprint.decision_harness_bundle_hash !== (recordedDecisionHarnessBundle?.bundle_hash ?? null)
      || result.fingerprint.decision_harness_build_attestation_hash !== (recordedDecisionHarnessBuild?.attestation_hash ?? null)
      || result.fingerprint.decision_harness_build_artifact_hash !== (recordedDecisionHarnessBuild?.artifact.sha256 ?? null)
      || result.fingerprint.decision_harness_runtime_executable_hash !== (recordedDecisionHarnessBuild?.runtime.executable_sha256 ?? null)
      || result.fingerprint.decision_harness_registry_policy_version !== (recordedDecisionHarnessReceipt?.registry_policy_version ?? null)
      || result.fingerprint.decision_harness_loader_policy_version !== (recordedDecisionHarnessReceipt?.loader_policy_version ?? null)
      || result.fingerprint.decision_harness_worker_protocol_version !== (recordedDecisionHarnessReceipt?.worker_protocol_version ?? null)) {
    throw new Error("committed Replay Result decision evidence fingerprint mismatch")
  }
  if (canonicalHash({
    schema_version: result.schema_version,
    run_id: result.run_id,
    status: result.status,
    entry_outcome: result.entry_outcome,
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
    supplemental_evidence: result.supplemental_evidence,
    decision_evidence_timeline: result.decision_evidence_timeline,
    ohlcv_resolution_evidence: result.ohlcv_resolution_evidence,
    pending_order_resolutions: result.pending_order_resolutions,
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
      ref: manifestFile.ref,
      sha256: createHash("sha256").update(manifestFile.bytes).digest("hex"),
      producer_attempt_id: manifest.producer_attempt_id,
      terminal_checkpoint_hash: manifest.completeness.terminal_checkpoint_hash,
      storage_policy_version: REPLAY_CHECKPOINT_STORAGE_POLICY_VERSION,
    },
  }
}

function verifyArtifactCompleteness(namespace: ReplayArtifactNamespace, manifest: ReplayArtifactManifest): void {
  const required = [...REPLAY_REQUIRED_ARTIFACT_ROLES]
  if (manifest.completeness?.authoritative_result !== true
      || canonicalJson(manifest.completeness.required_roles) !== canonicalJson(required)
      || manifest.files.length !== required.length) {
    throw new Error("committed Replay artifact role set is incomplete")
  }
  for (let index = 0; index < required.length; index += 1) {
    const role = required[index]
    const file = manifest.files[index]
    const expectedName = ARTIFACT_FILE_NAMES[role]
    const expectedRef = namespace.fileRef(expectedName)
    if (!file || file.role !== role || file.ref !== expectedRef || !namespace.exists(expectedName)) {
      throw new Error(`committed Replay artifact is missing required role ${role}`)
    }
    const actualHash = createHash("sha256").update(namespace.read(expectedName).bytes).digest("hex")
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

function writeImmutable(namespace: ReplayArtifactNamespace, name: string, content: string, role: string): { role: string; ref: string; sha256: string } {
  return { role, ...namespace.writeImmutable(name, content) }
}

function commitDiagnosticCheckpoint(
  namespace: ReplayArtifactNamespace,
  request: ReplayExecutionRequest,
  attemptLease: ReplayAttemptLeaseSnapshot,
  checkpoint: ReplayEngineCheckpoint,
): ReplayDiagnosticCheckpointCommitRef {
  const versionSuffix = `${attemptLease.lease_generation}-${checkpoint.next_source_offset}-${checkpoint.checkpoint_hash.slice(0, 16)}`
  const checkpointName = `diagnostic-checkpoint-${versionSuffix}.json`
  const checkpointFile = writeImmutable(
    namespace,
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
    namespace,
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
  store: ReplayArtifactStore | undefined,
  locator: { ref: string; sha256: string },
  request: ReplayExecutionRequest,
  datasetManifest: ReplayDatasetManifest,
  expectedProducerAttemptId: string,
): ReplayEngineCheckpoint {
  if (!store) throw new ReplayArtifactStoreContractError("durable Replay checkpoint resume requires an Artifact Store")
  requireHash(locator.sha256, "resume_authorization.diagnostic_checkpoint_hash")
  const namespace = openAttemptNamespace(store, request, expectedProducerAttemptId)
  let commitFile: ReplayArtifactReadFile
  try {
    commitFile = namespace.readRef(locator.ref)
  } catch (error) {
    throw new Error(`Replay diagnostic checkpoint commit ref is invalid: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!/^diagnostic-checkpoint-commit-\d+-\d+-[a-f0-9]{16}\.json$/.test(commitFile.name)) {
    throw new Error("Replay diagnostic checkpoint commit ref has an invalid name")
  }
  if (createHash("sha256").update(commitFile.bytes).digest("hex") !== locator.sha256) {
    throw new Error("Replay diagnostic checkpoint commit hash mismatch")
  }
  const record = JSON.parse(decode(commitFile.bytes)) as ReplayDiagnosticCheckpointCommitRecord
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
  if (commitFile.name !== expectedCommitName) {
    throw new Error("Replay diagnostic checkpoint commit ref does not match its fenced progress identity")
  }
  const expectedCheckpointName = `diagnostic-checkpoint-${record.producer_lease_generation}-${record.next_source_offset}-${record.checkpoint_hash.slice(0, 16)}.json`
  if (record.checkpoint_ref !== namespace.fileRef(expectedCheckpointName)) {
    throw new Error("Replay diagnostic checkpoint payload ref is not attempt-local")
  }
  const checkpointFile = namespace.readRef(record.checkpoint_ref)
  if (createHash("sha256").update(checkpointFile.bytes).digest("hex") !== record.checkpoint_sha256) {
    throw new Error("Replay diagnostic checkpoint payload hash mismatch")
  }
  const checkpoint = JSON.parse(decode(checkpointFile.bytes)) as ReplayEngineCheckpoint
  if (checkpoint.checkpoint_hash !== record.checkpoint_hash
      || checkpoint.next_source_offset !== record.next_source_offset
      || canonicalJson(checkpoint.last_committed_event_key) !== canonicalJson(record.last_committed_event_key)) {
    throw new Error("Replay diagnostic checkpoint commit does not match its payload")
  }
  assertReplayEngineCheckpoint(checkpoint, request, datasetManifest)
  return checkpoint
}

function cleanupDiagnosticCheckpoint(namespace: ReplayArtifactNamespace): void {
  for (const name of namespace.listNames()) {
    if (!/^diagnostic-checkpoint(?:-commit)?-\d+-\d+-[a-f0-9]{16}\.json$/.test(name)) continue
    namespace.remove(name)
  }
}

function resolveArtifactStore(input: ReplayTrialRunInput): ReplayArtifactStore | undefined {
  if (input.artifact_root && input.artifact_store) {
    throw new ReplayArtifactStoreContractError("Replay execution accepts either artifact_root or artifact_store, not both")
  }
  const store = input.artifact_store ?? (input.artifact_root
    ? createReplayLocalArtifactStore(input.artifact_root)
    : undefined)
  if (store) assertCertifiedReplayArtifactStore(store)
  return store
}

function openAttemptNamespace(
  store: ReplayArtifactStore,
  request: ReplayExecutionRequest,
  attemptId: string,
): ReplayArtifactNamespace {
  return store.openAttempt({
    idempotency_key_hash: canonicalHash(request.idempotency_key),
    attempt_id_hash: canonicalHash(attemptId),
  })
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

function requireHash(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${field} must be a lowercase sha256 hex digest`)
  }
}
