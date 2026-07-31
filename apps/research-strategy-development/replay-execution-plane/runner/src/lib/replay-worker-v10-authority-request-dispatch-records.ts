import { createHash } from "node:crypto"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_DISPATCH_ATTEMPT_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_DISPATCH_ATTEMPT_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_DISPATCH_RECEIPT_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_DISPATCH_RECEIPT_SCHEMA_VERSION,
  createReplayDecisionHarnessWorkerV10AuthorityRequestDispatchAttempt,
  createReplayDecisionHarnessWorkerV10AuthorityRequestDispatchReceipt,
  replayDecisionHarnessWorkerV10AuthorityRequestDispatchKey,
  type ReplayDecisionHarnessWorkerV10AuthorityRequestDispatchAttempt,
  type ReplayDecisionHarnessWorkerV10AuthorityRequestDispatchReceipt,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-request-dispatch"
import type { ReplayDecisionHarnessWorkerV10AuthorityRequestFrame } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-frame-build-contract"
import type { ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceipt } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-process-launch"
import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import type { ReplayWorkerV10AuthorityOpaqueCapture } from "./replay-worker-v10-authority-request-dispatch-types"

export function replayWorkerV10AuthorityDispatchKey(
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

export function buildReplayWorkerV10AuthorityDispatchAttempt(
  key: string,
  launch: ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceipt,
  frame: ReplayDecisionHarnessWorkerV10AuthorityRequestFrame,
  requestBytes: Buffer,
  committedAt: string,
): ReplayDecisionHarnessWorkerV10AuthorityRequestDispatchAttempt {
  return createReplayDecisionHarnessWorkerV10AuthorityRequestDispatchAttempt({
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
    write_slot_committed_at: committedAt,
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
}

export function buildReplayWorkerV10AuthorityDispatchReceipt(input: {
  key: string
  launch: ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceipt
  frame: ReplayDecisionHarnessWorkerV10AuthorityRequestFrame
  request_bytes: Buffer
  attempt: ReplayDecisionHarnessWorkerV10AuthorityRequestDispatchAttempt
  capture: ReplayWorkerV10AuthorityOpaqueCapture
  write_started_at: string
  write_completed_at: string
  process_completed_at: string
}): ReplayDecisionHarnessWorkerV10AuthorityRequestDispatchReceipt {
  const outcomeHash = canonicalHash({
    dispatch_attempt_hash: input.attempt.dispatch_attempt_hash,
    stdout_bytes_hash: sha256(input.capture.stdout),
    stderr_bytes_hash: sha256(input.capture.stderr),
    exit_status: input.capture.exit_status,
    exit_signal: input.capture.exit_signal,
    transport_error_code: input.capture.transport_error_code,
    transport_error_hash: input.capture.transport_error_hash,
  })
  return createReplayDecisionHarnessWorkerV10AuthorityRequestDispatchReceipt({
    schema_version: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_DISPATCH_RECEIPT_SCHEMA_VERSION,
    receipt_id: `decision-harness-worker-v10-authority-dispatch-receipt-${outcomeHash.slice(0, 24)}`,
    receipt_ref: `receipt://replay-decision-harness-worker-v10-authority-dispatch/${outcomeHash.slice(0, 24)}`,
    receipt_key: input.key,
    receipt_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_DISPATCH_RECEIPT_POLICY_VERSION,
    scope: "one_request_frame_write_close_exit_and_opaque_output_capture_outcome",
    owner: "replay_runner_worker_v10_authority_request_dispatch_registry",
    purpose: "record_transport_completion_without_parsing_or_admitting_worker_response_bytes",
    receipt_status: input.capture.transport_error_code === null
      ? "process_exited_opaque_output_captured" : "transport_failed_opaque_output_captured",
    source_dispatch_attempt_hash: input.attempt.dispatch_attempt_hash,
    source_dispatch_attempt: structuredClone(input.attempt),
    source_process_launch_receipt_hash: input.launch.receipt_hash,
    process_instance_id: input.launch.process_instance_id!,
    observed_child_pid: input.launch.observed_child_pid!,
    request_frame_hash: input.frame.frame_hash,
    request_frame_bytes: input.request_bytes.byteLength,
    request_frame_bytes_hash: sha256(input.request_bytes),
    write_started_at: input.write_started_at,
    write_completed_at: input.write_completed_at,
    process_completed_at: input.process_completed_at,
    clock_evidence: "runner_process_clock_port_not_external_time_attestation",
    stdin_bytes_written: input.request_bytes.byteLength,
    stdin_closed: true,
    stdout_bytes_read: input.capture.stdout.byteLength,
    stdout_bytes_hash: sha256(input.capture.stdout),
    stdout_bytes_base64: input.capture.stdout.toString("base64"),
    stderr_bytes_read: input.capture.stderr.byteLength,
    stderr_bytes_hash: sha256(input.capture.stderr),
    stderr_bytes_base64: input.capture.stderr.toString("base64"),
    raw_capture_encoding: "base64_exact_bytes_local_receipt_carrier_v1",
    raw_capture_authority: "opaque_transport_candidate_not_response_frame",
    process_exit_observation: "runner_observed_exit_or_close_after_stdin_close",
    exit_status: input.capture.exit_status,
    exit_signal: input.capture.exit_signal,
    transport_error_code: input.capture.transport_error_code,
    transport_error_hash: input.capture.transport_error_hash,
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
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex")
}
