import type {
  ReplayAttemptLeaseObservationBody,
  ReplayAttemptLeaseObservationSnapshot,
  ReplayDispatchClockAttestation,
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import type { ReplayDecisionHarnessWorkerV10ActivatedStdioCapability } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-activated-stdio-capability"
import type { ReplayDecisionHarnessWorkerV10AuthorityTransportContract } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-transport-contract"
import type { ReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-command"
import type { ReplayDecisionHarnessWorkerV10ProcessLaunchIntent } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-process-launch-intent"
import type { ReplayDecisionHarnessWorkerV10SuccessorTransportContract } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-transport-contract"
import { runReplayWorkerV10AuthorityCapsuleAdmissionStage } from "./replay-worker-v10-authority-capsule-admission-stage"
import { runReplayWorkerV10AuthorityCommandAdmissionStage } from "./replay-worker-v10-authority-command-admission-stage"
import { runReplayWorkerV10AuthorityIntentAdmissionStage } from "./replay-worker-v10-authority-intent-admission-stage"

export interface ReplayWorkerV10AuthorityAdmissionStageInput {
  registry_root: string
  post_command_observation: ReplayAttemptLeaseObservationSnapshot
  authority_transport: ReplayDecisionHarnessWorkerV10AuthorityTransportContract
  activated_stdio: ReplayDecisionHarnessWorkerV10ActivatedStdioCapability
  predecessor_execution_command: ReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand
  predecessor_process_launch_intent: ReplayDecisionHarnessWorkerV10ProcessLaunchIntent
  post_command_clock_attestation: ReplayDispatchClockAttestation
  predecessor_successor_transport_contract:
    ReplayDecisionHarnessWorkerV10SuccessorTransportContract
  lease_observation_body: ReplayAttemptLeaseObservationBody
}

export function runReplayWorkerV10AuthorityAdmissionStage(
  input: ReplayWorkerV10AuthorityAdmissionStageInput,
) {
  const commandStage = runReplayWorkerV10AuthorityCommandAdmissionStage(input)
  const intentStage = runReplayWorkerV10AuthorityIntentAdmissionStage({
    ...input,
    authority_command: commandStage.command,
    authority_command_clock: commandStage.clock,
  })
  const capsuleStage = runReplayWorkerV10AuthorityCapsuleAdmissionStage({
    ...input,
    authority_command: commandStage.command,
    authority_intent: intentStage.intent,
  })
  return {
    command_input: commandStage.command_input,
    command: commandStage.command,
    intent_input: intentStage.intent_input,
    intent: intentStage.intent,
    intent_registry_receipt: intentStage.intent_registry_receipt,
    capsule_input: capsuleStage.capsule_input,
    capsule: capsuleStage.capsule,
  }
}
