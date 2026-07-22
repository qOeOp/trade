import { expect } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  assertReplayDecisionHarnessWorkerV10SuccessorTransportContract,
  type ReplayDecisionHarnessWorkerV10SuccessorTransportContract,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-transport-contract"
import type {
  ReplayDecisionHarnessWorkerV10NegativeProbeReceipt,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-stdio-capability"
import {
  assertReplayDecisionHarnessWorkerV10SuccessorTransportContractLineage,
  buildReplayDecisionHarnessWorkerV10SuccessorTransportContract,
} from "./replay-decision-harness-worker-v10-successor-transport-contract"
import {
  readReplayWorkerV10SuccessorTransportContract,
  registerReplayWorkerV10SuccessorTransportContract,
} from "./replay-worker-v10-successor-transport-contract-registry"

export interface ReplayWorkerV10SuccessorTransportStageInput {
  registry_root: string
  negative_probe_receipt: ReplayDecisionHarnessWorkerV10NegativeProbeReceipt
  profile(stage: string): void
}

export interface ReplayWorkerV10SuccessorTransportStageOutput {
  successor_transport_contract: ReplayDecisionHarnessWorkerV10SuccessorTransportContract
}

export function runReplayWorkerV10SuccessorTransportStage(
  input: ReplayWorkerV10SuccessorTransportStageInput,
): ReplayWorkerV10SuccessorTransportStageOutput {
  const dispatchEvidenceRegistryRoot = input.registry_root
  const negativeProbeReceipt = input.negative_probe_receipt
  const workerV10StdioCapability = negativeProbeReceipt.source_stdio_capability
  const workerV10BuildCapability =
    workerV10StdioCapability.source_transport_contract.source_worker_v10_build_capability
  const logicalRequestArtifactHash =
    workerV10StdioCapability.source_transport_contract.logical_request_artifact_hash
  const replayProfile = input.profile

  const missingSuccessorTransportRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-successor-missing-"))
  try {
    expect(() => registerReplayWorkerV10SuccessorTransportContract({
      registry_root: missingSuccessorTransportRoot,
      source_negative_probe_receipt: negativeProbeReceipt,
    })).toThrow()
  } finally {
    rmSync(missingSuccessorTransportRoot, { recursive: true, force: true })
  }
  const successorTransportInput = { source_negative_probe_receipt: negativeProbeReceipt }
  const successorTransportContract = buildReplayDecisionHarnessWorkerV10SuccessorTransportContract(
    successorTransportInput,
  )
  replayProfile("successor transport")
  expect(successorTransportContract.status).toBe("artifact_bound_activation_blocked_zero_instance")
  expect(successorTransportContract.logical_request_artifact_hash).toBe(logicalRequestArtifactHash)
  expect(successorTransportContract.predecessor_decoder_artifact_hash)
    .toBe(workerV10BuildCapability.artifact.sha256)
  expect(successorTransportContract.successor_process_artifact_hash)
    .toBe(workerV10StdioCapability.artifact.sha256)
  expect(successorTransportContract.artifact_binding_status)
    .toBe("successor_stdio_process_artifact_bound")
  expect(successorTransportContract.predecessor_contract_relation)
    .toBe("r4_119_immutable_not_rewritten")
  expect(successorTransportContract.target_request_execution_admission).toBe("not_granted")
  expect(successorTransportContract.target_request_transport_status).toBe("not_invoked")
  expect(successorTransportContract.immutable_request_policy)
    .toBe("request_v10_markers_cannot_be_mutated_by_transport_contract")
  expect(successorTransportContract.blockers).toEqual([
    "target_worker_request_execution_admission_not_granted",
    "target_worker_request_transport_status_not_invoked",
    "current_lease_revalidation_for_successor_process_not_materialized",
    "attempt_bound_stdio_process_launch_intent_not_materialized",
    "attempt_bound_stdio_process_receipt_not_materialized",
    "worker_request_frame_instance_not_materialized",
    "worker_request_write_receipt_not_materialized",
    "worker_request_decode_receipt_not_materialized",
    "worker_response_frame_read_and_admission_not_materialized",
  ])
  expect(successorTransportContract.source_negative_probe_process_instance_count).toBe(5)
  expect(successorTransportContract.source_negative_probe_worker_request_frame_count).toBe(0)
  expect(successorTransportContract.admitted_process_instance_count).toBe(0)
  expect(successorTransportContract.current_lease_revalidation_receipt).toBeNull()
  expect(successorTransportContract.attempt_bound_process_launch_intent).toBeNull()
  expect(successorTransportContract.attempt_bound_process_receipt).toBeNull()
  expect(successorTransportContract.request_frame_instance_count).toBe(0)
  expect(successorTransportContract.request_write_receipt_count).toBe(0)
  expect(successorTransportContract.request_decode_receipt_count).toBe(0)
  expect(successorTransportContract.response_frame_instance_count).toBe(0)
  expect(successorTransportContract.response_read_receipt_count).toBe(0)
  expect(successorTransportContract.dispatch_occurrence).toBe("not_materialized")
  expect(successorTransportContract.transport_activation).toBe("blocked")
  expect(successorTransportContract.harness_invocation).toBe("forbidden")
  expect(() => assertReplayDecisionHarnessWorkerV10SuccessorTransportContract(
    successorTransportContract,
  )).not.toThrow()
  expect(() => assertReplayDecisionHarnessWorkerV10SuccessorTransportContractLineage(
    successorTransportContract,
    successorTransportInput,
  )).not.toThrow()
  expect(() => assertReplayDecisionHarnessWorkerV10SuccessorTransportContract({
    ...successorTransportContract,
    successor_process_artifact_hash: successorTransportContract.predecessor_decoder_artifact_hash,
  })).toThrow("parent or artifact binding drift")
  expect(() => assertReplayDecisionHarnessWorkerV10SuccessorTransportContract({
    ...successorTransportContract,
    request_frame_instance_count: 1 as never,
  })).toThrow("unsupported decision harness Worker v10 successor Transport Contract authority")

  const registeredSuccessorTransport = registerReplayWorkerV10SuccessorTransportContract({
    registry_root: dispatchEvidenceRegistryRoot,
    source_negative_probe_receipt: negativeProbeReceipt,
  })
  expect(registeredSuccessorTransport).toEqual(successorTransportContract)
  expect(registerReplayWorkerV10SuccessorTransportContract({
    registry_root: dispatchEvidenceRegistryRoot,
    source_negative_probe_receipt: structuredClone(negativeProbeReceipt),
  })).toEqual(successorTransportContract)
  expect(readReplayWorkerV10SuccessorTransportContract({
    registry_root: dispatchEvidenceRegistryRoot,
    source_negative_probe_receipt: negativeProbeReceipt,
  })).toEqual(successorTransportContract)

  return {
    successor_transport_contract: successorTransportContract,
  }
}
