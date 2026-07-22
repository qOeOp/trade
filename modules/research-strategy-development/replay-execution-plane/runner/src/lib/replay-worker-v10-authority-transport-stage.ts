import { expect } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import type { ReplayDecisionHarnessExecutionEnvelope } from "../../../contracts/src/lib/replay-decision-harness-execution-envelope"
import type { ReplayDecisionHarnessWorkerRequestV10 } from "../../../contracts/src/lib/replay-decision-harness-worker-request-v10"
import type { ReplayDecisionHarnessWorkerResponseV10 } from "../../../contracts/src/lib/replay-decision-harness-worker-response-v10-contract"
import type { ReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGate } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-process-launch-readiness-gate"
import type { ReplayDecisionHarnessWorkerV10SuccessorTransportContract } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-transport-contract"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_FRAME_SCHEMA_VERSION,
  assertReplayDecisionHarnessWorkerV10AuthorityFrameBuildContract,
  assertReplayDecisionHarnessWorkerV10AuthorityRequestFrame,
  assertReplayDecisionHarnessWorkerV10AuthorityResponseFrame,
  createReplayDecisionHarnessWorkerV10AuthorityRequestFrame,
  createReplayDecisionHarnessWorkerV10AuthorityResponseFrame,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-frame-build-contract"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_ENV,
  assertReplayDecisionHarnessWorkerV10ActivatedStdioCapability,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-activated-stdio-capability"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_RECEIPT_BINDINGS,
  assertReplayDecisionHarnessWorkerV10AuthorityTransportContract,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-transport-contract"
import {
  assertReplayDecisionHarnessWorkerV10AuthorityFrameBuildContractLineage,
  buildReplayDecisionHarnessWorkerV10AuthorityFrameBuildContract,
} from "./replay-decision-harness-worker-v10-authority-frame-build-contract"
import {
  readReplayWorkerV10AuthorityFrameBuildContract,
  registerReplayWorkerV10AuthorityFrameBuildContract,
} from "./replay-worker-v10-authority-frame-build-contract-registry"
import {
  assertReplayDecisionHarnessWorkerV10ActivatedStdioCapabilityLineage,
  buildReplayDecisionHarnessWorkerV10ActivatedStdioCapability,
} from "./replay-decision-harness-worker-v10-activated-stdio-build"
import {
  readReplayWorkerV10ActivatedStdioCapability,
  registerReplayWorkerV10ActivatedStdioCapability,
} from "./replay-worker-v10-activated-stdio-capability-registry"
import {
  assertReplayDecisionHarnessWorkerV10AuthorityTransportContractLineage,
  buildReplayDecisionHarnessWorkerV10AuthorityTransportContract,
} from "./replay-decision-harness-worker-v10-authority-transport-contract"
import {
  readReplayWorkerV10AuthorityTransportContract,
  registerReplayWorkerV10AuthorityTransportContract,
} from "./replay-worker-v10-authority-transport-contract-registry"

export interface ReplayWorkerV10AuthorityTransportStageInput {
  registry_root: string
  process_launch_readiness: ReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGate
  first_worker_request: ReplayDecisionHarnessWorkerRequestV10
  execution_envelope: ReplayDecisionHarnessExecutionEnvelope
  first_worker_response: ReplayDecisionHarnessWorkerResponseV10
  predecessor_successor_transport_contract:
    ReplayDecisionHarnessWorkerV10SuccessorTransportContract
  profile(stage: string): void
}

export function runReplayWorkerV10AuthorityTransportStage(
  input: ReplayWorkerV10AuthorityTransportStageInput,
) {
  const dispatchEvidenceRegistryRoot = input.registry_root
  const processLaunchReadiness = input.process_launch_readiness
  const firstRequestV10 = input.first_worker_request
  const executionEnvelope = input.execution_envelope
  const responseV10 = input.first_worker_response
  const successorTransportContract = input.predecessor_successor_transport_contract
  const replayProfile = input.profile

  const authorityBuildInput = { source_launch_readiness_gate: processLaunchReadiness }
  const authorityFrameBuild = buildReplayDecisionHarnessWorkerV10AuthorityFrameBuildContract(
    authorityBuildInput,
  )
  replayProfile("authority frame build")
  expect(authorityFrameBuild.status).toBe("contract_frozen_build_not_materialized")
  expect(authorityFrameBuild.request_frame_schema_version)
    .toBe(REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_SCHEMA_VERSION)
  expect(authorityFrameBuild.response_frame_schema_version)
    .toBe(REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_FRAME_SCHEMA_VERSION)
  expect(authorityFrameBuild.required_response_echo_fields).toEqual([
    "execution_admission_command_hash",
    "process_launch_intent_hash",
    "request_frame_hash",
    "worker_request_hash",
  ])
  expect(authorityFrameBuild.old_authority_reuse_policy)
    .toBe("forbidden_new_artifact_requires_new_transport_command_and_intent")
  expect(authorityFrameBuild.blockers).toEqual([
    "activated_stdio_process_artifact_not_materialized",
    "artifact_bound_successor_transport_not_materialized",
    "successor_execution_admission_command_not_issued",
    "successor_process_launch_intent_not_issued",
    "fresh_spawn_boundary_revalidation_not_materialized",
    "attempt_bound_process_launch_receipt_not_materialized",
    "authority_frame_write_decode_read_and_admission_not_materialized",
  ])
  expect(authorityFrameBuild.activated_stdio_artifact_count).toBe(0)
  expect(authorityFrameBuild.successor_transport_contract_count).toBe(0)
  expect(authorityFrameBuild.successor_execution_admission_command_count).toBe(0)
  expect(authorityFrameBuild.successor_process_launch_intent_count).toBe(0)
  expect(authorityFrameBuild.admitted_process_instance_count).toBe(0)
  expect(authorityFrameBuild.request_frame_instance_count).toBe(0)
  expect(authorityFrameBuild.response_frame_instance_count).toBe(0)
  expect(() => assertReplayDecisionHarnessWorkerV10AuthorityFrameBuildContract(
    authorityFrameBuild,
  )).not.toThrow()
  expect(() => assertReplayDecisionHarnessWorkerV10AuthorityFrameBuildContractLineage(
    authorityFrameBuild,
    authorityBuildInput,
  )).not.toThrow()

  const futureTransportHash = canonicalHash({ kind: "future-authority-transport" })
  const futureArtifactHash = canonicalHash({ kind: "future-activated-stdio-artifact" })
  const futureCommandHash = canonicalHash({ kind: "future-execution-admission-command" })
  const futureIntentHash = canonicalHash({ kind: "future-process-launch-intent" })
  const authorityRequestFrame = createReplayDecisionHarnessWorkerV10AuthorityRequestFrame({
    schema_version: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_SCHEMA_VERSION,
    frame_kind: "worker_request",
    worker_protocol_version: firstRequestV10.worker_protocol_version,
    transport_contract_hash: futureTransportHash,
    execution_envelope_hash: executionEnvelope.envelope_hash,
    process_artifact_hash: futureArtifactHash,
    execution_admission_command_hash: futureCommandHash,
    process_launch_intent_hash: futureIntentHash,
    logical_request_id: firstRequestV10.logical_request_id,
    worker_request_hash: firstRequestV10.request_hash,
    worker_request: structuredClone(firstRequestV10),
    authority_status: "authority_bound_candidate_not_admitted",
  })
  expect(() => assertReplayDecisionHarnessWorkerV10AuthorityRequestFrame(
    authorityRequestFrame,
  )).not.toThrow()
  const authorityResponseFrame = createReplayDecisionHarnessWorkerV10AuthorityResponseFrame({
    schema_version: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_FRAME_SCHEMA_VERSION,
    frame_kind: "worker_response",
    worker_protocol_version: responseV10.worker_protocol_version,
    transport_contract_hash: futureTransportHash,
    execution_envelope_hash: executionEnvelope.envelope_hash,
    process_artifact_hash: futureArtifactHash,
    execution_admission_command_hash: futureCommandHash,
    process_launch_intent_hash: futureIntentHash,
    request_frame_hash: authorityRequestFrame.frame_hash,
    logical_request_id: responseV10.logical_request_id,
    worker_request_hash: responseV10.request_hash,
    worker_response_hash: responseV10.response_hash,
    worker_response: structuredClone(responseV10),
    authority_status: "authority_bound_candidate_not_admitted",
  })
  expect(() => assertReplayDecisionHarnessWorkerV10AuthorityResponseFrame(
    authorityResponseFrame,
    authorityRequestFrame,
  )).not.toThrow()
  const { frame_hash: _authorityResponseHash, ...authorityResponseBody } = authorityResponseFrame
  const commandEchoTamper = createReplayDecisionHarnessWorkerV10AuthorityResponseFrame({
    ...authorityResponseBody,
    execution_admission_command_hash: canonicalHash({ kind: "wrong-command" }),
  })
  expect(() => assertReplayDecisionHarnessWorkerV10AuthorityResponseFrame(
    commandEchoTamper,
    authorityRequestFrame,
  )).toThrow("Request authority echo drift")
  const requestEchoTamper = createReplayDecisionHarnessWorkerV10AuthorityResponseFrame({
    ...authorityResponseBody,
    request_frame_hash: canonicalHash({ kind: "wrong-request-frame" }),
  })
  expect(() => assertReplayDecisionHarnessWorkerV10AuthorityResponseFrame(
    requestEchoTamper,
    authorityRequestFrame,
  )).toThrow("Request authority echo drift")

  const missingAuthorityBuildRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-authority-build-missing-"))
  try {
    expect(() => registerReplayWorkerV10AuthorityFrameBuildContract({
      registry_root: missingAuthorityBuildRoot,
      ...authorityBuildInput,
    })).toThrow("requires the exact durable Process Launch Readiness Gate")
  } finally {
    rmSync(missingAuthorityBuildRoot, { recursive: true, force: true })
  }
  expect(registerReplayWorkerV10AuthorityFrameBuildContract({
    registry_root: dispatchEvidenceRegistryRoot,
    ...authorityBuildInput,
  })).toEqual(authorityFrameBuild)
  expect(readReplayWorkerV10AuthorityFrameBuildContract({
    registry_root: dispatchEvidenceRegistryRoot,
    ...authorityBuildInput,
  })).toEqual(authorityFrameBuild)

  const activatedStdioInput = { source_authority_frame_build_contract: authorityFrameBuild }
  replayProfile("pre-authority transport chain")
  const activatedStdio = buildReplayDecisionHarnessWorkerV10ActivatedStdioCapability(activatedStdioInput)
  expect(activatedStdio.status).toBe("artifact_built_successor_transport_and_authority_not_materialized")
  expect(activatedStdio.artifact.sha256).not.toBe(processLaunchReadiness.intent_bound_process_artifact_hash)
  expect(activatedStdio.authority_capsule_environment_variable)
    .toBe(REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_ENV)
  expect(activatedStdio.authority_capsule_fields).toEqual([
    "execution_admission_command_hash",
    "execution_envelope_hash",
    "logical_request_id",
    "process_artifact_hash",
    "process_launch_intent_hash",
    "transport_contract_hash",
    "worker_request_hash",
  ])
  expect(activatedStdio.frame_authority_validation)
    .toBe("every_outer_authority_field_must_equal_capsule_before_worker_request_decode")
  expect(activatedStdio.valid_authority_frame_probe)
    .toBe("not_materialized_until_successor_authority_exists")
  expect(activatedStdio.blockers).toEqual([
    "artifact_bound_successor_transport_not_materialized",
    "successor_execution_admission_command_not_issued",
    "successor_process_launch_intent_not_issued",
    "fresh_spawn_boundary_revalidation_not_materialized",
    "attempt_bound_process_launch_receipt_not_materialized",
    "authority_frame_write_decode_read_and_admission_not_materialized",
  ])
  expect(activatedStdio.activated_stdio_artifact_count).toBe(1)
  expect(activatedStdio.authority_capsule_instance_count).toBe(0)
  expect(activatedStdio.admitted_process_instance_count).toBe(0)
  expect(activatedStdio.request_frame_instance_count).toBe(0)
  expect(activatedStdio.response_frame_instance_count).toBe(0)
  expect(() => assertReplayDecisionHarnessWorkerV10ActivatedStdioCapability(activatedStdio)).not.toThrow()
  expect(() => assertReplayDecisionHarnessWorkerV10ActivatedStdioCapabilityLineage(
    activatedStdio,
    activatedStdioInput,
  )).not.toThrow()
  const activatedArtifactRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-activated-artifact-"))
  try {
    const artifactPath = join(activatedArtifactRoot, activatedStdio.artifact.file_name)
    writeFileSync(artifactPath, activatedStdio.artifact.content_utf8, "utf8")
    const missingCapsuleProbe = spawnSync(process.execPath, [artifactPath], {
      encoding: "utf8",
      env: { TZ: "UTC", LANG: "C", LC_ALL: "C" },
      input: "",
    })
    expect(missingCapsuleProbe.status).toBe(71)
    expect(missingCapsuleProbe.stderr).toBe('{"error_code":"launch_authority_capsule_missing"}\n')
    const malformedCapsuleProbe = spawnSync(process.execPath, [artifactPath], {
      encoding: "utf8",
      env: { TZ: "UTC", LANG: "C", LC_ALL: "C", [REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_ENV]: "{}" },
      input: "",
    })
    expect(malformedCapsuleProbe.status).toBe(72)
    expect(malformedCapsuleProbe.stderr).toBe('{"error_code":"launch_authority_capsule_invalid"}\n')
  } finally {
    rmSync(activatedArtifactRoot, { recursive: true, force: true })
  }
  const missingActivatedRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-activated-missing-"))
  try {
    expect(() => registerReplayWorkerV10ActivatedStdioCapability({
      registry_root: missingActivatedRoot,
      ...activatedStdioInput,
    })).toThrow("requires the exact durable Authority Frame Build Contract")
  } finally {
    rmSync(missingActivatedRoot, { recursive: true, force: true })
  }
  expect(registerReplayWorkerV10ActivatedStdioCapability({
    registry_root: dispatchEvidenceRegistryRoot,
    ...activatedStdioInput,
  })).toEqual(activatedStdio)
  expect(readReplayWorkerV10ActivatedStdioCapability({
    registry_root: dispatchEvidenceRegistryRoot,
    ...activatedStdioInput,
  })).toEqual(activatedStdio)

  const authorityTransportInput = { source_activated_stdio_capability: activatedStdio }
  const authorityTransport = buildReplayDecisionHarnessWorkerV10AuthorityTransportContract(
    authorityTransportInput,
  )
  expect(authorityTransport.status).toBe("activated_artifact_bound_authority_issuance_blocked_zero_process")
  expect(authorityTransport.activated_process_artifact_hash).toBe(activatedStdio.artifact.sha256)
  expect(authorityTransport.source_predecessor_transport_contract_hash)
    .toBe(successorTransportContract.contract_hash)
  expect(authorityTransport.request_frame_schema_version)
    .toBe(REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_SCHEMA_VERSION)
  expect(authorityTransport.response_frame_schema_version)
    .toBe(REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_FRAME_SCHEMA_VERSION)
  expect(authorityTransport.authority_capsule_intent_binding)
    .toBe("future_successor_intent_hash_derived_at_spawn_not_stored_in_intent_payload")
  expect(authorityTransport.process_receipt_required_bindings)
    .toEqual(REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_RECEIPT_BINDINGS)
  expect(authorityTransport.blockers).toEqual([
    "successor_execution_admission_command_not_issued",
    "successor_process_launch_intent_not_issued",
    "fresh_spawn_boundary_revalidation_not_materialized",
    "attempt_bound_process_launch_receipt_not_materialized",
    "authority_frame_write_decode_read_and_admission_not_materialized",
  ])
  expect(authorityTransport.activated_stdio_artifact_count).toBe(1)
  expect(authorityTransport.authority_transport_contract_instance_count).toBe(1)
  expect(authorityTransport.successor_execution_admission_command_count).toBe(0)
  expect(authorityTransport.successor_process_launch_intent_count).toBe(0)
  expect(authorityTransport.authority_capsule_instance_count).toBe(0)
  expect(authorityTransport.process_launch_receipt_count).toBe(0)
  expect(authorityTransport.request_frame_instance_count).toBe(0)
  expect(authorityTransport.response_frame_instance_count).toBe(0)
  expect(() => assertReplayDecisionHarnessWorkerV10AuthorityTransportContract(authorityTransport)).not.toThrow()
  expect(() => assertReplayDecisionHarnessWorkerV10AuthorityTransportContractLineage(
    authorityTransport,
    authorityTransportInput,
  )).not.toThrow()
  expect(() => assertReplayDecisionHarnessWorkerV10AuthorityTransportContract({
    ...authorityTransport,
    activated_process_artifact_hash: successorTransportContract.successor_process_artifact_hash,
  })).toThrow("parent or artifact binding drift")
  const missingAuthorityTransportRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-authority-transport-missing-"))
  try {
    expect(() => registerReplayWorkerV10AuthorityTransportContract({
      registry_root: missingAuthorityTransportRoot,
      ...authorityTransportInput,
    })).toThrow("requires the exact durable Activated Stdio Capability")
  } finally {
    rmSync(missingAuthorityTransportRoot, { recursive: true, force: true })
  }
  expect(registerReplayWorkerV10AuthorityTransportContract({
    registry_root: dispatchEvidenceRegistryRoot,
    ...authorityTransportInput,
  })).toEqual(authorityTransport)
  expect(readReplayWorkerV10AuthorityTransportContract({
    registry_root: dispatchEvidenceRegistryRoot,
    ...authorityTransportInput,
  })).toEqual(authorityTransport)

  return {
    frame_build_input: authorityBuildInput,
    frame_build: authorityFrameBuild,
    activated_stdio_input: activatedStdioInput,
    activated_stdio: activatedStdio,
    transport_input: authorityTransportInput,
    transport: authorityTransport,
  }
}

