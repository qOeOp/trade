import {
  assertReplayAttemptCancellationObservationSnapshot,
  hashReplayAttemptLeaseSnapshot,
  hashTrialReservationSnapshot,
  type ReplayAttemptCancellationObservationSnapshot,
  type ReplayAttemptCancellationSnapshot,
  type ReplayAttemptLeaseSnapshot,
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import {
  createReplayAuthorityCancellationOutcome,
  runReplayTrial,
  type ReplayDiagnosticCheckpointCommitRef,
  type ReplayTrialRunInput,
  type ReplayTrialRunOutcome,
} from "./replay-trial-runner"
import type { ReplayEngineCheckpoint } from "../../../engine/src/lib/replay-reference-engine"
import { canonicalHash, canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import type {
  ReplayCancellationOutboxCommit,
  ReplayCancellationOutboxLoadedRecord,
  ReplayCancellationOutboxPort,
} from "./replay-cancellation-outbox"

export const REPLAY_CANCELLATION_COORDINATION_RESULT_SCHEMA_VERSION = "trade.rd-replay-cancellation-coordination-result.v1" as const
export const REPLAY_DURABLE_CANCELLATION_COORDINATION_RESULT_SCHEMA_VERSION = "trade.rd-replay-durable-cancellation-coordination-result.v1" as const

export interface ReplayCancellationDirective {
  command: "cancel"
  attempt_lease: ReplayAttemptLeaseSnapshot
  observed_at: string
  attempt_cancellation: ReplayAttemptCancellationSnapshot
}

export interface ReplayCancellationCoordinationPort {
  poll(input: {
    attempt_lease: ReplayAttemptLeaseSnapshot
    observed_at: string
  }): ReplayCancellationDirective | null
  acknowledge(input: {
    observation: ReplayAttemptCancellationObservationSnapshot
    registered_at: string
  }): void
}

export interface ReplayCancellationCoordinatorClock {
  now(): string
}

export interface ReplayCancellationCoordinationResult {
  schema_version: typeof REPLAY_CANCELLATION_COORDINATION_RESULT_SCHEMA_VERSION
  replay_outcome: ReplayTrialRunOutcome
  boundary_poll_count: number
  acknowledgement_status: "not_applicable" | "registered"
  registered_at: string | null
}

export interface ReplayDurableCancellationCoordinationResult {
  schema_version: typeof REPLAY_DURABLE_CANCELLATION_COORDINATION_RESULT_SCHEMA_VERSION
  coordination_result: ReplayCancellationCoordinationResult
  outbox_commit: ReplayCancellationOutboxCommit | null
}

export class ReplayCancellationAcknowledgementError extends Error {
  readonly replay_outcome: ReplayTrialRunOutcome
  readonly boundary_poll_count: number
  readonly attempted_registered_at: string
  readonly acknowledgement_cause: unknown
  readonly outbox_commit: ReplayCancellationOutboxCommit | undefined

  constructor(
    outcome: ReplayTrialRunOutcome,
    boundaryPollCount: number,
    attemptedRegisteredAt: string,
    cause: unknown,
    outboxCommit?: ReplayCancellationOutboxCommit,
  ) {
    super(`Replay cancellation acknowledgement failed: ${cause instanceof Error ? cause.message : String(cause)}`)
    this.name = "ReplayCancellationAcknowledgementError"
    this.replay_outcome = structuredClone(outcome)
    this.boundary_poll_count = boundaryPollCount
    this.attempted_registered_at = attemptedRegisteredAt
    this.acknowledgement_cause = cause
    this.outbox_commit = outboxCommit ? structuredClone(outboxCommit) : undefined
  }
}

export class ReplayCancellationOutboxPersistenceError extends Error {
  readonly replay_outcome: ReplayTrialRunOutcome
  readonly boundary_poll_count: number
  readonly attempted_persisted_at: string
  readonly persistence_cause: unknown

  constructor(
    outcome: ReplayTrialRunOutcome,
    boundaryPollCount: number,
    attemptedPersistedAt: string,
    cause: unknown,
  ) {
    super(`Replay cancellation outbox persistence failed: ${cause instanceof Error ? cause.message : String(cause)}`)
    this.name = "ReplayCancellationOutboxPersistenceError"
    this.replay_outcome = structuredClone(outcome)
    this.boundary_poll_count = boundaryPollCount
    this.attempted_persisted_at = attemptedPersistedAt
    this.persistence_cause = cause
  }
}

export function assertReplayCancellationAcknowledgementOutcome(
  replayOutcome: ReplayTrialRunOutcome,
  boundaryPollCount: number,
): ReplayAttemptCancellationObservationSnapshot {
  if (!Number.isSafeInteger(boundaryPollCount) || boundaryPollCount < 0) {
    throw new Error("Replay cancellation boundary poll count must be a non-negative integer")
  }
  const observation = replayOutcome.cancellation_observation
  if (replayOutcome.status !== "cancelled"
      || replayOutcome.failure?.code !== "execution-cancelled-at-checkpoint"
      || !observation
      || replayOutcome.result !== undefined
      || replayOutcome.artifact_manifest !== undefined
      || replayOutcome.artifact_commit !== undefined
      || replayOutcome.resumable_checkpoint !== undefined
      || replayOutcome.diagnostic_checkpoint_commit !== undefined) {
    throw new Error("Replay cancellation acknowledgement requires an authoritative cancelled outcome")
  }
  assertReplayAttemptCancellationObservationSnapshot(observation)
  if (observation.run_id !== replayOutcome.run_id
      || observation.attempt_id !== replayOutcome.attempt_id
      || observation.target_lease_generation !== replayOutcome.lease_generation
      || observation.outcome_schema_version !== replayOutcome.schema_version
      || observation.outcome_failure_code !== replayOutcome.failure.code) {
    throw new Error("Replay cancellation Observation does not match its Run Outcome")
  }
  return observation
}

export function acknowledgeReplayCancellationOutcome(
  replayOutcome: ReplayTrialRunOutcome,
  boundaryPollCount: number,
  port: ReplayCancellationCoordinationPort,
  clock: ReplayCancellationCoordinatorClock,
  outboxCommit?: ReplayCancellationOutboxCommit,
): ReplayCancellationCoordinationResult {
  const observation = assertReplayCancellationAcknowledgementOutcome(replayOutcome, boundaryPollCount)
  const registeredAt = clock.now()
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(registeredAt)
      || !Number.isFinite(Date.parse(registeredAt))
      || Date.parse(registeredAt) < Date.parse(observation.observed_at)) {
    throw new Error("Replay cancellation registration time must be RFC 3339 UTC at or after observation")
  }
  try {
    port.acknowledge({ observation: structuredClone(observation), registered_at: registeredAt })
  } catch (error) {
    throw new ReplayCancellationAcknowledgementError(
      replayOutcome,
      boundaryPollCount,
      registeredAt,
      error,
      outboxCommit,
    )
  }
  return {
    schema_version: REPLAY_CANCELLATION_COORDINATION_RESULT_SCHEMA_VERSION,
    replay_outcome: structuredClone(replayOutcome),
    boundary_poll_count: boundaryPollCount,
    acknowledgement_status: "registered",
    registered_at: registeredAt,
  }
}

export function runReplayTrialWithCancellationCoordination(
  input: ReplayTrialRunInput,
  port: ReplayCancellationCoordinationPort,
  clock: ReplayCancellationCoordinatorClock,
): ReplayCancellationCoordinationResult {
  const executed = executeReplayTrialWithCancellationPolling(input, port, clock)
  if (!executed.replay_outcome.cancellation_observation) {
    return {
      schema_version: REPLAY_CANCELLATION_COORDINATION_RESULT_SCHEMA_VERSION,
      replay_outcome: executed.replay_outcome,
      boundary_poll_count: executed.boundary_poll_count,
      acknowledgement_status: "not_applicable",
      registered_at: null,
    }
  }
  return acknowledgeReplayCancellationOutcome(
    executed.replay_outcome,
    executed.boundary_poll_count,
    port,
    clock,
  )
}

export function runReplayTrialWithDurableCancellationCoordination(
  input: ReplayTrialRunInput,
  port: ReplayCancellationCoordinationPort,
  clock: ReplayCancellationCoordinatorClock,
  outbox: ReplayCancellationOutboxPort,
): ReplayDurableCancellationCoordinationResult {
  const pending = outbox.load()
  if (pending) {
    assertReplayCancellationOutboxInvocationBinding(pending, input)
    return acknowledgeLoadedReplayCancellation(pending, port, clock)
  }
  let preparedOutcome: ReplayTrialRunOutcome | undefined
  let outboxCommit: ReplayCancellationOutboxCommit | undefined
  let attemptedPersistedAt: string | undefined
  let persistenceFailed = false
  let persistenceCause: unknown
  const executed = executeReplayTrialWithCancellationPolling(input, port, clock, ({
    directive,
    active_attempt_lease: activeAttemptLease,
    checkpoint,
    boundary_poll_count: boundaryPollCount,
  }) => {
    try {
      preparedOutcome = createReplayAuthorityCancellationOutcome({
        request: input.request,
        trial_reservation: input.trial_reservation,
        active_attempt_lease: activeAttemptLease,
        decision: directive,
        source_offset: checkpoint.next_source_offset,
        resume_authorization: input.execution_control?.resume_authorization,
      })
    } catch {
      return
    }
    attemptedPersistedAt = clock.now()
    try {
      outboxCommit = outbox.persist({
        replay_outcome: preparedOutcome,
        boundary_poll_count: boundaryPollCount,
        persisted_at: attemptedPersistedAt,
      })
    } catch (error) {
      persistenceFailed = true
      persistenceCause = error
    }
  })
  if (!executed.replay_outcome.cancellation_observation) {
    return {
      schema_version: REPLAY_DURABLE_CANCELLATION_COORDINATION_RESULT_SCHEMA_VERSION,
      coordination_result: {
        schema_version: REPLAY_CANCELLATION_COORDINATION_RESULT_SCHEMA_VERSION,
        replay_outcome: executed.replay_outcome,
        boundary_poll_count: executed.boundary_poll_count,
        acknowledgement_status: "not_applicable",
        registered_at: null,
      },
      outbox_commit: null,
    }
  }
  if (persistenceFailed) {
    throw new ReplayCancellationOutboxPersistenceError(
      executed.replay_outcome,
      executed.boundary_poll_count,
      attemptedPersistedAt!,
      persistenceCause,
    )
  }
  if (!preparedOutcome || !outboxCommit) {
    throw new Error("Replay authority cancellation reached terminal state without a pre-terminal outbox commit")
  }
  if (canonicalJson(preparedOutcome) !== canonicalJson(executed.replay_outcome)) {
    throw new Error("Replay pre-terminal cancellation outcome does not match the Runner terminal outcome")
  }
  return {
    schema_version: REPLAY_DURABLE_CANCELLATION_COORDINATION_RESULT_SCHEMA_VERSION,
    coordination_result: acknowledgeReplayCancellationOutcome(
      executed.replay_outcome,
      executed.boundary_poll_count,
      port,
      clock,
      outboxCommit,
    ),
    outbox_commit: outboxCommit,
  }
}

export function recoverReplayCancellationAcknowledgement(
  outbox: ReplayCancellationOutboxPort,
  port: ReplayCancellationCoordinationPort,
  clock: ReplayCancellationCoordinatorClock,
): ReplayDurableCancellationCoordinationResult | null {
  const loaded = outbox.load()
  if (!loaded) return null
  return acknowledgeLoadedReplayCancellation(loaded, port, clock)
}

function acknowledgeLoadedReplayCancellation(
  loaded: ReplayCancellationOutboxLoadedRecord,
  port: ReplayCancellationCoordinationPort,
  clock: ReplayCancellationCoordinatorClock,
): ReplayDurableCancellationCoordinationResult {
  return {
    schema_version: REPLAY_DURABLE_CANCELLATION_COORDINATION_RESULT_SCHEMA_VERSION,
    coordination_result: acknowledgeReplayCancellationOutcome(
      loaded.record.replay_outcome,
      loaded.record.boundary_poll_count,
      port,
      clock,
      loaded.commit,
    ),
    outbox_commit: loaded.commit,
  }
}

function assertReplayCancellationOutboxInvocationBinding(
  loaded: ReplayCancellationOutboxLoadedRecord,
  input: ReplayTrialRunInput,
): void {
  const outcome = loaded.record.replay_outcome
  const observation = assertReplayCancellationAcknowledgementOutcome(
    outcome,
    loaded.record.boundary_poll_count,
  )
  if (loaded.record.request_hash !== canonicalHash(input.request)
      || loaded.record.run_id !== input.request.run_id
      || loaded.record.attempt_id !== input.attempt_lease.attempt_id
      || loaded.record.lease_generation !== input.attempt_lease.lease_generation
      || outcome.attempt_lease_hash !== hashReplayAttemptLeaseSnapshot(input.attempt_lease)
      || observation.trial_id !== input.request.trial_id
      || observation.reservation_ref !== input.trial_reservation.reservation_ref
      || observation.reservation_hash !== hashTrialReservationSnapshot(input.trial_reservation)
      || observation.attempt_ordinal !== input.attempt_lease.attempt_ordinal
      || observation.worker_id !== input.attempt_lease.worker_id
      || loaded.commit.record_hash !== loaded.record.record_hash
      || loaded.commit.observation_hash !== observation.observation_hash
      || loaded.commit.producer_attempt_id !== input.attempt_lease.attempt_id
      || loaded.commit.producer_lease_generation !== input.attempt_lease.lease_generation) {
    throw new Error("Replay cancellation outbox does not match the durable coordinator invocation")
  }
}

function executeReplayTrialWithCancellationPolling(
  input: ReplayTrialRunInput,
  port: ReplayCancellationCoordinationPort,
  clock: ReplayCancellationCoordinatorClock,
  onAuthorityCancellation?: (input: {
    directive: ReplayCancellationDirective
    active_attempt_lease: ReplayAttemptLeaseSnapshot
    checkpoint: ReplayEngineCheckpoint
    boundary_poll_count: number
  }) => void,
): { replay_outcome: ReplayTrialRunOutcome; boundary_poll_count: number } {
  const delegatedControl = input.execution_control?.on_checkpoint
  let activeLease = structuredClone(input.attempt_lease)
  let boundaryPollCount = 0
  const replayOutcome = runReplayTrial({
    ...input,
    execution_control: {
      ...input.execution_control,
      on_checkpoint: (
        checkpoint: ReplayEngineCheckpoint,
        diagnosticCheckpointCommit: ReplayDiagnosticCheckpointCommitRef | undefined,
      ) => {
        const observedAt = clock.now()
        boundaryPollCount += 1
        const directive = port.poll({ attempt_lease: activeLease, observed_at: observedAt })
        if (directive) {
          onAuthorityCancellation?.({
            directive,
            active_attempt_lease: structuredClone(activeLease),
            checkpoint: structuredClone(checkpoint),
            boundary_poll_count: boundaryPollCount,
          })
          return directive
        }
        if (delegatedControl) {
          const delegated = delegatedControl(checkpoint, diagnosticCheckpointCommit)
          activeLease = structuredClone(delegated.attempt_lease)
          return delegated
        }
        return {
          command: "continue" as const,
          attempt_lease: activeLease,
          observed_at: observedAt,
        }
      },
    },
  })

  return { replay_outcome: replayOutcome, boundary_poll_count: boundaryPollCount }
}
