import type { ReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-transport-admission"
import type { ReplayWorkerV10SuccessorExecutionPredecessorEvidence } from "./replay-worker-v10-successor-execution-stdio-probe-types"

export function extractReplayWorkerV10SuccessorExecutionPredecessorEvidence(
  transportAdmission: ReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission,
): ReplayWorkerV10SuccessorExecutionPredecessorEvidence {
  const pair = transportAdmission.source_successor_execution_envelope_admission
    .source_successor_lease_admission.source_successor_authority_contract
    .source_reproducibility_pair_contract
  const launch = pair.source_schedule_admission.source_response_validation.source_dispatch_receipt
    .source_dispatch_attempt.source_process_launch_receipt
  const command = launch.source_launch_attempt.source_spawn_revalidation.source_authority_capsule
    .source_authority_process_launch_intent.source_authority_execution_admission_command
  const predecessorCommand = command.source_authority_transport_contract.source_activated_stdio_capability
    .source_authority_frame_build_contract.source_launch_readiness_gate.source_process_launch_intent
    .source_execution_admission_command
  const execution = predecessorCommand.source_clock_binding.source_registry_provenance.source_pre_issue_bundle
    .source_execution_admission_contract
  const transport = execution.source_successor_transport_contract
  const capability = transport.source_negative_probe_receipt.source_stdio_capability
  if (capability.source_transport_contract_hash
      !== transportAdmission.source_predecessor_transport_contract_hash) {
    throw new Error("successor execution Stdio Probe does not embed its exact predecessor capability")
  }
  return {
    stdio_capability_hash: capability.capability_hash,
    transport_contract_hash: transport.contract_hash,
    execution_contract_hash: execution.contract_hash,
  }
}
