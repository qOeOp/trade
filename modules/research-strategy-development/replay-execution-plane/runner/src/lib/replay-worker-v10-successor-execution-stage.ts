import { expect } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ReplayDecisionHarnessExecutionEnvelope } from "../../../contracts/src/lib/replay-decision-harness-execution-envelope"
import type { ReplayDecisionHarnessWorkerV10BuildCapability } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-build-capability"
import type { ReplayDecisionHarnessWorkerV10TransportContract } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-transport-contract"
import type {
  ReplayDecisionHarnessWorkerV10NegativeProbeReceipt,
  ReplayDecisionHarnessWorkerV10StdioCapability,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-stdio-capability"
import type { ReplayDecisionHarnessWorkerV10SuccessorTransportContract } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-transport-contract"
import type { ReplayDecisionHarnessWorkerV10ExecutionAdmissionContract } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-contract"
import type { ReplayDecisionHarnessWorkerV10SuccessorLeaseAdmission } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-lease-admission"
import {
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-envelope-admission"
import {
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-transport-admission"
import {
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-stdio-probe-admission"
import {
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-contract-admission"
import {
  readReplayWorkerV10SuccessorExecutionEnvelope,
  registerReplayWorkerV10SuccessorExecutionEnvelope,
} from "./replay-worker-v10-successor-execution-envelope-registry"
import {
  readReplayWorkerV10SuccessorExecutionTransport,
  registerReplayWorkerV10SuccessorExecutionTransport,
} from "./replay-worker-v10-successor-execution-transport-registry"
import {
  readReplayWorkerV10SuccessorExecutionStdioProbe,
  registerReplayWorkerV10SuccessorExecutionStdioProbe,
} from "./replay-worker-v10-successor-execution-stdio-probe-registry"
import {
  readReplayWorkerV10SuccessorExecutionContract,
  registerReplayWorkerV10SuccessorExecutionContract,
} from "./replay-worker-v10-successor-execution-contract-registry"
import { registerReplayWorkerV10TransportContract } from "./replay-worker-v10-transport-contract-registry"
import { registerReplayWorkerV10StdioCapability } from "./replay-worker-v10-stdio-capability-registry"
import {
  expectCompactSuccessorStdioProbe,
  expectSuccessorExecutionContracts,
} from "./replay-worker-v10-successor-contract-stage.assertions"

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
  const dispatchEvidenceRegistryRoot = input.registry_root
  const successorLeaseAdmission = input.successor_lease_admission
  const executionEnvelope = input.predecessor_execution_envelope
  const successorEnvelope = input.comparison_successor_envelope
  const attemptLease = { lease_generation: input.predecessor_lease_generation }
  const durableWorkerV10Capability = input.durable_worker_capability
  const workerV10TransportContract = input.predecessor_transport_contract
  const durableStdioCapability = input.predecessor_stdio_capability
  const negativeProbeReceipt = input.predecessor_negative_probe_receipt
  const successorTransportContract = input.predecessor_successor_transport_contract
  const executionAdmissionContract = input.predecessor_execution_admission_contract
  const replayProfile = input.profile

  const successorEnvelopeAdmission = registerReplayWorkerV10SuccessorExecutionEnvelope({
    registry_root: dispatchEvidenceRegistryRoot,
    source_successor_lease_admission: successorLeaseAdmission,
  })
  expect(successorEnvelopeAdmission.status)
    .toBe("successor_execution_envelope_admitted_command_not_materialized")
  expect(successorEnvelopeAdmission.source_successor_lease_admission_hash)
    .toBe(successorLeaseAdmission.admission_hash)
  expect(successorEnvelopeAdmission.source_predecessor_execution_envelope_hash)
    .toBe(executionEnvelope.envelope_hash)
  expect(successorEnvelopeAdmission.successor_execution_envelope.succession_kind)
    .toBe("same_attempt_lease_generation_successor")
  expect(successorEnvelopeAdmission.successor_execution_envelope.predecessor_execution_envelope_hash)
    .toBe(executionEnvelope.envelope_hash)
  expect(successorEnvelopeAdmission.successor_execution_envelope.attempt_lease_hash)
    .toBe(successorLeaseAdmission.successor_attempt_lease_hash)
  expect(successorEnvelopeAdmission.successor_execution_envelope.lease_generation)
    .toBe(attemptLease.lease_generation + 1)
  expect(successorEnvelopeAdmission.successor_execution_envelope.envelope_hash)
    .not.toBe(executionEnvelope.envelope_hash)
  expect(successorEnvelopeAdmission.successor_execution_envelope.envelope_hash)
    .not.toBe(successorEnvelope.envelope_hash)
  expect(successorEnvelopeAdmission.successor_execution_envelope_count).toBe(1)
  expect(successorEnvelopeAdmission.successor_execution_admission_command_count).toBe(0)
  expect(successorEnvelopeAdmission.successor_process_launch_intent_count).toBe(0)
  expect(successorEnvelopeAdmission.successor_authority_capsule_count).toBe(0)
  expect(successorEnvelopeAdmission.successor_spawn_revalidation_count).toBe(0)
  expect(successorEnvelopeAdmission.successor_process_count).toBe(0)
  expect(successorEnvelopeAdmission.second_response_count).toBe(0)
  expect(successorEnvelopeAdmission.second_schedule_admission_count).toBe(0)
  expect(successorEnvelopeAdmission.reproducibility_pair_count).toBe(0)
  expect(successorEnvelopeAdmission.harness_receipt_count).toBe(0)
  expect(successorEnvelopeAdmission.envelope_authority)
    .toBe("admitted_for_fresh_successor_command_construction_only")
  expect(successorEnvelopeAdmission.process_authority)
    .toBe("none_fresh_command_intent_capsule_revalidation_required")
  expect(successorEnvelopeAdmission.blockers).toEqual([
    "successor_command_intent_capsule_and_process_lineage_not_materialized",
    "second_distinct_fresh_process_schedule_admission_not_materialized",
    "response_reproducibility_pair_not_materialized",
    "worker_v10_harness_receipt_not_materialized",
  ])
  expect(successorEnvelopeAdmission.signal_authority).toBe("none")
  expect(successorEnvelopeAdmission.order_authority).toBe("none")
  expect(successorEnvelopeAdmission.economic_authority).toBe("none")
  expect(() => assertReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission(
    successorEnvelopeAdmission,
  )).not.toThrow()
  expect(readReplayWorkerV10SuccessorExecutionEnvelope({
    registry_root: dispatchEvidenceRegistryRoot,
    source_successor_lease_admission: successorLeaseAdmission,
  })).toEqual(successorEnvelopeAdmission)
  expect(registerReplayWorkerV10SuccessorExecutionEnvelope({
    registry_root: dispatchEvidenceRegistryRoot,
    source_successor_lease_admission: structuredClone(successorLeaseAdmission),
  })).toEqual(successorEnvelopeAdmission)
  expect(() => assertReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission({
    ...successorEnvelopeAdmission,
    successor_execution_admission_command_count: 1 as never,
  })).toThrow()

  expect(() => registerReplayWorkerV10TransportContract({
    registry_root: dispatchEvidenceRegistryRoot,
    source_worker_v10_build_capability: durableWorkerV10Capability,
    source_execution_envelope: successorEnvelopeAdmission.successor_execution_envelope,
  })).toThrow("requires the exact durable Execution Envelope")
  expect(() => registerReplayWorkerV10TransportContract({
    registry_root: dispatchEvidenceRegistryRoot,
    source_worker_v10_build_capability: durableWorkerV10Capability,
    source_execution_envelope: executionEnvelope,
    source_successor_execution_envelope_admission: successorEnvelopeAdmission,
  })).toThrow("successor Envelope Admission binding drift")
  const missingLeaseSuccessorTransportRoot = mkdtempSync(
    join(tmpdir(), "replay-worker-v10-successor-execution-transport-missing-"),
  )
  try {
    expect(() => registerReplayWorkerV10SuccessorExecutionTransport({
      registry_root: missingLeaseSuccessorTransportRoot,
      source_successor_execution_envelope_admission: successorEnvelopeAdmission,
    })).toThrow("requires the exact durable R4.144 Envelope Admission")
  } finally {
    rmSync(missingLeaseSuccessorTransportRoot, { recursive: true, force: true })
  }

  const successorTransportAdmission = registerReplayWorkerV10SuccessorExecutionTransport({
    registry_root: dispatchEvidenceRegistryRoot,
    source_successor_execution_envelope_admission: successorEnvelopeAdmission,
  })
  replayProfile("successor execution transport")
  expect(successorTransportAdmission.status)
    .toBe("successor_base_transport_admitted_command_not_materialized")
  expect(successorTransportAdmission.source_successor_execution_envelope_admission_hash)
    .toBe(successorEnvelopeAdmission.admission_hash)
  expect(successorTransportAdmission.source_predecessor_transport_contract_hash)
    .toBe(workerV10TransportContract.contract_hash)
  expect(successorTransportAdmission.successor_base_transport_contract_hash)
    .not.toBe(workerV10TransportContract.contract_hash)
  expect(successorTransportAdmission.successor_base_transport_contract.source_execution_envelope_hash)
    .toBe(successorEnvelopeAdmission.successor_execution_envelope_hash)
  expect(successorTransportAdmission.successor_base_transport_contract
    .source_worker_v10_build_capability_hash).toBe(durableWorkerV10Capability.capability_hash)
  expect(successorTransportAdmission.successor_base_transport_contract.target_worker_request_hash)
    .toBe(workerV10TransportContract.target_worker_request_hash)
  expect(successorTransportAdmission.reuse_boundary_policy)
    .toBe("reuse_only_envelope_independent_immutable_code_and_logical_request_evidence")
  expect(successorTransportAdmission.reusable_evidence).toEqual([
    "code_admission_and_source_bundle",
    "worker_v10_build_capability_and_decoder_artifact",
    "logical_worker_request_and_response_contract",
    "protocol_frame_schemas_and_resource_limits",
  ])
  expect(successorTransportAdmission.rebuild_required).toEqual([
    "execution_envelope_bound_base_transport_contract",
    "transport_bound_stdio_capability_even_if_artifact_bytes_rebuild_identically",
    "stdio_capability_bound_negative_probe_receipt",
    "artifact_bound_successor_transport_and_execution_admission_contract",
    "lease_observation_clock_command_intent_capsule_revalidation_and_process_lineage",
  ])
  expect(successorTransportAdmission.reused_worker_v10_build_capability_count).toBe(1)
  expect(successorTransportAdmission.successor_base_transport_contract_count).toBe(1)
  expect(successorTransportAdmission.successor_stdio_capability_count).toBe(0)
  expect(successorTransportAdmission.successor_negative_probe_receipt_count).toBe(0)
  expect(successorTransportAdmission.successor_artifact_bound_transport_contract_count).toBe(0)
  expect(successorTransportAdmission.successor_execution_admission_contract_count).toBe(0)
  expect(successorTransportAdmission.successor_execution_admission_command_count).toBe(0)
  expect(successorTransportAdmission.successor_process_count).toBe(0)
  expect(successorTransportAdmission.second_response_count).toBe(0)
  expect(successorTransportAdmission.second_schedule_admission_count).toBe(0)
  expect(successorTransportAdmission.reproducibility_pair_count).toBe(0)
  expect(successorTransportAdmission.harness_receipt_count).toBe(0)
  expect(successorTransportAdmission.transport_authority)
    .toBe("contract_frozen_zero_instance_not_activated")
  expect(successorTransportAdmission.command_authority)
    .toBe("none_fresh_envelope_bound_chain_required")
  expect(successorTransportAdmission.process_authority).toBe("none")
  expect(successorTransportAdmission.signal_authority).toBe("none")
  expect(successorTransportAdmission.order_authority).toBe("none")
  expect(successorTransportAdmission.economic_authority).toBe("none")
  expect(() => assertReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission(
    successorTransportAdmission,
  )).not.toThrow()
  expect(readReplayWorkerV10SuccessorExecutionTransport({
    registry_root: dispatchEvidenceRegistryRoot,
    source_successor_execution_envelope_admission: successorEnvelopeAdmission,
  })).toEqual(successorTransportAdmission)
  expect(registerReplayWorkerV10SuccessorExecutionTransport({
    registry_root: dispatchEvidenceRegistryRoot,
    source_successor_execution_envelope_admission: structuredClone(successorEnvelopeAdmission),
  })).toEqual(successorTransportAdmission)
  expect(() => assertReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission({
    ...successorTransportAdmission,
    successor_execution_admission_command_count: 1 as never,
  })).toThrow()

  expect(() => registerReplayWorkerV10StdioCapability({
    registry_root: dispatchEvidenceRegistryRoot,
    source_transport_contract: successorTransportAdmission.successor_base_transport_contract,
  })).toThrow()
  expect(() => registerReplayWorkerV10StdioCapability({
    registry_root: dispatchEvidenceRegistryRoot,
    source_transport_contract: workerV10TransportContract,
    source_successor_execution_transport_admission: successorTransportAdmission,
  })).toThrow("successor Transport Admission binding drift")
  const missingSuccessorStdioProbeRoot = mkdtempSync(
    join(tmpdir(), "replay-worker-v10-successor-execution-stdio-probe-missing-"),
  )
  try {
    expect(() => registerReplayWorkerV10SuccessorExecutionStdioProbe({
      registry_root: missingSuccessorStdioProbeRoot,
      source_successor_execution_transport_admission: successorTransportAdmission,
      clock: { now: () => "2026-07-14T00:01:00Z" },
    })).toThrow()
  } finally {
    rmSync(missingSuccessorStdioProbeRoot, { recursive: true, force: true })
  }

  let successorProbeClockCalls = 0
  const successorStdioProbeAdmission = registerReplayWorkerV10SuccessorExecutionStdioProbe({
    registry_root: dispatchEvidenceRegistryRoot,
    source_successor_execution_transport_admission: successorTransportAdmission,
    clock: {
      now: () => {
        successorProbeClockCalls += 1
        return "2026-07-14T00:01:00Z"
      },
    },
  })
  expect(successorProbeClockCalls).toBe(1)
  expectCompactSuccessorStdioProbe({
    admission: successorStdioProbeAdmission,
    source_transport: successorTransportAdmission,
    predecessor_stdio: durableStdioCapability,
    predecessor_probe_hash: negativeProbeReceipt.receipt_hash,
  })
  expect(readReplayWorkerV10SuccessorExecutionStdioProbe({
    registry_root: dispatchEvidenceRegistryRoot,
    source_successor_execution_transport_admission: successorTransportAdmission,
  })).toEqual(successorStdioProbeAdmission)
  expect(registerReplayWorkerV10SuccessorExecutionStdioProbe({
    registry_root: dispatchEvidenceRegistryRoot,
    source_successor_execution_transport_admission: structuredClone(successorTransportAdmission),
    clock: {
      now: () => {
        successorProbeClockCalls += 1
        return "2026-07-14T00:01:01Z"
      },
    },
  })).toEqual(successorStdioProbeAdmission)
  expect(successorProbeClockCalls).toBe(1)
  expect(() => assertReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission({
    ...successorStdioProbeAdmission,
    successor_worker_process_count: 1 as never,
  })).toThrow()

  const missingSuccessorExecutionContractRoot = mkdtempSync(
    join(tmpdir(), "replay-worker-v10-successor-execution-contract-missing-"),
  )
  try {
    expect(() => registerReplayWorkerV10SuccessorExecutionContract({
      registry_root: missingSuccessorExecutionContractRoot,
      source_successor_execution_stdio_probe_admission: successorStdioProbeAdmission,
    })).toThrow()
  } finally {
    rmSync(missingSuccessorExecutionContractRoot, { recursive: true, force: true })
  }

  const successorExecutionContractAdmission = registerReplayWorkerV10SuccessorExecutionContract({
    registry_root: dispatchEvidenceRegistryRoot,
    source_successor_execution_stdio_probe_admission: successorStdioProbeAdmission,
  })
  replayProfile("successor execution contract")
  expectSuccessorExecutionContracts({
    admission: successorExecutionContractAdmission,
    stdio_admission: successorStdioProbeAdmission,
    source_transport: successorTransportAdmission,
    source_envelope: successorEnvelopeAdmission,
    predecessor_transport: successorTransportContract,
    predecessor_execution: executionAdmissionContract,
  })
  expect(readReplayWorkerV10SuccessorExecutionContract({
    registry_root: dispatchEvidenceRegistryRoot,
    source_successor_execution_stdio_probe_admission: successorStdioProbeAdmission,
  })).toEqual(successorExecutionContractAdmission)
  expect(registerReplayWorkerV10SuccessorExecutionContract({
    registry_root: dispatchEvidenceRegistryRoot,
    source_successor_execution_stdio_probe_admission: structuredClone(successorStdioProbeAdmission),
  })).toEqual(successorExecutionContractAdmission)
  expect(() => assertReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission({
    ...successorExecutionContractAdmission,
    successor_execution_admission_command_count: 1 as never,
  })).toThrow()

  return {
    envelope_admission: successorEnvelopeAdmission,
    transport_admission: successorTransportAdmission,
    stdio_probe_admission: successorStdioProbeAdmission,
    execution_contract_admission: successorExecutionContractAdmission,
  }
}
