import { expect } from "bun:test"
import { canonicalJson } from "../../../../contracts/src/lib/replay-contracts"
import type { ReplayDecisionHarnessWorkerV10StdioCapability } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-stdio-capability"
import type { ReplayDecisionHarnessWorkerV10SuccessorTransportContract } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-transport-contract"
import type { ReplayDecisionHarnessWorkerV10ExecutionAdmissionContract } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-contract"
import type { ReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-transport-admission"
import type { ReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-envelope-admission"
import {
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission,
  type ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission,
} from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-stdio-probe-admission"
import {
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionContract,
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContract,
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission,
  type ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission,
} from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-contract-admission"

export function expectCompactSuccessorStdioProbe(input: {
  admission: ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission
  source_transport: ReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission
  predecessor_stdio: ReplayDecisionHarnessWorkerV10StdioCapability
  predecessor_probe_hash: string
}): void {
  const { admission, source_transport: source, predecessor_stdio: predecessor } = input
  expect(admission.status)
    .toBe("successor_stdio_and_negative_probe_admitted_execution_contract_not_materialized")
  expect(admission.source_successor_execution_transport_admission_hash).toBe(source.admission_hash)
  expect(admission.source_predecessor_stdio_capability_hash).toBe(predecessor.capability_hash)
  expect(admission.successor_stdio_capability_hash).not.toBe(predecessor.capability_hash)
  expect(admission.successor_stdio_artifact_evidence.source_transport_contract_hash)
    .toBe(source.successor_base_transport_contract_hash)
  expect(admission.successor_stdio_artifact_evidence.artifact.sha256).toBe(predecessor.artifact.sha256)
  expect(admission.successor_stdio_artifact_evidence.artifact.content_utf8)
    .toBe(predecessor.artifact.content_utf8)
  for (const forbidden of ["source_successor_execution_transport_admission",
    "source_predecessor_stdio_capability", "successor_negative_probe_receipt"]) {
    expect(Object.hasOwn(admission, forbidden)).toBe(false)
  }
  expect(Buffer.byteLength(canonicalJson(admission), "utf8")).toBeLessThan(512 * 1024)
  expect(admission.artifact_parity_status)
    .toBe("successor_rebuild_byte_identical_to_predecessor_stdio_artifact")
  expect(admission.successor_negative_probe_receipt_hash).not.toBe(input.predecessor_probe_hash)
  expect(admission.successor_process_artifact_hash)
    .toBe(admission.successor_stdio_artifact_evidence.artifact.sha256)
  expect(admission.successor_base_transport_contract_count).toBe(1)
  expect(admission.successor_stdio_capability_count).toBe(1)
  expect(admission.successor_negative_probe_receipt_count).toBe(1)
  expect(admission.successor_negative_probe_process_count).toBe(5)
  expect(admission.successor_worker_request_frame_count).toBe(0)
  expect(admission.successor_worker_request_decode_count).toBe(0)
  expect(admission.successor_artifact_bound_transport_contract_count).toBe(0)
  expect(admission.successor_execution_admission_contract_count).toBe(0)
  expect(admission.successor_execution_admission_command_count).toBe(0)
  expect(admission.successor_worker_process_count).toBe(0)
  expect(admission.second_response_count).toBe(0)
  expect(admission.second_schedule_admission_count).toBe(0)
  expect(admission.reproducibility_pair_count).toBe(0)
  expect(admission.harness_receipt_count).toBe(0)
  expect(admission.transport_authority).toBe("stdio_artifact_certified_activation_not_granted")
  expect(admission.command_authority).toBe("none")
  expect(admission.worker_process_authority).toBe("none")
  expect(admission.signal_authority).toBe("none")
  expect(admission.order_authority).toBe("none")
  expect(admission.economic_authority).toBe("none")
  expect(() => assertReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission(admission))
    .not.toThrow()
}

export function expectSuccessorExecutionContracts(input: {
  admission: ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission
  stdio_admission: ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission
  source_transport: ReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission
  source_envelope: ReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission
  predecessor_transport: ReplayDecisionHarnessWorkerV10SuccessorTransportContract
  predecessor_execution: ReplayDecisionHarnessWorkerV10ExecutionAdmissionContract
}): void {
  const { admission, stdio_admission: stdio, source_transport: source,
    source_envelope: envelope, predecessor_transport: predecessorTransport,
    predecessor_execution: predecessorExecution } = input
  const transport = admission.successor_artifact_bound_transport_contract
  const execution = admission.successor_execution_admission_contract
  expect(admission.status).toBe("successor_execution_contracts_admitted_command_not_issued")
  expect(admission.source_successor_execution_stdio_probe_admission_hash).toBe(stdio.admission_hash)
  expect(admission.source_predecessor_artifact_bound_transport_contract_hash)
    .toBe(predecessorTransport.contract_hash)
  expect(admission.source_predecessor_execution_admission_contract_hash)
    .toBe(predecessorExecution.contract_hash)
  expect(transport.contract_hash).not.toBe(predecessorTransport.contract_hash)
  expect(execution.contract_hash).not.toBe(predecessorExecution.contract_hash)
  expect(transport.successor_process_artifact_hash).toBe(predecessorTransport.successor_process_artifact_hash)
  expect(transport.source_successor_base_transport_contract_hash)
    .toBe(source.successor_base_transport_contract_hash)
  expect(transport.source_successor_execution_envelope_hash)
    .toBe(envelope.successor_execution_envelope_hash)
  expect(transport.source_successor_stdio_capability_hash).toBe(stdio.successor_stdio_capability_hash)
  expect(transport.source_successor_negative_probe_receipt_hash)
    .toBe(stdio.successor_negative_probe_receipt_hash)
  expect(execution.source_artifact_bound_transport_contract_hash).toBe(transport.contract_hash)
  expect(transport.target_worker_request_execution_admission).toBe("not_granted")
  expect(transport.target_worker_request_transport_status).toBe("not_invoked")
  expect(execution.admission_command_instance_count).toBe(0)
  expect(() => assertReplayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContract(transport))
    .not.toThrow()
  expect(() => assertReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionContract(execution))
    .not.toThrow()
  expect(admission.successor_base_transport_contract_count).toBe(1)
  expect(admission.successor_stdio_capability_count).toBe(1)
  expect(admission.successor_negative_probe_receipt_count).toBe(1)
  expect(admission.successor_negative_probe_process_count).toBe(5)
  expect(admission.successor_artifact_bound_transport_contract_count).toBe(1)
  expect(admission.successor_execution_admission_contract_count).toBe(1)
  expect(admission.successor_execution_admission_command_count).toBe(0)
  expect(admission.successor_worker_process_count).toBe(0)
  expect(admission.successor_worker_request_frame_count).toBe(0)
  expect(admission.successor_worker_request_decode_count).toBe(0)
  expect(admission.second_response_count).toBe(0)
  expect(admission.second_schedule_admission_count).toBe(0)
  expect(admission.reproducibility_pair_count).toBe(0)
  expect(admission.harness_receipt_count).toBe(0)
  expect(admission.transport_authority).toBe("artifact_bound_contract_frozen_activation_blocked")
  expect(admission.command_authority).toBe("contract_frozen_zero_instance_not_issued")
  expect(admission.worker_process_authority).toBe("none")
  expect(admission.signal_authority).toBe("none")
  expect(admission.order_authority).toBe("none")
  expect(admission.economic_authority).toBe("none")
  expect(() => assertReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission(admission))
    .not.toThrow()
}
