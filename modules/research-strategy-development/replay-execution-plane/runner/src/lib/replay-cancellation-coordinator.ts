import {
  assertReplayAttemptCancellationObservationSnapshot,
  type ReplayAttemptCancellationObservationSnapshot,
  type ReplayAttemptCancellationSnapshot,
  type ReplayAttemptLeaseSnapshot,
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import {
  runReplayTrial,
  type ReplayDiagnosticCheckpointCommitRef,
  type ReplayTrialRunInput,
  type ReplayTrialRunOutcome,
} from "./replay-trial-runner"
import type { ReplayEngineCheckpoint } from "../../../engine/src/lib/replay-reference-engine"

export const REPLAY_CANCELLATION_COORDINATION_RESULT_SCHEMA_VERSION = "trade.rd-replay-cancellation-coordination-result.v1" as const

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

export class ReplayCancellationAcknowledgementError extends Error {
  readonly replay_outcome: ReplayTrialRunOutcome
  readonly boundary_poll_count: number
  readonly attempted_registered_at: string
  readonly acknowledgement_cause: unknown

  constructor(
    outcome: ReplayTrialRunOutcome,
    boundaryPollCount: number,
    attemptedRegisteredAt: string,
    cause: unknown,
  ) {
    super(`Replay cancellation acknowledgement failed: ${cause instanceof Error ? cause.message : String(cause)}`)
    this.name = "ReplayCancellationAcknowledgementError"
    this.replay_outcome = structuredClone(outcome)
    this.boundary_poll_count = boundaryPollCount
    this.attempted_registered_at = attemptedRegisteredAt
    this.acknowledgement_cause = cause
  }
}

export function acknowledgeReplayCancellationOutcome(
  replayOutcome: ReplayTrialRunOutcome,
  boundaryPollCount: number,
  port: ReplayCancellationCoordinationPort,
  clock: ReplayCancellationCoordinatorClock,
): ReplayCancellationCoordinationResult {
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
        if (directive) return directive
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

  if (!replayOutcome.cancellation_observation) {
    return {
      schema_version: REPLAY_CANCELLATION_COORDINATION_RESULT_SCHEMA_VERSION,
      replay_outcome: replayOutcome,
      boundary_poll_count: boundaryPollCount,
      acknowledgement_status: "not_applicable",
      registered_at: null,
    }
  }
  return acknowledgeReplayCancellationOutcome(replayOutcome, boundaryPollCount, port, clock)
}
