import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_ENV,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-activated-stdio-capability"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_SCHEMA_VERSION,
  assertReplayDecisionHarnessWorkerV10AuthorityResponseFrame,
  createReplayDecisionHarnessWorkerV10AuthorityRequestFrame,
  type ReplayDecisionHarnessWorkerV10AuthorityResponseFrame,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-frame-build-contract"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_CUTOVER_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_CUTOVER_RECEIPT_SCHEMA_VERSION,
  assertReplayDecisionHarnessWorkerV10CutoverReceipt,
  createReplayDecisionHarnessWorkerV10CutoverReceipt,
  replayDecisionHarnessWorkerV10CutoverReceiptKey,
  type ReplayDecisionHarnessWorkerV10CutoverReceipt,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-cutover-receipt"
import {
  assertReplayDecisionHarnessWorkerV10ReproducibilityPairContract,
  type ReplayDecisionHarnessWorkerV10ReproducibilityPairContract,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-reproducibility-pair-contract"
import {
  assertReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleLineage,
  type ReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-authority-capsule"
import {
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission,
  type ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-stdio-probe-admission"
import {
  type ReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-process-launch-intent"
import {
  assertReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidationLineage,
  type ReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-spawn-boundary-revalidation"
import {
  REPLAY_DECISION_HARNESS_BUILD_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_CUTOVER_WORKER_PROTOCOL_VERSION,
  REPLAY_DECISION_HARNESS_LOADER_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_REGISTRY_POLICY_VERSION,
  canonicalHash,
  canonicalJson,
} from "../../../contracts/src/lib/replay-contracts"
import {
  REPLAY_SPAWN_BOUNDARY_REVALIDATION_REQUEST_POLICY_VERSION,
  REPLAY_SPAWN_BOUNDARY_REVALIDATION_REQUEST_SCHEMA_VERSION,
  assertReplaySpawnBoundaryRevalidationReceipt,
  createReplaySpawnBoundaryRevalidationRequest,
  replaySpawnBoundaryRevalidationRequestKey,
  type ReplaySpawnBoundaryRevalidationReceipt,
  type ReplaySpawnBoundaryRevalidationRequest,
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import {
  writeReplayImmutableCas,
  writeReplayImmutableCasWithDisposition,
} from "./replay-local-artifact-store"

const FIXED_ENVIRONMENT = Object.freeze({ TZ: "UTC", LANG: "C", LC_ALL: "C" })

export interface ExecuteReplayWorkerV10CutoverInput {
  registry_root: string
  source_pair_contract: ReplayDecisionHarnessWorkerV10ReproducibilityPairContract
  source_successor_spawn_revalidation: ReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation
  source_successor_authority_capsule: ReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord
  source_successor_process_launch_intent: ReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent
  source_successor_stdio_probe_admission:
    ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission
  authority_port: {
    revalidate(request: ReplaySpawnBoundaryRevalidationRequest): ReplaySpawnBoundaryRevalidationReceipt
  }
}

export type ReplayWorkerV10CutoverDisposition = "new_cutover_receipt" | "existing_cutover_receipt"

export interface ReplayWorkerV10CutoverOutcome {
  receipt: ReplayDecisionHarnessWorkerV10CutoverReceipt
  disposition: ReplayWorkerV10CutoverDisposition
}

export function executeReplayWorkerV10Cutover(
  input: ExecuteReplayWorkerV10CutoverInput,
): ReplayWorkerV10CutoverOutcome {
  assertParents(input)
  const key = receiptKey(input)
  const existing = readReplayWorkerV10CutoverReceipt(input)
  if (existing) return { receipt: existing, disposition: "existing_cutover_receipt" }
  const attemptPath = cutoverAttemptPath(input.registry_root, key)
  const attempt = {
    schema_version: "trade.rd-replay-decision-harness-worker-v10-cutover-attempt.v1",
    cutover_key: key,
    source_pair_contract_hash: input.source_pair_contract.contract_hash,
    source_successor_spawn_revalidation_hash: input.source_successor_spawn_revalidation.binding_hash,
    status: "spawn_slot_committed_outcome_pending",
  } as const
  const attemptDisposition = writeReplayImmutableCasWithDisposition(
    attemptPath,
    `${canonicalJson(attempt)}\n`,
  )
  if (!attemptDisposition.created) {
    const winner = readReplayWorkerV10CutoverReceipt(input)
    if (winner) return { receipt: winner, disposition: "existing_cutover_receipt" }
    throw new Error("Worker v10 cutover attempt is pending or indeterminate; automatic respawn is forbidden")
  }

  const pair = input.source_pair_contract
  const firstFrame = pair.source_schedule_admission.source_response_validation.response_frame
  if (!firstFrame) throw new Error("Worker v10 cutover first response frame is missing")
  const workerRequest = pair.source_schedule_admission.source_response_validation
    .source_dispatch_receipt.source_dispatch_attempt.request_frame.worker_request
  const successor = input.source_successor_spawn_revalidation
  const activatedCapability = firstActivatedCapability(pair)
  const registration = firstRegistration(pair)
  const adapter = deriveCutoverAdapter(input, activatedCapability.artifact.sha256)
  const revalidationReceipt = input.authority_port.revalidate(
    structuredClone(adapter.revalidation_request),
  )
  assertCutoverRevalidation(adapter.revalidation_request, revalidationReceipt, successor)
  const requestFrame = createReplayDecisionHarnessWorkerV10AuthorityRequestFrame({
    schema_version: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_SCHEMA_VERSION,
    frame_kind: "worker_request",
    worker_protocol_version: workerRequest.worker_protocol_version,
    transport_contract_hash: adapter.transport_contract_hash,
    execution_envelope_hash: successor.source_execution_envelope_hash,
    process_artifact_hash: activatedCapability.artifact.sha256,
    execution_admission_command_hash: adapter.execution_admission_command_hash,
    process_launch_intent_hash: adapter.process_launch_intent_hash,
    logical_request_id: workerRequest.logical_request_id,
    worker_request_hash: workerRequest.request_hash,
    worker_request: structuredClone(workerRequest),
    authority_status: "authority_bound_candidate_not_admitted",
  })
  const intent = input.source_successor_process_launch_intent
  assertRuntime(intent.runtime_executable_hash, intent.runtime_version)

  const root = mkdtempSync(join(tmpdir(), "rd-replay-worker-v10-cutover-"))
  try {
    const artifactPath = join(root, activatedCapability.artifact.file_name)
    writeFileSync(artifactPath, activatedCapability.artifact.content_utf8, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o500,
    })
    if (sha256(readFileSync(artifactPath)) !== activatedCapability.artifact.sha256) {
      throw new Error("Worker v10 cutover materialized artifact hash mismatch")
    }
    const environment = {
      ...FIXED_ENVIRONMENT,
      [REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_ENV]: canonicalJson(adapter.authority_capsule),
    }
    const execution = spawnSync(process.execPath, [artifactPath], {
      cwd: root,
      env: environment,
      input: Buffer.from(`${canonicalJson(requestFrame)}\n`, "utf8"),
      encoding: null,
      timeout: intent.timeout_ms,
      maxBuffer: intent.max_response_frame_bytes,
      killSignal: "SIGKILL",
    })
    if (execution.error) throw new Error(`Worker v10 cutover process failed: ${execution.error.message}`)
    if (execution.status !== 0 || execution.signal !== null) {
      throw new Error(`Worker v10 cutover process exit mismatch: ${execution.status ?? execution.signal}`)
    }
    const stderr = Buffer.isBuffer(execution.stderr) ? execution.stderr : Buffer.from(execution.stderr ?? "")
    if (stderr.byteLength !== 0) throw new Error("Worker v10 cutover process emitted stderr")
    const stdout = Buffer.isBuffer(execution.stdout) ? execution.stdout : Buffer.from(execution.stdout ?? "")
    const responseFrame = decodeResponseFrame(stdout, requestFrame)
    const observedChildPid = execution.pid
    if (!Number.isSafeInteger(observedChildPid) || observedChildPid < 1) {
      throw new Error("Worker v10 cutover child PID was not observed")
    }
    if (observedChildPid === pair.source_observed_child_pid) {
      throw new Error("Worker v10 cutover successor PID is not independent")
    }
    const processInstanceId = canonicalHash({
      source_successor_spawn_revalidation_hash: successor.binding_hash,
      observed_child_pid: observedChildPid,
      process_artifact_hash: activatedCapability.artifact.sha256,
      authority_capsule_hash: adapter.authority_capsule_hash,
      request_frame_hash: requestFrame.frame_hash,
    })
    const firstResponse = firstFrame.worker_response
    const secondResponse = responseFrame.worker_response
    if (canonicalJson(firstResponse) !== canonicalJson(secondResponse)) {
      throw new Error("Worker v10 cutover reproducibility parity failed")
    }
    const pairHash = canonicalHash({
      first_process_instance_id: pair.source_process_instance_id,
      first_worker_response_hash: firstResponse.response_hash,
      second_process_instance_id: processInstanceId,
      second_worker_response_hash: secondResponse.response_hash,
      worker_request_hash: workerRequest.request_hash,
    })
    const receipt = createReplayDecisionHarnessWorkerV10CutoverReceipt({
      schema_version: REPLAY_DECISION_HARNESS_WORKER_V10_CUTOVER_RECEIPT_SCHEMA_VERSION,
      receipt_id: `decision-harness-worker-v10-cutover-${key.slice(0, 24)}`,
      receipt_key: key,
      cutover_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_CUTOVER_POLICY_VERSION,
      run_id: workerRequest.run_id,
      harness_hash: registration.source_bundle.bundle_hash,
      source_bundle_ref: registration.source_bundle.bundle_ref,
      source_bundle_hash: registration.source_bundle.bundle_hash,
      build_attestation_hash: registration.build_attestation.attestation_hash,
      build_artifact_hash: registration.build_attestation.artifact.sha256,
      runtime_executable_hash: registration.build_attestation.runtime.executable_sha256,
      registry_policy_version: REPLAY_DECISION_HARNESS_REGISTRY_POLICY_VERSION,
      build_policy_version: REPLAY_DECISION_HARNESS_BUILD_POLICY_VERSION,
      loader_policy_version: REPLAY_DECISION_HARNESS_LOADER_POLICY_VERSION,
      worker_protocol_version: REPLAY_DECISION_HARNESS_CUTOVER_WORKER_PROTOCOL_VERSION,
      execution_policy: "two_fresh_authority_subprocesses_exact_schedule_cutover",
      decision_input_snapshot_hash: workerRequest.decision_input_snapshot_hash,
      decision_market_input_snapshot_hash: workerRequest.decision_market_input_snapshot_hash,
      decision_state_snapshot_hash: workerRequest.decision_state_snapshot_hash,
      request_context_hash: workerRequest.request_context_hash,
      worker_response_hash: firstResponse.response_hash,
      worker_verification_response_hash: secondResponse.response_hash,
      status: "admitted_two_fresh_process_pair_and_exact_schedule_effect",
      source_pair_contract_hash: pair.contract_hash,
      source_pair_contract: structuredClone(pair),
      source_successor_spawn_revalidation_hash: successor.binding_hash,
      source_successor_spawn_revalidation: structuredClone(successor),
      activated_process_artifact_hash: activatedCapability.artifact.sha256,
      cutover_transport_contract_hash: adapter.transport_contract_hash,
      cutover_execution_admission_command_hash: adapter.execution_admission_command_hash,
      cutover_process_launch_intent_hash: adapter.process_launch_intent_hash,
      cutover_authority_capsule_record_hash: adapter.authority_capsule_record_hash,
      cutover_authority_capsule_hash: adapter.authority_capsule_hash,
      cutover_spawn_revalidation_request: adapter.revalidation_request,
      cutover_spawn_revalidation_receipt: structuredClone(revalidationReceipt),
      worker_request_hash: workerRequest.request_hash,
      first_process_instance_id: pair.source_process_instance_id,
      first_observed_child_pid: pair.source_observed_child_pid,
      second_process_instance_id: processInstanceId,
      second_observed_child_pid: observedChildPid,
      second_request_frame_hash: requestFrame.frame_hash,
      second_request_frame: requestFrame,
      first_response_frame_hash: firstFrame.frame_hash,
      second_response_frame_hash: responseFrame.frame_hash,
      second_response_frame: responseFrame,
      first_worker_response_hash: firstResponse.response_hash,
      second_worker_response_hash: secondResponse.response_hash,
      selected_schedule_entry_hash: pair.selected_schedule_entry_hash,
      decision_output: structuredClone(secondResponse.decision_output),
      decision_output_hash: canonicalHash(secondResponse.decision_output),
      trace: structuredClone(secondResponse.trace),
      trace_hash: canonicalHash(secondResponse.trace),
      reproducibility_pair_hash: pairHash,
      response_instance_count: 2,
      schedule_admission_count: 2,
      reproducibility_pair_count: 1,
      harness_receipt_count: 1,
      process_independence: "distinct_pid_process_instance_and_authority_lineage",
      response_parity: "canonical_inner_worker_response_exact",
      schedule_admission: "both_members_match_exact_frozen_schedule",
      economic_authority: "granted_exact_frozen_schedule_effect",
      signal_authority: "derived_only_from_admitted_decision_output",
      order_authority: "derived_only_from_admitted_decision_output",
      trial_authority: "result_artifact_only_no_control_plane_mutation",
      blockers: [],
    })
    const content = `${canonicalJson(receipt)}\n`
    writeReplayImmutableCas(cutoverReceiptPath(input.registry_root, key), content)
    return { receipt: parseReceipt(content), disposition: "new_cutover_receipt" }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

export function readReplayWorkerV10CutoverReceipt(
  input: ExecuteReplayWorkerV10CutoverInput,
): ReplayDecisionHarnessWorkerV10CutoverReceipt | null {
  assertParents(input)
  const path = cutoverReceiptPath(input.registry_root, receiptKey(input))
  if (!existsSync(path)) return null
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Worker v10 cutover receipt must be a regular file")
  return parseReceipt(readFileSync(path, "utf8"))
}

function assertParents(input: ExecuteReplayWorkerV10CutoverInput): void {
  if (input.registry_root.trim() === "") throw new Error("Worker v10 cutover registry root is required")
  assertReplayDecisionHarnessWorkerV10ReproducibilityPairContract(input.source_pair_contract)
  assertReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleLineage(
    input.source_successor_authority_capsule,
    input.source_successor_process_launch_intent,
  )
  assertReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidationLineage(
    input.source_successor_spawn_revalidation,
    input.source_successor_authority_capsule,
    input.source_successor_process_launch_intent,
  )
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission(
    input.source_successor_stdio_probe_admission,
  )
  const pair = input.source_pair_contract
  const successor = input.source_successor_spawn_revalidation
  const stdio = input.source_successor_stdio_probe_admission
  if (successor.target_logical_request_id !== pair.logical_request_id
      || successor.target_worker_request_hash !== pair.worker_request_hash
      || successor.process_artifact_hash !== stdio.successor_stdio_artifact_evidence.artifact.sha256
      || input.source_successor_authority_capsule.source_successor_stdio_probe_admission_hash
        !== stdio.admission_hash) {
    throw new Error("Worker v10 cutover direct parent closure mismatch")
  }
}

function receiptKey(input: ExecuteReplayWorkerV10CutoverInput): string {
  return replayDecisionHarnessWorkerV10CutoverReceiptKey({
    source_pair_contract_hash: input.source_pair_contract.contract_hash,
    source_successor_spawn_revalidation_hash: input.source_successor_spawn_revalidation.binding_hash,
    cutover_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_CUTOVER_POLICY_VERSION,
  })
}

function firstActivatedCapability(pair: ReplayDecisionHarnessWorkerV10ReproducibilityPairContract) {
  return pair.source_schedule_admission.source_response_validation.source_dispatch_receipt
    .source_dispatch_attempt.source_process_launch_receipt.source_launch_attempt
    .source_spawn_revalidation.source_authority_capsule.source_authority_process_launch_intent
    .source_authority_execution_admission_command.source_authority_transport_contract
    .source_activated_stdio_capability
}

function firstRegistration(pair: ReplayDecisionHarnessWorkerV10ReproducibilityPairContract) {
  const activated = firstActivatedCapability(pair)
  const command = activated.source_authority_frame_build_contract.source_launch_readiness_gate
    .source_process_launch_intent.source_execution_admission_command
  return command.source_clock_binding.source_registry_provenance.source_pre_issue_bundle
    .source_execution_admission_contract.source_successor_transport_contract
    .source_negative_probe_receipt.source_stdio_capability.source_transport_contract
    .source_worker_v10_build_capability.source_code_admission.registry_entry
}

function deriveCutoverAdapter(
  input: ExecuteReplayWorkerV10CutoverInput,
  activatedArtifactHash: string,
) {
  const successor = input.source_successor_spawn_revalidation
  const transportContractHash = canonicalHash({
    policy: REPLAY_DECISION_HARNESS_WORKER_V10_CUTOVER_POLICY_VERSION,
    source_successor_transport_contract_hash: successor.source_artifact_bound_transport_contract_hash,
    activated_process_artifact_hash: activatedArtifactHash,
  })
  const executionAdmissionCommandHash = canonicalHash({
    policy: REPLAY_DECISION_HARNESS_WORKER_V10_CUTOVER_POLICY_VERSION,
    source_successor_execution_admission_command_hash: successor.source_execution_admission_command_hash,
    cutover_transport_contract_hash: transportContractHash,
  })
  const processLaunchIntentHash = canonicalHash({
    policy: REPLAY_DECISION_HARNESS_WORKER_V10_CUTOVER_POLICY_VERSION,
    source_successor_process_launch_intent_hash: successor.source_successor_process_launch_intent_hash,
    cutover_execution_admission_command_hash: executionAdmissionCommandHash,
    activated_process_artifact_hash: activatedArtifactHash,
  })
  const authorityCapsule = {
    execution_admission_command_hash: executionAdmissionCommandHash,
    execution_envelope_hash: successor.source_execution_envelope_hash,
    logical_request_id: successor.target_logical_request_id,
    process_artifact_hash: activatedArtifactHash,
    process_launch_intent_hash: processLaunchIntentHash,
    transport_contract_hash: transportContractHash,
    worker_request_hash: successor.target_worker_request_hash,
  }
  const authorityCapsuleHash = canonicalHash(authorityCapsule)
  const authorityCapsuleRecordHash = canonicalHash({
    policy: REPLAY_DECISION_HARNESS_WORKER_V10_CUTOVER_POLICY_VERSION,
    source_successor_authority_capsule_record_hash:
      input.source_successor_authority_capsule.record_hash,
    authority_capsule: authorityCapsule,
  })
  const requestKey = replaySpawnBoundaryRevalidationRequestKey({
    source_authority_capsule_record_hash: authorityCapsuleRecordHash,
    attempt_id: successor.attempt_id,
    worker_id: successor.worker_id,
    lease_generation: successor.lease_generation,
    request_policy_version: REPLAY_SPAWN_BOUNDARY_REVALIDATION_REQUEST_POLICY_VERSION,
  })
  const revalidationRequest = createReplaySpawnBoundaryRevalidationRequest({
    schema_version: REPLAY_SPAWN_BOUNDARY_REVALIDATION_REQUEST_SCHEMA_VERSION,
    request_id: `replay-spawn-boundary-revalidation-request-${requestKey.slice(0, 24)}`,
    request_ref: `request://replay-spawn-boundary-revalidation/${requestKey.slice(0, 24)}`,
    request_key: requestKey,
    request_policy_version: REPLAY_SPAWN_BOUNDARY_REVALIDATION_REQUEST_POLICY_VERSION,
    status: "capsule_bound_current_attempt_revalidation_requested",
    requester_owner: "replay_runner",
    authority_target: "research_control_plane",
    purpose: "revalidate_exact_current_attempt_after_capsule_commit_before_spawn",
    source_authority_capsule_record_hash: authorityCapsuleRecordHash,
    authority_capsule_hash: authorityCapsuleHash,
    source_authority_process_launch_intent_hash: processLaunchIntentHash,
    source_authority_execution_admission_command_hash: executionAdmissionCommandHash,
    source_authority_transport_contract_hash: transportContractHash,
    process_artifact_hash: activatedArtifactHash,
    worker_request_hash: successor.target_worker_request_hash,
    attempt_id: successor.attempt_id,
    attempt_ordinal: successor.attempt_ordinal,
    worker_id: successor.worker_id,
    lease_generation: successor.lease_generation,
    expected_current_attempt_lease_hash: successor.current_attempt_lease_hash,
    expected_valid_before: successor.valid_before,
    challenge_policy: "one_capsule_bound_challenge_no_caller_time_or_state_substitution",
    retry_policy: "fresh_command_intent_capsule_authority_lineage_required_after_failed_or_stale_challenge",
    process_authority: "none",
  })
  return {
    transport_contract_hash: transportContractHash,
    execution_admission_command_hash: executionAdmissionCommandHash,
    process_launch_intent_hash: processLaunchIntentHash,
    authority_capsule: authorityCapsule,
    authority_capsule_hash: authorityCapsuleHash,
    authority_capsule_record_hash: authorityCapsuleRecordHash,
    revalidation_request: revalidationRequest,
  }
}

function assertCutoverRevalidation(
  request: ReplaySpawnBoundaryRevalidationRequest,
  receipt: ReplaySpawnBoundaryRevalidationReceipt,
  successor: ReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation,
): void {
  assertReplaySpawnBoundaryRevalidationReceipt(receipt)
  if (receipt.source_request_hash !== request.request_hash
      || canonicalJson(receipt.source_request) !== canonicalJson(request)
      || receipt.current_attempt_status !== "running"
      || receipt.current_attempt_lease_hash !== successor.current_attempt_lease_hash
      || receipt.current_attempt_lease.attempt_id !== successor.attempt_id
      || receipt.current_attempt_lease.attempt_ordinal !== successor.attempt_ordinal
      || receipt.current_attempt_lease.worker_id !== successor.worker_id
      || receipt.current_attempt_lease.lease_generation !== successor.lease_generation
      || receipt.valid_before !== successor.valid_before) {
    throw new Error("Worker v10 cutover Control Plane revalidation mismatch")
  }
}

function decodeResponseFrame(
  bytes: Buffer,
  requestFrame: ReturnType<typeof createReplayDecisionHarnessWorkerV10AuthorityRequestFrame>,
): ReplayDecisionHarnessWorkerV10AuthorityResponseFrame {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  if (!text.endsWith("\n") || text.slice(0, -1).includes("\n")) {
    throw new Error("Worker v10 cutover response is not one canonical JSON LF frame")
  }
  const value = JSON.parse(text.slice(0, -1)) as ReplayDecisionHarnessWorkerV10AuthorityResponseFrame
  assertReplayDecisionHarnessWorkerV10AuthorityResponseFrame(value, requestFrame)
  if (text !== `${canonicalJson(value)}\n`) {
    throw new Error("Worker v10 cutover response frame is not canonical")
  }
  return value
}

function assertRuntime(expectedHash: string, expectedVersion: string): void {
  if (sha256(readFileSync(process.execPath)) !== expectedHash) {
    throw new Error("Worker v10 cutover runtime executable hash mismatch")
  }
  if (typeof Bun === "undefined" || Bun.version !== expectedVersion) {
    throw new Error("Worker v10 cutover runtime version mismatch")
  }
}

function parseReceipt(content: string): ReplayDecisionHarnessWorkerV10CutoverReceipt {
  const value = JSON.parse(content) as ReplayDecisionHarnessWorkerV10CutoverReceipt
  assertReplayDecisionHarnessWorkerV10CutoverReceipt(value)
  if (content !== `${canonicalJson(value)}\n`) throw new Error("Worker v10 cutover receipt is not canonical")
  return value
}

function cutoverAttemptPath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-cutover-attempt-${key}.json`)
}

function cutoverReceiptPath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-cutover-receipt-${key}.json`)
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex")
}
