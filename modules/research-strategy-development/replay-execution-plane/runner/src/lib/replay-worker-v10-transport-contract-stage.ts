import { expect } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type {
  ReplayDecisionHarnessCodeAdmission,
} from "../../../contracts/src/lib/replay-decision-harness-code-admission"
import type {
  ReplayDecisionHarnessExecutionEnvelope,
} from "../../../contracts/src/lib/replay-decision-harness-execution-envelope"
import { canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import type {
  ReplayDecisionHarnessWorkerRequestV10,
} from "../../../contracts/src/lib/replay-decision-harness-worker-request-v10"
import type {
  ReplayDecisionHarnessWorkerResponseV10,
} from "../../../contracts/src/lib/replay-decision-harness-worker-response-v10-contract"
import type {
  ReplayDecisionHarnessWorkerV10BuildCapability,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-build-capability"
import {
  assertReplayDecisionHarnessWorkerV10RequestFrame,
  assertReplayDecisionHarnessWorkerV10ResponseFrame,
  assertReplayDecisionHarnessWorkerV10TransportContract,
  createReplayDecisionHarnessWorkerV10RequestFrame,
  createReplayDecisionHarnessWorkerV10ResponseFrame,
  type ReplayDecisionHarnessWorkerV10TransportContract,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-transport-contract"
import {
  assertReplayDecisionHarnessWorkerV10TransportContractLineage,
  buildReplayDecisionHarnessWorkerV10TransportContract,
  type BuildReplayDecisionHarnessWorkerV10TransportContractInput,
} from "./replay-decision-harness-worker-v10-transport-contract"
import {
  registerReplayWorkerV10BuildCapability,
} from "./replay-worker-v10-build-capability-registry"
import {
  readReplayWorkerV10TransportContract,
  registerReplayWorkerV10TransportContract,
} from "./replay-worker-v10-transport-contract-registry"

export interface ReplayWorkerV10TransportContractStageInput {
  registry_root: string
  worker_v10_build_capability: ReplayDecisionHarnessWorkerV10BuildCapability
  execution_envelope: ReplayDecisionHarnessExecutionEnvelope
  code_admission: ReplayDecisionHarnessCodeAdmission
  logical_request_artifact_hash: string
  worker_request: ReplayDecisionHarnessWorkerRequestV10
  worker_response: ReplayDecisionHarnessWorkerResponseV10
  profile(stage: string): void
}

export interface ReplayWorkerV10TransportContractStageOutput {
  durable_worker_capability: ReplayDecisionHarnessWorkerV10BuildCapability
  transport_contract_input: BuildReplayDecisionHarnessWorkerV10TransportContractInput
  worker_v10_transport_contract: ReplayDecisionHarnessWorkerV10TransportContract
  registered_transport_contract: ReplayDecisionHarnessWorkerV10TransportContract
}

export function runReplayWorkerV10TransportContractStage(
  input: ReplayWorkerV10TransportContractStageInput,
): ReplayWorkerV10TransportContractStageOutput {
  const dispatchEvidenceRegistryRoot = input.registry_root
  const workerV10BuildCapability = input.worker_v10_build_capability
  const executionEnvelope = input.execution_envelope
  const codeAdmission = input.code_admission
  const logicalRequestArtifactHash = input.logical_request_artifact_hash
  const firstRequestV10 = input.worker_request
  const responseV10 = input.worker_response
  const replayProfile = input.profile

  const missingTransportContractRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-transport-missing-"))
  try {
    expect(() => registerReplayWorkerV10TransportContract({
      registry_root: missingTransportContractRoot,
      source_worker_v10_build_capability: workerV10BuildCapability,
      source_execution_envelope: executionEnvelope,
    })).toThrow("requires the exact durable v10 Build Capability")
  } finally {
    rmSync(missingTransportContractRoot, { recursive: true, force: true })
  }
  const durableWorkerV10Capability = registerReplayWorkerV10BuildCapability({
    registry_root: dispatchEvidenceRegistryRoot,
    source_code_admission: codeAdmission,
  })
  expect(durableWorkerV10Capability).toEqual(workerV10BuildCapability)
  const transportContractInput = {
    source_worker_v10_build_capability: durableWorkerV10Capability,
    source_execution_envelope: executionEnvelope,
  }
  replayProfile("durable build capability")
  const workerV10TransportContract = buildReplayDecisionHarnessWorkerV10TransportContract(
    transportContractInput,
  )
  expect(workerV10TransportContract.status).toBe("frozen_blocked_zero_instance")
  expect(workerV10TransportContract.logical_request_artifact_hash).toBe(logicalRequestArtifactHash)
  expect(workerV10TransportContract.logical_request_artifact_role)
    .toBe("legacy_v9_code_admission_anchor_not_transport_executable")
  expect(workerV10TransportContract.transport_process_artifact_hash)
    .toBe(workerV10BuildCapability.artifact.sha256)
  expect(workerV10TransportContract.transport_process_artifact_hash)
    .not.toBe(workerV10TransportContract.logical_request_artifact_hash)
  expect(workerV10TransportContract.transport_process_artifact_role)
    .toBe("r4_118_v10_decoder_module_candidate_not_stdio_process_artifact")
  expect(workerV10TransportContract.artifact_bridge_status).toBe("exact_migration_lineage_verified")
  expect(workerV10TransportContract.migration_scope).toBe("v1_bridge_not_long_term_artifact_taxonomy")
  expect(workerV10TransportContract.process_model)
    .toBe("fresh_single_request_process_no_pool_keepalive_or_multiplex")
  expect(workerV10TransportContract.process_lifecycle).toEqual([
    "spawn_exact_artifact",
    "write_one_request_frame",
    "close_stdin",
    "read_one_response_frame",
    "await_process_exit",
  ])
  expect(workerV10TransportContract.request_frame_encoding).toBe("canonical_json_utf8_lf_then_eof")
  expect(workerV10TransportContract.response_frame_encoding)
    .toBe("canonical_json_utf8_lf_then_process_exit")
  expect(workerV10TransportContract.frame_identity_policy)
    .toBe("logical_frame_excludes_process_identity_write_receipt_must_bind_process")
  expect(workerV10TransportContract.blockers).toEqual([
    "source_v10_capability_is_decoder_module_without_stdio_loop",
    "v10_stdio_process_artifact_not_materialized",
    "v10_process_instance_not_materialized",
    "target_worker_request_execution_admission_not_granted",
    "target_worker_request_transport_status_not_invoked",
    "transport_frame_instances_not_materialized",
  ])
  expect(workerV10TransportContract.r4_117_gate_relation)
    .toBe("successor_contract_does_not_rewrite_prior_blocked_gate")
  expect(workerV10TransportContract.stdio_process_artifact).toBe("not_materialized")
  expect(workerV10TransportContract.process_instance_count).toBe(0)
  expect(workerV10TransportContract.request_frame_instance_count).toBe(0)
  expect(workerV10TransportContract.request_write_receipt_count).toBe(0)
  expect(workerV10TransportContract.response_frame_instance_count).toBe(0)
  expect(workerV10TransportContract.response_read_receipt_count).toBe(0)
  expect(workerV10TransportContract.dispatch_occurrence).toBe("not_materialized")
  expect(workerV10TransportContract.harness_invocation).toBe("forbidden")
  expect(workerV10TransportContract.decision_output_authority).toBe("none")
  expect(() => assertReplayDecisionHarnessWorkerV10TransportContract(
    workerV10TransportContract,
  )).not.toThrow()
  expect(() => assertReplayDecisionHarnessWorkerV10TransportContractLineage(
    workerV10TransportContract,
    transportContractInput,
  )).not.toThrow()

  const requestFrameCandidate = createReplayDecisionHarnessWorkerV10RequestFrame({
    schema_version: workerV10TransportContract.request_frame_schema_version,
    frame_kind: "worker_request",
    worker_protocol_version: workerV10TransportContract.worker_protocol_version,
    transport_contract_id: workerV10TransportContract.contract_id,
    transport_contract_hash: workerV10TransportContract.contract_hash,
    execution_envelope_hash: workerV10TransportContract.source_execution_envelope_hash,
    process_artifact_hash: workerV10TransportContract.transport_process_artifact_hash,
    logical_request_id: firstRequestV10.logical_request_id,
    worker_request_hash: firstRequestV10.request_hash,
    worker_request: structuredClone(firstRequestV10),
    authority_status: "unadmitted_transport_candidate",
  })
  expect(() => assertReplayDecisionHarnessWorkerV10RequestFrame(
    requestFrameCandidate,
    workerV10TransportContract,
  )).not.toThrow()
  expect(Buffer.byteLength(`${canonicalJson(requestFrameCandidate)}\n`, "utf8"))
    .toBeLessThanOrEqual(workerV10TransportContract.max_request_frame_bytes)
  const { frame_hash: requestFrameHash, ...requestFrameBody } = requestFrameCandidate
  expect(requestFrameHash).toHaveLength(64)
  const wrongArtifactRequestFrame = createReplayDecisionHarnessWorkerV10RequestFrame({
    ...requestFrameBody,
    process_artifact_hash: logicalRequestArtifactHash,
  })
  expect(() => assertReplayDecisionHarnessWorkerV10RequestFrame(
    wrongArtifactRequestFrame,
    workerV10TransportContract,
  )).toThrow("Transport Contract binding drift")

  const responseFrameCandidate = createReplayDecisionHarnessWorkerV10ResponseFrame({
    schema_version: workerV10TransportContract.response_frame_schema_version,
    frame_kind: "worker_response",
    worker_protocol_version: workerV10TransportContract.worker_protocol_version,
    transport_contract_id: workerV10TransportContract.contract_id,
    transport_contract_hash: workerV10TransportContract.contract_hash,
    execution_envelope_hash: workerV10TransportContract.source_execution_envelope_hash,
    process_artifact_hash: workerV10TransportContract.transport_process_artifact_hash,
    logical_request_id: responseV10.logical_request_id,
    worker_request_hash: responseV10.request_hash,
    worker_response_hash: responseV10.response_hash,
    worker_response: structuredClone(responseV10),
    authority_status: "unadmitted_transport_candidate",
  })
  expect(() => assertReplayDecisionHarnessWorkerV10ResponseFrame(
    responseFrameCandidate,
    workerV10TransportContract,
  )).not.toThrow()
  expect(Buffer.byteLength(`${canonicalJson(responseFrameCandidate)}\n`, "utf8"))
    .toBeLessThanOrEqual(workerV10TransportContract.max_response_frame_bytes)
  expect(() => assertReplayDecisionHarnessWorkerV10TransportContract({
    ...workerV10TransportContract,
    logical_request_artifact_hash: workerV10TransportContract.transport_process_artifact_hash,
  })).toThrow("parent or artifact bridge drift")
  expect(() => assertReplayDecisionHarnessWorkerV10TransportContract({
    ...workerV10TransportContract,
    request_frame_instance_count: 1 as never,
  })).toThrow("unsupported decision harness Worker v10 Transport Contract authority")

  const registeredTransportContract = registerReplayWorkerV10TransportContract({
    registry_root: dispatchEvidenceRegistryRoot,
    ...transportContractInput,
  })
  expect(registeredTransportContract).toEqual(workerV10TransportContract)
  expect(registerReplayWorkerV10TransportContract({
    registry_root: dispatchEvidenceRegistryRoot,
    source_worker_v10_build_capability: structuredClone(durableWorkerV10Capability),
    source_execution_envelope: structuredClone(executionEnvelope),
  })).toEqual(workerV10TransportContract)
  expect(readReplayWorkerV10TransportContract({
    registry_root: dispatchEvidenceRegistryRoot,
    ...transportContractInput,
  })).toEqual(workerV10TransportContract)
  return {
    durable_worker_capability: durableWorkerV10Capability,
    transport_contract_input: transportContractInput,
    worker_v10_transport_contract: workerV10TransportContract,
    registered_transport_contract: registeredTransportContract,
  }
}
