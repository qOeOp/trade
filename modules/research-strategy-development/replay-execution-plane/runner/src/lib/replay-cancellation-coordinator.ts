import type {
  ReplayAttemptCancellationObservationSnapshot,
  ReplayAttemptCancellationSnapshot,
  ReplayAttemptLeaseSnapshot,
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

  constructor(outcome: ReplayTrialRunOutcome, boundaryPollCount: number, cause: unknown) {
    super(`Replay cancellation acknowledgement failed: ${cause instanceof Error ? cause.message : String(cause)}`)
    this.name = "ReplayCancellationAcknowledgementError"
    this.replay_outcome = structuredClone(outcome)
    this.boundary_poll_count = boundaryPollCount
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
  const registeredAt = clock.now()
  try {
    port.acknowledge({
      observation: replayOutcome.cancellation_observation,
      registered_at: registeredAt,
    })
  } catch (error) {
    throw new ReplayCancellationAcknowledgementError(replayOutcome, boundaryPollCount, error)
  }
  return {
    schema_version: REPLAY_CANCELLATION_COORDINATION_RESULT_SCHEMA_VERSION,
    replay_outcome: replayOutcome,
    boundary_poll_count: boundaryPollCount,
    acknowledgement_status: "registered",
    registered_at: registeredAt,
  }
}
