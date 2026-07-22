import { expect } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ReplayDecisionHarnessExecutionEnvelope } from "../../../contracts/src/lib/replay-decision-harness-execution-envelope"
import type { ReplayDecisionHarnessWorkerRequestV10 } from "../../../contracts/src/lib/replay-decision-harness-worker-request-v10"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_FRAME_SCHEMA_VERSION,
  assertReplayDecisionHarnessWorkerV10AuthorityFrameBuildContract,
  assertReplayDecisionHarnessWorkerV10AuthorityRequestFrame,
  assertReplayDecisionHarnessWorkerV10AuthorityResponseFrame,
  createReplayDecisionHarnessWorkerV10AuthorityRequestFrame,
  createReplayDecisionHarnessWorkerV10AuthorityResponseFrame,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-frame-build-contract"
import type { ReplayDecisionHarnessWorkerResponseV10 } from "../../../contracts/src/lib/replay-decision-harness-worker-response-v10-contract"
import type { ReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGate } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-process-launch-readiness-gate"
import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import { assertReplayDecisionHarnessWorkerV10AuthorityFrameBuildContractLineage, buildReplayDecisionHarnessWorkerV10AuthorityFrameBuildContract } from "./replay-decision-harness-worker-v10-authority-frame-build-contract"
import { readReplayWorkerV10AuthorityFrameBuildContract, registerReplayWorkerV10AuthorityFrameBuildContract } from "./replay-worker-v10-authority-frame-build-contract-registry"

export interface ReplayWorkerV10AuthorityFrameBuildStageInput {
  registry_root: string
  process_launch_readiness: ReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGate
  first_worker_request: ReplayDecisionHarnessWorkerRequestV10
  execution_envelope: ReplayDecisionHarnessExecutionEnvelope
  first_worker_response: ReplayDecisionHarnessWorkerResponseV10
  profile(stage: string): void
}

export function runReplayWorkerV10AuthorityFrameBuildStage(
  input: ReplayWorkerV10AuthorityFrameBuildStageInput,
) {
  const buildInput = { source_launch_readiness_gate: input.process_launch_readiness }
  const build = buildReplayDecisionHarnessWorkerV10AuthorityFrameBuildContract(buildInput)
  input.profile("authority frame build")
  expect(build.status).toBe("contract_frozen_build_not_materialized")
  expect(build.request_frame_schema_version)
    .toBe(REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_SCHEMA_VERSION)
  expect(build.response_frame_schema_version)
    .toBe(REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_FRAME_SCHEMA_VERSION)
  expect(build.required_response_echo_fields).toEqual([
    "execution_admission_command_hash",
    "process_launch_intent_hash",
    "request_frame_hash",
    "worker_request_hash",
  ])
  expect(build.old_authority_reuse_policy)
    .toBe("forbidden_new_artifact_requires_new_transport_command_and_intent")
  expect(build.blockers).toEqual([
    "activated_stdio_process_artifact_not_materialized",
    "artifact_bound_successor_transport_not_materialized",
    "successor_execution_admission_command_not_issued",
    "successor_process_launch_intent_not_issued",
    "fresh_spawn_boundary_revalidation_not_materialized",
    "attempt_bound_process_launch_receipt_not_materialized",
    "authority_frame_write_decode_read_and_admission_not_materialized",
  ])
  expect(build.activated_stdio_artifact_count).toBe(0)
  expect(build.successor_transport_contract_count).toBe(0)
  expect(build.successor_execution_admission_command_count).toBe(0)
  expect(build.successor_process_launch_intent_count).toBe(0)
  expect(build.admitted_process_instance_count).toBe(0)
  expect(build.request_frame_instance_count).toBe(0)
  expect(build.response_frame_instance_count).toBe(0)
  expect(() => assertReplayDecisionHarnessWorkerV10AuthorityFrameBuildContract(build)).not.toThrow()
  expect(() => assertReplayDecisionHarnessWorkerV10AuthorityFrameBuildContractLineage(
    build,
    buildInput,
  )).not.toThrow()

  const transportHash = canonicalHash({ kind: "future-authority-transport" })
  const artifactHash = canonicalHash({ kind: "future-activated-stdio-artifact" })
  const commandHash = canonicalHash({ kind: "future-execution-admission-command" })
  const intentHash = canonicalHash({ kind: "future-process-launch-intent" })
  const requestFrame = createReplayDecisionHarnessWorkerV10AuthorityRequestFrame({
    schema_version: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_SCHEMA_VERSION,
    frame_kind: "worker_request",
    worker_protocol_version: input.first_worker_request.worker_protocol_version,
    transport_contract_hash: transportHash,
    execution_envelope_hash: input.execution_envelope.envelope_hash,
    process_artifact_hash: artifactHash,
    execution_admission_command_hash: commandHash,
    process_launch_intent_hash: intentHash,
    logical_request_id: input.first_worker_request.logical_request_id,
    worker_request_hash: input.first_worker_request.request_hash,
    worker_request: structuredClone(input.first_worker_request),
    authority_status: "authority_bound_candidate_not_admitted",
  })
  expect(() => assertReplayDecisionHarnessWorkerV10AuthorityRequestFrame(requestFrame)).not.toThrow()
  const responseFrame = createReplayDecisionHarnessWorkerV10AuthorityResponseFrame({
    schema_version: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_FRAME_SCHEMA_VERSION,
    frame_kind: "worker_response",
    worker_protocol_version: input.first_worker_response.worker_protocol_version,
    transport_contract_hash: transportHash,
    execution_envelope_hash: input.execution_envelope.envelope_hash,
    process_artifact_hash: artifactHash,
    execution_admission_command_hash: commandHash,
    process_launch_intent_hash: intentHash,
    request_frame_hash: requestFrame.frame_hash,
    logical_request_id: input.first_worker_response.logical_request_id,
    worker_request_hash: input.first_worker_response.request_hash,
    worker_response_hash: input.first_worker_response.response_hash,
    worker_response: structuredClone(input.first_worker_response),
    authority_status: "authority_bound_candidate_not_admitted",
  })
  expect(() => assertReplayDecisionHarnessWorkerV10AuthorityResponseFrame(responseFrame, requestFrame))
    .not.toThrow()
  const { frame_hash: _responseHash, ...responseBody } = responseFrame
  const commandTamper = createReplayDecisionHarnessWorkerV10AuthorityResponseFrame({
    ...responseBody,
    execution_admission_command_hash: canonicalHash({ kind: "wrong-command" }),
  })
  expect(() => assertReplayDecisionHarnessWorkerV10AuthorityResponseFrame(
    commandTamper,
    requestFrame,
  )).toThrow("Request authority echo drift")
  const requestTamper = createReplayDecisionHarnessWorkerV10AuthorityResponseFrame({
    ...responseBody,
    request_frame_hash: canonicalHash({ kind: "wrong-request-frame" }),
  })
  expect(() => assertReplayDecisionHarnessWorkerV10AuthorityResponseFrame(
    requestTamper,
    requestFrame,
  )).toThrow("Request authority echo drift")

  const missingRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-authority-build-missing-"))
  try {
    expect(() => registerReplayWorkerV10AuthorityFrameBuildContract({
      registry_root: missingRoot,
      ...buildInput,
    })).toThrow("requires the exact durable Process Launch Readiness Gate")
  } finally {
    rmSync(missingRoot, { recursive: true, force: true })
  }
  expect(registerReplayWorkerV10AuthorityFrameBuildContract({
    registry_root: input.registry_root,
    ...buildInput,
  })).toEqual(build)
  expect(readReplayWorkerV10AuthorityFrameBuildContract({
    registry_root: input.registry_root,
    ...buildInput,
  })).toEqual(build)
  return { frame_build_input: buildInput, frame_build: build }
}
