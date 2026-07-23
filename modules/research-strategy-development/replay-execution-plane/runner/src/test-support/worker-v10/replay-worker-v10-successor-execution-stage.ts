import type { ReplayDecisionHarnessExecutionEnvelope } from "../../../../contracts/src/lib/replay-decision-harness-execution-envelope"
import type { ReplayDecisionHarnessWorkerV10BuildCapability } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-build-capability"
import type { ReplayDecisionHarnessWorkerV10ExecutionAdmissionContract } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-contract"
import type { ReplayDecisionHarnessWorkerV10NegativeProbeReceipt, ReplayDecisionHarnessWorkerV10StdioCapability } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-stdio-capability"
import type { ReplayDecisionHarnessWorkerV10SuccessorLeaseAdmission } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-lease-admission"
import type { ReplayDecisionHarnessWorkerV10SuccessorTransportContract } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-transport-contract"
import type { ReplayDecisionHarnessWorkerV10TransportContract } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-transport-contract"
import { runReplayWorkerV10SuccessorContractAdmissionStage } from "./replay-worker-v10-successor-contract-admission-stage"
import { runReplayWorkerV10SuccessorEnvelopeAdmissionStage } from "./replay-worker-v10-successor-envelope-admission-stage"
import { runReplayWorkerV10SuccessorStdioProbeStage } from "./replay-worker-v10-successor-stdio-probe-stage"
import { runReplayWorkerV10SuccessorTransportAdmissionStage } from "./replay-worker-v10-successor-transport-admission-stage"

export interface ReplayWorkerV10SuccessorExecutionStageInput {
  registry_root: string
  successor_lease_admission: ReplayDecisionHarnessWorkerV10SuccessorLeaseAdmission
  predecessor_execution_envelope: ReplayDecisionHarnessExecutionEnvelope
  comparison_successor_envelope: ReplayDecisionHarnessExecutionEnvelope
  predecessor_lease_generation: number
  durable_worker_capability: ReplayDecisionHarnessWorkerV10BuildCapability
  predecessor_transport_contract: ReplayDecisionHarnessWorkerV10TransportContract
  predecessor_stdio_capability: ReplayDecisionHarnessWorkerV10StdioCapability
  predecessor_negative_probe_receipt: ReplayDecisionHarnessWorkerV10NegativeProbeReceipt
  predecessor_successor_transport_contract:
    ReplayDecisionHarnessWorkerV10SuccessorTransportContract
  predecessor_execution_admission_contract:
    ReplayDecisionHarnessWorkerV10ExecutionAdmissionContract
  profile(stage: string): void
}

export function runReplayWorkerV10SuccessorExecutionStage(
  input: ReplayWorkerV10SuccessorExecutionStageInput,
) {
  const envelope = runReplayWorkerV10SuccessorEnvelopeAdmissionStage(input)
  const transport = runReplayWorkerV10SuccessorTransportAdmissionStage({
    ...input,
    envelope_admission: envelope.envelope_admission,
  })
  const stdio = runReplayWorkerV10SuccessorStdioProbeStage({
    ...input,
    transport_admission: transport.transport_admission,
  })
  const contract = runReplayWorkerV10SuccessorContractAdmissionStage({
    ...input,
    envelope_admission: envelope.envelope_admission,
    transport_admission: transport.transport_admission,
    stdio_probe_admission: stdio.stdio_probe_admission,
  })
  return {
    envelope_admission: envelope.envelope_admission,
    transport_admission: transport.transport_admission,
    stdio_probe_admission: stdio.stdio_probe_admission,
    execution_contract_admission: contract.execution_contract_admission,
  }
}
