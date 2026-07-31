import { expect } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ReplayDecisionHarnessExecutionEnvelope } from "../../../../contracts/src/lib/replay-decision-harness-execution-envelope"
import type { ReplayDecisionHarnessWorkerV10BuildCapability } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-build-capability"
import type { ReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-envelope-admission"
import { assertReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-transport-admission"
import type { ReplayDecisionHarnessWorkerV10TransportContract } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-transport-contract"
import { readReplayWorkerV10SuccessorExecutionTransport, registerReplayWorkerV10SuccessorExecutionTransport } from "../../lib/replay-worker-v10-successor-execution-transport-registry"
import { registerReplayWorkerV10TransportContract } from "../../lib/replay-worker-v10-transport-contract-registry"

export interface ReplayWorkerV10SuccessorTransportAdmissionStageInput {
  registry_root: string
  envelope_admission: ReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission
  predecessor_execution_envelope: ReplayDecisionHarnessExecutionEnvelope
  durable_worker_capability: ReplayDecisionHarnessWorkerV10BuildCapability
  predecessor_transport_contract: ReplayDecisionHarnessWorkerV10TransportContract
  profile(stage: string): void
}

export function runReplayWorkerV10SuccessorTransportAdmissionStage(
  input: ReplayWorkerV10SuccessorTransportAdmissionStageInput,
) {
  expect(() => registerReplayWorkerV10TransportContract({
    registry_root: input.registry_root,
    source_worker_v10_build_capability: input.durable_worker_capability,
    source_execution_envelope: input.envelope_admission.successor_execution_envelope,
  })).toThrow("requires the exact durable Execution Envelope")
  expect(() => registerReplayWorkerV10TransportContract({
    registry_root: input.registry_root,
    source_worker_v10_build_capability: input.durable_worker_capability,
    source_execution_envelope: input.predecessor_execution_envelope,
    source_successor_execution_envelope_admission: input.envelope_admission,
  })).toThrow("successor Envelope Admission binding drift")
  const missingRoot = mkdtempSync(
    join(tmpdir(), "replay-worker-v10-successor-execution-transport-missing-"),
  )
  try {
    expect(() => registerReplayWorkerV10SuccessorExecutionTransport({
      registry_root: missingRoot,
      source_successor_execution_envelope_admission: input.envelope_admission,
    })).toThrow("requires the exact durable R4.144 Envelope Admission")
  } finally {
    rmSync(missingRoot, { recursive: true, force: true })
  }
  const admission = registerReplayWorkerV10SuccessorExecutionTransport({
    registry_root: input.registry_root,
    source_successor_execution_envelope_admission: input.envelope_admission,
  })
  input.profile("successor execution transport")
  expect(admission.status).toBe("successor_base_transport_admitted_command_not_materialized")
  expect(admission.source_successor_execution_envelope_admission_hash)
    .toBe(input.envelope_admission.admission_hash)
  expect(admission.source_predecessor_transport_contract_hash)
    .toBe(input.predecessor_transport_contract.contract_hash)
  expect(admission.successor_base_transport_contract_hash)
    .not.toBe(input.predecessor_transport_contract.contract_hash)
  expect(admission.successor_base_transport_contract.source_execution_envelope_hash)
    .toBe(input.envelope_admission.successor_execution_envelope_hash)
  expect(admission.successor_base_transport_contract.source_worker_v10_build_capability_hash)
    .toBe(input.durable_worker_capability.capability_hash)
  expect(admission.successor_base_transport_contract.target_worker_request_hash)
    .toBe(input.predecessor_transport_contract.target_worker_request_hash)
  expect(admission.reuse_boundary_policy)
    .toBe("reuse_only_envelope_independent_immutable_code_and_logical_request_evidence")
  expect(admission.reusable_evidence).toEqual([
    "code_admission_and_source_bundle",
    "worker_v10_build_capability_and_decoder_artifact",
    "logical_worker_request_and_response_contract",
    "protocol_frame_schemas_and_resource_limits",
  ])
  expect(admission.rebuild_required).toEqual([
    "execution_envelope_bound_base_transport_contract",
    "transport_bound_stdio_capability_even_if_artifact_bytes_rebuild_identically",
    "stdio_capability_bound_negative_probe_receipt",
    "artifact_bound_successor_transport_and_execution_admission_contract",
    "lease_observation_clock_command_intent_capsule_revalidation_and_process_lineage",
  ])
  expect(admission.reused_worker_v10_build_capability_count).toBe(1)
  expect(admission.successor_base_transport_contract_count).toBe(1)
  expect(admission.successor_stdio_capability_count).toBe(0)
  expect(admission.successor_negative_probe_receipt_count).toBe(0)
  expect(admission.successor_artifact_bound_transport_contract_count).toBe(0)
  expect(admission.successor_execution_admission_contract_count).toBe(0)
  expect(admission.successor_execution_admission_command_count).toBe(0)
  expect(admission.successor_process_count).toBe(0)
  expect(admission.second_response_count).toBe(0)
  expect(admission.second_schedule_admission_count).toBe(0)
  expect(admission.reproducibility_pair_count).toBe(0)
  expect(admission.harness_receipt_count).toBe(0)
  expect(admission.transport_authority).toBe("contract_frozen_zero_instance_not_activated")
  expect(admission.command_authority).toBe("none_fresh_envelope_bound_chain_required")
  expect(admission.process_authority).toBe("none")
  expect(admission.signal_authority).toBe("none")
  expect(admission.order_authority).toBe("none")
  expect(admission.economic_authority).toBe("none")
  expect(() => assertReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission(admission))
    .not.toThrow()
  expect(readReplayWorkerV10SuccessorExecutionTransport({
    registry_root: input.registry_root,
    source_successor_execution_envelope_admission: input.envelope_admission,
  })).toEqual(admission)
  expect(registerReplayWorkerV10SuccessorExecutionTransport({
    registry_root: input.registry_root,
    source_successor_execution_envelope_admission: structuredClone(input.envelope_admission),
  })).toEqual(admission)
  expect(() => assertReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission({
    ...admission,
    successor_execution_admission_command_count: 1 as never,
  })).toThrow()
  return { transport_admission: admission }
}
