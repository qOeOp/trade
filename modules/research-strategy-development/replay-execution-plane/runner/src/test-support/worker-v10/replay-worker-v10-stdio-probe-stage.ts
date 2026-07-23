import { expect } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  assertReplayDecisionHarnessWorkerV10RequestFrame,
  createReplayDecisionHarnessWorkerV10RequestFrame,
  type ReplayDecisionHarnessWorkerV10TransportContract,
} from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-transport-contract"
import {
  assertReplayDecisionHarnessWorkerV10NegativeProbeReceipt,
  assertReplayDecisionHarnessWorkerV10StdioCapability,
  type ReplayDecisionHarnessWorkerV10NegativeProbeReceipt,
  type ReplayDecisionHarnessWorkerV10StdioCapability,
} from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-stdio-capability"
import {
  assertReplayDecisionHarnessWorkerV10StdioCapabilityLineage,
  buildReplayDecisionHarnessWorkerV10StdioCapability,
} from "../../lib/replay-decision-harness-worker-v10-stdio-build"
import {
  readReplayWorkerV10StdioCapability,
  registerReplayWorkerV10StdioCapability,
} from "../../lib/replay-worker-v10-stdio-capability-registry"
import {
  readReplayWorkerV10NegativeProbeReceipt,
  runReplayWorkerV10NegativeProbeSuite,
} from "../../lib/replay-worker-v10-negative-probe-registry"

export interface ReplayWorkerV10StdioProbeStageInput {
  registry_root: string
  registered_transport_contract: ReplayDecisionHarnessWorkerV10TransportContract
  profile(stage: string): void
}

export interface ReplayWorkerV10StdioProbeStageOutput {
  durable_stdio_capability: ReplayDecisionHarnessWorkerV10StdioCapability
  negative_probe_receipt: ReplayDecisionHarnessWorkerV10NegativeProbeReceipt
}

export function runReplayWorkerV10StdioProbeStage(
  input: ReplayWorkerV10StdioProbeStageInput,
): ReplayWorkerV10StdioProbeStageOutput {
  const dispatchEvidenceRegistryRoot = input.registry_root
  const registeredTransportContract = input.registered_transport_contract
  const workerV10TransportContract = registeredTransportContract
  const workerV10BuildCapability = registeredTransportContract.source_worker_v10_build_capability
  const replayProfile = input.profile

  const missingStdioCapabilityRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-stdio-missing-"))
  try {
    expect(() => registerReplayWorkerV10StdioCapability({
      registry_root: missingStdioCapabilityRoot,
      source_transport_contract: workerV10TransportContract,
    })).toThrow("requires the exact durable Transport Contract")
  } finally {
    rmSync(missingStdioCapabilityRoot, { recursive: true, force: true })
  }
  const workerV10StdioCapability = buildReplayDecisionHarnessWorkerV10StdioCapability({
    source_transport_contract: registeredTransportContract,
  })
  replayProfile("stdio capability")
  expect(workerV10StdioCapability.status)
    .toBe("stdio_process_capability_available_transport_activation_not_granted")
  expect(workerV10StdioCapability.source_decoder_artifact_hash)
    .toBe(workerV10BuildCapability.artifact.sha256)
  expect(workerV10StdioCapability.artifact.sha256)
    .not.toBe(workerV10StdioCapability.source_decoder_artifact_hash)
  expect(workerV10StdioCapability.artifact.sha256)
    .not.toBe(workerV10StdioCapability.source_legacy_v9_artifact_hash)
  expect(workerV10StdioCapability.r4_119_binding_relation)
    .toBe("successor_artifact_requires_new_transport_contract_no_retroactive_rewrite")
  expect(workerV10StdioCapability.valid_frame_policy)
    .toBe("reject_before_decode_until_successor_transport_activation")
  expect(workerV10StdioCapability.process_instance_count).toBe(0)
  expect(workerV10StdioCapability.worker_request_frame_instance_count).toBe(0)
  expect(workerV10StdioCapability.worker_request_decode_occurrence).toBe("not_materialized")
  expect(workerV10StdioCapability.harness_invocation).toBe("forbidden")
  expect(() => assertReplayDecisionHarnessWorkerV10StdioCapability(
    workerV10StdioCapability,
  )).not.toThrow()
  expect(() => assertReplayDecisionHarnessWorkerV10StdioCapabilityLineage(
    workerV10StdioCapability,
    { source_transport_contract: registeredTransportContract },
  )).not.toThrow()
  expect(() => assertReplayDecisionHarnessWorkerV10StdioCapability({
    ...workerV10StdioCapability,
    source_decoder_artifact_hash: workerV10StdioCapability.artifact.sha256,
  })).toThrow("parent or artifact binding drift")
  const targetWorkerRequest = registeredTransportContract.target_worker_request
  const successorArtifactFrame = createReplayDecisionHarnessWorkerV10RequestFrame({
    schema_version: registeredTransportContract.request_frame_schema_version,
    frame_kind: "worker_request",
    worker_protocol_version: registeredTransportContract.worker_protocol_version,
    transport_contract_id: registeredTransportContract.contract_id,
    transport_contract_hash: registeredTransportContract.contract_hash,
    execution_envelope_hash: registeredTransportContract.source_execution_envelope_hash,
    process_artifact_hash: workerV10StdioCapability.artifact.sha256,
    logical_request_id: targetWorkerRequest.logical_request_id,
    worker_request_hash: targetWorkerRequest.request_hash,
    worker_request: structuredClone(targetWorkerRequest),
    authority_status: "unadmitted_transport_candidate",
  })
  expect(() => assertReplayDecisionHarnessWorkerV10RequestFrame(
    successorArtifactFrame,
    workerV10TransportContract,
  )).toThrow("Transport Contract binding drift")

  const durableStdioCapability = registerReplayWorkerV10StdioCapability({
    registry_root: dispatchEvidenceRegistryRoot,
    source_transport_contract: registeredTransportContract,
  })
  expect(durableStdioCapability).toEqual(workerV10StdioCapability)
  expect(registerReplayWorkerV10StdioCapability({
    registry_root: dispatchEvidenceRegistryRoot,
    source_transport_contract: structuredClone(registeredTransportContract),
  })).toEqual(workerV10StdioCapability)
  expect(readReplayWorkerV10StdioCapability({
    registry_root: dispatchEvidenceRegistryRoot,
    source_transport_contract: registeredTransportContract,
  })).toEqual(workerV10StdioCapability)

  const negativeProbeReceipt = runReplayWorkerV10NegativeProbeSuite({
    registry_root: dispatchEvidenceRegistryRoot,
    source_stdio_capability: durableStdioCapability,
    clock: { now: () => "2026-07-14T00:00:33Z" },
  })
  expect(negativeProbeReceipt.status).toBe("complete_expected_pre_decode_rejections")
  expect(negativeProbeReceipt.probe_order).toEqual([
    "empty_eof",
    "invalid_json_lf",
    "missing_lf",
    "multiple_frames",
    "oversized_input",
  ])
  expect(negativeProbeReceipt.probe_results.map((item) => item.exit_status))
    .toEqual([64, 65, 67, 68, 66])
  expect(negativeProbeReceipt.process_instance_count).toBe(5)
  expect(negativeProbeReceipt.worker_request_frame_instance_count).toBe(0)
  expect(negativeProbeReceipt.worker_request_write_receipt_count).toBe(0)
  expect(negativeProbeReceipt.worker_request_decode_occurrence).toBe("not_materialized")
  expect(negativeProbeReceipt.dispatch_occurrence)
    .toBe("not_materialized_only_non_frame_probe_bytes")
  expect(negativeProbeReceipt.harness_invocation).toBe("forbidden")
  expect(() => assertReplayDecisionHarnessWorkerV10NegativeProbeReceipt(
    negativeProbeReceipt,
  )).not.toThrow()
  expect(runReplayWorkerV10NegativeProbeSuite({
    registry_root: dispatchEvidenceRegistryRoot,
    source_stdio_capability: durableStdioCapability,
    clock: { now: () => "2026-07-14T00:00:34Z" },
  })).toEqual(negativeProbeReceipt)
  expect(readReplayWorkerV10NegativeProbeReceipt({
    registry_root: dispatchEvidenceRegistryRoot,
    source_stdio_capability: durableStdioCapability,
  })).toEqual(negativeProbeReceipt)

  return {
    durable_stdio_capability: durableStdioCapability,
    negative_probe_receipt: negativeProbeReceipt,
  }
}
