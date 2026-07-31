import type {
  ReplayAttemptLeaseObservationBody,
  ReplayAttemptLeaseObservationRegistryReadReceipt,
  ReplayAttemptLeaseObservationSnapshot,
  ReplayAttemptLeaseSnapshot,
  ReplayDispatchClockAttestation,
} from "../../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import type { ReplayDecisionHarnessDispatchClaim } from "../../../../contracts/src/lib/replay-decision-harness-dispatch-claim"
import type { ReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-clock-attestation"
import { runReplayWorkerV10PredecessorCommandStage } from "./replay-worker-v10-predecessor-command-stage"
import { runReplayWorkerV10PredecessorIntentStage } from "./replay-worker-v10-predecessor-intent-stage"
import { runReplayWorkerV10PredecessorReadinessStage } from "./replay-worker-v10-predecessor-readiness-stage"

export interface ReplayWorkerV10PredecessorLaunchStageInput {
  registry_root: string
  clock_binding: ReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation
  dispatch_claim: ReplayDecisionHarnessDispatchClaim
  pre_issue_observation: ReplayAttemptLeaseObservationSnapshot
  registry_read_receipt: ReplayAttemptLeaseObservationRegistryReadReceipt
  clock_attestation: ReplayDispatchClockAttestation
  attempt_lease: ReplayAttemptLeaseSnapshot
  lease_observation_body: ReplayAttemptLeaseObservationBody
  profile(stage: string): void
}

export function runReplayWorkerV10PredecessorLaunchStage(
  input: ReplayWorkerV10PredecessorLaunchStageInput,
) {
  const commandStage = runReplayWorkerV10PredecessorCommandStage(input)
  const intentStage = runReplayWorkerV10PredecessorIntentStage({
    registry_root: input.registry_root,
    execution_command: commandStage.execution_command,
    lease_observation_body: input.lease_observation_body,
    predecessor_clock_attestation: input.clock_attestation,
    attempt_lease: input.attempt_lease,
    profile: input.profile,
  })
  const readinessStage = runReplayWorkerV10PredecessorReadinessStage({
    registry_root: input.registry_root,
    process_launch_intent: intentStage.process_launch_intent,
    profile: input.profile,
  })
  return {
    command_input: commandStage.command_input,
    execution_command: commandStage.execution_command,
    post_command_observation: intentStage.post_command_observation,
    post_command_read_at: intentStage.post_command_read_at,
    post_command_registry_receipt: intentStage.post_command_registry_receipt,
    post_command_clock_attestation: intentStage.post_command_clock_attestation,
    process_intent_input: intentStage.process_intent_input,
    process_launch_intent: intentStage.process_launch_intent,
    process_readiness_input: readinessStage.process_readiness_input,
    process_launch_readiness: readinessStage.process_launch_readiness,
  }
}
