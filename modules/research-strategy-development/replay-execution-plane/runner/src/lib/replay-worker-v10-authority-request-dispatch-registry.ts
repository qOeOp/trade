import { createHash } from "node:crypto"
import { existsSync, lstatSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_DISPATCH_ATTEMPT_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_DISPATCH_ATTEMPT_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_DISPATCH_RECEIPT_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_DISPATCH_RECEIPT_SCHEMA_VERSION,
  assertReplayDecisionHarnessWorkerV10AuthorityRequestDispatchAttempt,
  assertReplayDecisionHarnessWorkerV10AuthorityRequestDispatchReceipt,
  createReplayDecisionHarnessWorkerV10AuthorityRequestDispatchAttempt,
  createReplayDecisionHarnessWorkerV10AuthorityRequestDispatchReceipt,
  replayDecisionHarnessWorkerV10AuthorityRequestDispatchKey,
  type ReplayDecisionHarnessWorkerV10AuthorityRequestDispatchAttempt,
  type ReplayDecisionHarnessWorkerV10AuthorityRequestDispatchReceipt,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-request-dispatch"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_SCHEMA_VERSION,
  createReplayDecisionHarnessWorkerV10AuthorityRequestFrame,
  type ReplayDecisionHarnessWorkerV10AuthorityRequestFrame,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-frame-build-contract"
import {
  assertReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceipt,
  type ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceipt,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-process-launch"
import { canonicalHash, canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import {
  writeReplayImmutableCas,
  writeReplayImmutableCasWithDisposition,
} from "./replay-local-artifact-store"
import {
  readReplayWorkerV10AuthorityProcessLaunchReceipt,
  type ReplayWorkerV10AuthorityProcessClock,
  type ReplayWorkerV10AuthorityProcessSession,
} from "./replay-worker-v10-authority-process-launch-registry"

export interface DispatchReplayWorkerV10AuthorityRequestInput {
  registry_root: string
  source_process_launch_receipt: ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceipt
  session: ReplayWorkerV10AuthorityProcessSession | null
  clock?: ReplayWorkerV10AuthorityProcessClock
}

export type ReplayWorkerV10AuthorityRequestDispatchDisposition =
  | "new_opaque_transport_capture"
  | "durable_receipt_without_live_handle"

export interface ReplayWorkerV10AuthorityRequestDispatchOutcome {
  receipt: ReplayDecisionHarnessWorkerV10AuthorityRequestDispatchReceipt
  disposition: ReplayWorkerV10AuthorityRequestDispatchDisposition
}

export async function dispatchReplayWorkerV10AuthorityRequest(
  input: DispatchReplayWorkerV10AuthorityRequestInput,
): Promise<ReplayWorkerV10AuthorityRequestDispatchOutcome> {
  requireDurableLaunch(input)
  const launch = input.source_process_launch_receipt
  const frame = buildRequestFrame(launch)
  const key = dispatchKey(launch, frame)
  const existingReceipt = readReplayWorkerV10AuthorityRequestDispatchReceipt({
    registry_root: input.registry_root,
    source_process_launch_receipt: launch,
  })
  if (existingReceipt) {
    return { receipt: existingReceipt, disposition: "durable_receipt_without_live_handle" }
  }
  if (readReplayWorkerV10AuthorityRequestDispatchAttempt({
    registry_root: input.registry_root,
    source_process_launch_receipt: launch,
  })) {
    throw new Error("Authority Request Dispatch Attempt is pending or indeterminate; automatic rewrite is forbidden")
  }
  if (!input.session
      || input.session.process_instance_id !== launch.process_instance_id
      || input.session.observed_child_pid !== launch.observed_child_pid) {
    throw new Error("Authority Request Dispatch requires the exact live Process session")
  }
  const transport = launch.source_launch_attempt.source_spawn_revalidation.source_authority_capsule
    .source_authority_process_launch_intent.source_authority_execution_admission_command
    .source_authority_transport_contract
  const requestBytes = Buffer.from(`${canonicalJson(frame)}\n`, "utf8")
  if (requestBytes.byteLength > transport.max_request_frame_bytes) {
    throw new Error("Authority Request Frame exceeds the frozen transport bound")
  }
  const clock = input.clock ?? { now: () => new Date().toISOString() }
  const attempt = createReplayDecisionHarnessWorkerV10AuthorityRequestDispatchAttempt({
    schema_version: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_DISPATCH_ATTEMPT_SCHEMA_VERSION,
    dispatch_attempt_id: `decision-harness-worker-v10-authority-dispatch-attempt-${key.slice(0, 24)}`,
    dispatch_attempt_ref: `attempt://replay-decision-harness-worker-v10-authority-dispatch/${key.slice(0, 24)}`,
    dispatch_attempt_key: key,
    dispatch_attempt_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_DISPATCH_ATTEMPT_POLICY_VERSION,
    scope: "one_live_process_and_request_frame_bound_at_most_once_write_slot",
    owner: "replay_runner_worker_v10_authority_request_dispatch_registry",
    purpose: "reserve_one_non_replayable_request_frame_write_before_touching_child_stdin",
    status: "write_slot_committed_transport_outcome_pending",
    source_process_launch_receipt_hash: launch.receipt_hash,
    source_process_launch_receipt: structuredClone(launch),
    process_instance_id: launch.process_instance_id!,
    observed_child_pid: launch.observed_child_pid!,
    source_authority_transport_contract_hash: launch.source_authority_transport_contract_hash,
    source_execution_envelope_hash: launch.source_execution_envelope_hash,
    process_artifact_hash: launch.process_artifact_hash,
    source_authority_execution_admission_command_hash:
      launch.source_authority_execution_admission_command_hash,
    source_authority_process_launch_intent_hash: launch.source_authority_process_launch_intent_hash,
    logical_request_id: launch.logical_request_id,
    worker_request_hash: launch.worker_request_hash,
    request_frame_hash: frame.frame_hash,
    request_frame: structuredClone(frame),
    request_frame_encoding: "canonical_json_utf8_lf_single_frame",
    request_frame_bytes: requestBytes.byteLength,
    request_frame_bytes_hash: sha256(requestBytes),
    write_slot_committed_at: clock.now(),
    clock_evidence: "runner_process_clock_port_not_external_time_attestation",
    write_slot_policy: "one_cas_attempt_per_process_and_request_frame_no_automatic_rewrite",
    orphan_attempt_policy: "attempt_without_receipt_is_indeterminate_child_may_have_consumed_request",
    request_frame_instance_count: 1,
    request_write_receipt_count: 0,
    request_decode_receipt_count: 0,
    response_frame_instance_count: 0,
    response_read_receipt_count: 0,
    response_admission: "not_granted",
    decision_output_authority: "none",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
    trial_authority: "none",
  })
  const attemptContent = `${canonicalJson(attempt)}\n`
  const attemptDisposition = writeReplayImmutableCasWithDisposition(
    dispatchAttemptPath(input.registry_root, key),
    attemptContent,
  )
  if (!attemptDisposition.created) {
    const winner = readReplayWorkerV10AuthorityRequestDispatchReceipt({
      registry_root: input.registry_root,
      source_process_launch_receipt: launch,
    })
    if (winner) return { receipt: winner, disposition: "durable_receipt_without_live_handle" }
    throw new Error("Authority Request Dispatch Attempt is pending or indeterminate; automatic rewrite is forbidden")
  }
  const writeStartedAt = clock.now()
  let writeCompletedAt: string | null = null
  const capture = await input.session.dispatchOpaqueRequest({
    request_bytes: requestBytes,
    timeout_ms: transport.timeout_ms,
    max_stdout_bytes: transport.max_response_frame_bytes,
    max_stderr_bytes: transport.max_response_frame_bytes,
    on_request_written: () => { writeCompletedAt = clock.now() },
  })
  const processCompletedAt = clock.now()
  if (writeCompletedAt === null) {
    throw new Error("Authority Request Dispatch completed without a Request write observation")
  }
  const outcomeHash = canonicalHash({
    dispatch_attempt_hash: attempt.dispatch_attempt_hash,
    stdout_bytes_hash: sha256(capture.stdout),
    stderr_bytes_hash: sha256(capture.stderr),
    exit_status: capture.exit_status,
    exit_signal: capture.exit_signal,
    transport_error_code: capture.transport_error_code,
    transport_error_hash: capture.transport_error_hash,
  })
  const receipt = createReplayDecisionHarnessWorkerV10AuthorityRequestDispatchReceipt({
    schema_version: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_DISPATCH_RECEIPT_SCHEMA_VERSION,
    receipt_id: `decision-harness-worker-v10-authority-dispatch-receipt-${outcomeHash.slice(0, 24)}`,
    receipt_ref: `receipt://replay-decision-harness-worker-v10-authority-dispatch/${outcomeHash.slice(0, 24)}`,
    receipt_key: key,
    receipt_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_DISPATCH_RECEIPT_POLICY_VERSION,
    scope: "one_request_frame_write_close_exit_and_opaque_output_capture_outcome",
    owner: "replay_runner_worker_v10_authority_request_dispatch_registry",
    purpose: "record_transport_completion_without_parsing_or_admitting_worker_response_bytes",
    receipt_status: capture.transport_error_code === null
      ? "process_exited_opaque_output_captured" : "transport_failed_opaque_output_captured",
    source_dispatch_attempt_hash: attempt.dispatch_attempt_hash,
    source_dispatch_attempt: structuredClone(attempt),
    source_process_launch_receipt_hash: launch.receipt_hash,
    process_instance_id: launch.process_instance_id!,
    observed_child_pid: launch.observed_child_pid!,
    request_frame_hash: frame.frame_hash,
    request_frame_bytes: requestBytes.byteLength,
    request_frame_bytes_hash: sha256(requestBytes),
    write_started_at: writeStartedAt,
    write_completed_at: writeCompletedAt,
    process_completed_at: processCompletedAt,
    clock_evidence: "runner_process_clock_port_not_external_time_attestation",
    stdin_bytes_written: requestBytes.byteLength,
    stdin_closed: true,
    stdout_bytes_read: capture.stdout.byteLength,
    stdout_bytes_hash: sha256(capture.stdout),
    stdout_bytes_base64: capture.stdout.toString("base64"),
    stderr_bytes_read: capture.stderr.byteLength,
    stderr_bytes_hash: sha256(capture.stderr),
    stderr_bytes_base64: capture.stderr.toString("base64"),
    raw_capture_encoding: "base64_exact_bytes_local_receipt_carrier_v1",
    raw_capture_authority: "opaque_transport_candidate_not_response_frame",
    process_exit_observation: "runner_observed_exit_or_close_after_stdin_close",
    exit_status: capture.exit_status,
    exit_signal: capture.exit_signal,
    transport_error_code: capture.transport_error_code,
    transport_error_hash: capture.transport_error_hash,
    request_frame_instance_count: 1,
    request_write_receipt_count: 1,
    request_decode_receipt_count: 0,
    response_frame_instance_count: 0,
    response_read_receipt_count: 0,
    dispatch_occurrence: "one_request_frame_written_and_stdin_closed",
    harness_invocation: "worker_may_have_invoked_not_proven_by_runner",
    blocker_set_policy: "complete_deterministic_ordered_post_raw_capture_pre_response_admission_blockers",
    blockers: ["raw_response_frame_decode_validation_and_admission_not_materialized"],
    response_admission: "not_granted",
    decision_output_authority: "none",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
    trial_authority: "none",
  })
  const receiptContent = `${canonicalJson(receipt)}\n`
  writeReplayImmutableCas(dispatchReceiptPath(input.registry_root, key), receiptContent)
  return { receipt: parseReceipt(receiptContent), disposition: "new_opaque_transport_capture" }
}

export function readReplayWorkerV10AuthorityRequestDispatchAttempt(input: {
  registry_root: string
  source_process_launch_receipt: ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceipt
}): ReplayDecisionHarnessWorkerV10AuthorityRequestDispatchAttempt | null {
  requireDurableLaunch(input)
  const frame = buildRequestFrame(input.source_process_launch_receipt)
  return readAttempt(dispatchAttemptPath(input.registry_root, dispatchKey(input.source_process_launch_receipt, frame)))
}

export function readReplayWorkerV10AuthorityRequestDispatchReceipt(input: {
  registry_root: string
  source_process_launch_receipt: ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceipt
}): ReplayDecisionHarnessWorkerV10AuthorityRequestDispatchReceipt | null {
  requireDurableLaunch(input)
  const frame = buildRequestFrame(input.source_process_launch_receipt)
  const key = dispatchKey(input.source_process_launch_receipt, frame)
  const receipt = readReceipt(dispatchReceiptPath(input.registry_root, key))
  if (!receipt) return null
  const attempt = readAttempt(dispatchAttemptPath(input.registry_root, key))
  if (!attempt || attempt.dispatch_attempt_hash !== receipt.source_dispatch_attempt_hash) {
    throw new Error("Authority Request Dispatch Receipt lost its durable Dispatch Attempt")
  }
  return receipt
}

function buildRequestFrame(
  launch: ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceipt,
): ReplayDecisionHarnessWorkerV10AuthorityRequestFrame {
  const capsule = launch.source_launch_attempt.source_spawn_revalidation.source_authority_capsule
  const intent = capsule.source_authority_process_launch_intent
  const command = intent.source_authority_execution_admission_command
  const transport = command.source_authority_transport_contract
  const oldCommand = transport.source_activated_stdio_capability.source_authority_frame_build_contract
    .source_launch_readiness_gate.source_process_launch_intent.source_execution_admission_command
  const predecessor = oldCommand.source_clock_binding.source_registry_provenance.source_pre_issue_bundle
    .source_execution_admission_contract.source_successor_transport_contract
  const request = predecessor.source_negative_probe_receipt.source_stdio_capability.source_transport_contract
    .target_worker_request
  return createReplayDecisionHarnessWorkerV10AuthorityRequestFrame({
    schema_version: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_SCHEMA_VERSION,
    frame_kind: "worker_request",
    worker_protocol_version: request.worker_protocol_version,
    transport_contract_hash: transport.contract_hash,
    execution_envelope_hash: transport.source_execution_envelope_hash,
    process_artifact_hash: transport.activated_process_artifact_hash,
    execution_admission_command_hash: command.command_hash,
    process_launch_intent_hash: intent.intent_hash,
    logical_request_id: request.logical_request_id,
    worker_request_hash: request.request_hash,
    worker_request: structuredClone(request),
    authority_status: "authority_bound_candidate_not_admitted",
  })
}

function requireDurableLaunch(input: {
  registry_root: string
  source_process_launch_receipt: ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceipt
}): void {
  if (input.registry_root.trim() === "") throw new Error("Authority Request Dispatch registry root is required")
  assertReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceipt(input.source_process_launch_receipt)
  const launch = input.source_process_launch_receipt
  const durable = readReplayWorkerV10AuthorityProcessLaunchReceipt({
    registry_root: input.registry_root,
    source_spawn_revalidation: launch.source_launch_attempt.source_spawn_revalidation,
  })
  if (!durable || durable.receipt_hash !== launch.receipt_hash) {
    throw new Error("Authority Request Dispatch requires the exact durable Process Launch Receipt")
  }
  if (launch.receipt_status !== "started_process_frame_not_written"
      || launch.process_instance_id === null || launch.observed_child_pid === null) {
    throw new Error("Authority Request Dispatch requires a started Process Launch Receipt")
  }
}

function dispatchKey(
  launch: ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceipt,
  frame: ReplayDecisionHarnessWorkerV10AuthorityRequestFrame,
): string {
  return replayDecisionHarnessWorkerV10AuthorityRequestDispatchKey({
    process_launch_receipt_hash: launch.receipt_hash,
    request_frame_hash: frame.frame_hash,
    dispatch_attempt_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_DISPATCH_ATTEMPT_POLICY_VERSION,
  })
}

function readAttempt(path: string): ReplayDecisionHarnessWorkerV10AuthorityRequestDispatchAttempt | null {
  if (!existsSync(path)) return null
  assertRegularFile(path, "Attempt")
  const content = readFileSync(path, "utf8")
  const value = JSON.parse(content) as ReplayDecisionHarnessWorkerV10AuthorityRequestDispatchAttempt
  assertReplayDecisionHarnessWorkerV10AuthorityRequestDispatchAttempt(value)
  if (content !== `${canonicalJson(value)}\n`) throw new Error("Authority Request Dispatch Attempt is not canonical")
  return value
}

function readReceipt(path: string): ReplayDecisionHarnessWorkerV10AuthorityRequestDispatchReceipt | null {
  if (!existsSync(path)) return null
  assertRegularFile(path, "Receipt")
  return parseReceipt(readFileSync(path, "utf8"))
}

function parseReceipt(content: string): ReplayDecisionHarnessWorkerV10AuthorityRequestDispatchReceipt {
  const value = JSON.parse(content) as ReplayDecisionHarnessWorkerV10AuthorityRequestDispatchReceipt
  assertReplayDecisionHarnessWorkerV10AuthorityRequestDispatchReceipt(value)
  if (content !== `${canonicalJson(value)}\n`) throw new Error("Authority Request Dispatch Receipt is not canonical")
  return value
}

function assertRegularFile(path: string, label: string): void {
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Authority Request Dispatch ${label} must be a regular file`)
}

function dispatchAttemptPath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-authority-request-dispatch-attempt-${key}.json`)
}

function dispatchReceiptPath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-authority-request-dispatch-receipt-${key}.json`)
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex")
}
