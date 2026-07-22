import {
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission,
  type ReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-envelope-admission"
import {
  assertReplayDecisionHarnessWorkerV10TransportContract,
  type ReplayDecisionHarnessWorkerV10TransportContract,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-transport-contract"
import { readReplayWorkerV10SuccessorExecutionEnvelope } from "./replay-worker-v10-successor-execution-envelope-registry"
import type { RegisterReplayWorkerV10SuccessorExecutionTransportInput } from "./replay-worker-v10-successor-execution-transport-types"

export function requireReplayWorkerV10SuccessorExecutionTransportParent(
  input: RegisterReplayWorkerV10SuccessorExecutionTransportInput,
): void {
  if (input.registry_root.trim() === "") {
    throw new Error("successor execution Transport registry root is required")
  }
  const admission = input.source_successor_execution_envelope_admission
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission(admission)
  const durable = readReplayWorkerV10SuccessorExecutionEnvelope({
    registry_root: input.registry_root,
    source_successor_lease_admission: admission.source_successor_lease_admission,
  })
  if (!durable || durable.admission_hash !== admission.admission_hash) {
    throw new Error("successor execution Transport requires the exact durable R4.144 Envelope Admission")
  }
}

export function extractReplayWorkerV10PredecessorTransportContract(
  envelopeAdmission: ReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission,
): ReplayDecisionHarnessWorkerV10TransportContract {
  const pair = envelopeAdmission.source_successor_lease_admission.source_successor_authority_contract
    .source_reproducibility_pair_contract
  const launch = pair.source_schedule_admission.source_response_validation.source_dispatch_receipt
    .source_dispatch_attempt.source_process_launch_receipt
  const command = launch.source_launch_attempt.source_spawn_revalidation.source_authority_capsule
    .source_authority_process_launch_intent.source_authority_execution_admission_command
  const predecessorCommand = command.source_authority_transport_contract.source_activated_stdio_capability
    .source_authority_frame_build_contract.source_launch_readiness_gate.source_process_launch_intent
    .source_execution_admission_command
  const transport = predecessorCommand.source_clock_binding.source_registry_provenance.source_pre_issue_bundle
    .source_execution_admission_contract.source_successor_transport_contract.source_negative_probe_receipt
    .source_stdio_capability.source_transport_contract
  assertReplayDecisionHarnessWorkerV10TransportContract(transport)
  if (transport.source_execution_envelope_hash
      !== envelopeAdmission.source_predecessor_execution_envelope_hash) {
    throw new Error("successor execution Transport Admission does not embed its exact predecessor Transport")
  }
  return structuredClone(transport)
}
