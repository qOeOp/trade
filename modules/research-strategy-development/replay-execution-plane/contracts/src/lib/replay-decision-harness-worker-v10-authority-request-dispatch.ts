import { Buffer } from "node:buffer"
import { createHash } from "node:crypto"
import { canonicalHash, canonicalJson } from "./replay-contracts"
import {
  assertReplayDecisionHarnessWorkerV10AuthorityRequestFrame,
  type ReplayDecisionHarnessWorkerV10AuthorityRequestFrame,
} from "./replay-decision-harness-worker-v10-authority-frame-build-contract"
import {
  assertReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceipt,
  type ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceipt,
} from "./replay-decision-harness-worker-v10-authority-process-launch"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
  requireReplayCrossSourceUtc as requireUtc,
} from "./replay-cross-source-ordering"

export const REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_DISPATCH_ATTEMPT_SCHEMA_VERSION =
  "trade.rd-replay-decision-harness-worker-v10-authority-request-dispatch-attempt.v1" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_DISPATCH_ATTEMPT_POLICY_VERSION =
  "rd-replay-harness-worker-v10-authority-request-dispatch-attempt-v1" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_DISPATCH_RECEIPT_SCHEMA_VERSION =
  "trade.rd-replay-decision-harness-worker-v10-authority-request-dispatch-receipt.v1" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_DISPATCH_RECEIPT_POLICY_VERSION =
  "rd-replay-harness-worker-v10-authority-request-dispatch-receipt-v1" as const

export interface ReplayDecisionHarnessWorkerV10AuthorityRequestDispatchAttempt {
  schema_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_DISPATCH_ATTEMPT_SCHEMA_VERSION
  dispatch_attempt_id: string
  dispatch_attempt_ref: string
  dispatch_attempt_key: string
  dispatch_attempt_hash: string
  dispatch_attempt_policy_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_DISPATCH_ATTEMPT_POLICY_VERSION
  scope: "one_live_process_and_request_frame_bound_at_most_once_write_slot"
  owner: "replay_runner_worker_v10_authority_request_dispatch_registry"
  purpose: "reserve_one_non_replayable_request_frame_write_before_touching_child_stdin"
  status: "write_slot_committed_transport_outcome_pending"
  source_process_launch_receipt_hash: string
  source_process_launch_receipt: ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceipt
  process_instance_id: string
  observed_child_pid: number
  source_authority_transport_contract_hash: string
  source_execution_envelope_hash: string
  process_artifact_hash: string
  source_authority_execution_admission_command_hash: string
  source_authority_process_launch_intent_hash: string
  logical_request_id: string
  worker_request_hash: string
  request_frame_hash: string
  request_frame: ReplayDecisionHarnessWorkerV10AuthorityRequestFrame
  request_frame_encoding: "canonical_json_utf8_lf_single_frame"
  request_frame_bytes: number
  request_frame_bytes_hash: string
  write_slot_committed_at: string
  clock_evidence: "runner_process_clock_port_not_external_time_attestation"
  write_slot_policy: "one_cas_attempt_per_process_and_request_frame_no_automatic_rewrite"
  orphan_attempt_policy: "attempt_without_receipt_is_indeterminate_child_may_have_consumed_request"
  request_frame_instance_count: 1
  request_write_receipt_count: 0
  request_decode_receipt_count: 0
  response_frame_instance_count: 0
  response_read_receipt_count: 0
  response_admission: "not_granted"
  decision_output_authority: "none"
  signal_authority: "none"
  order_authority: "none"
  economic_authority: "none"
  trial_authority: "none"
}

export type ReplayDecisionHarnessWorkerV10AuthorityRequestDispatchAttemptBody = Omit<
  ReplayDecisionHarnessWorkerV10AuthorityRequestDispatchAttempt,
  "dispatch_attempt_hash"
>

export interface ReplayDecisionHarnessWorkerV10AuthorityRequestDispatchReceipt {
  schema_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_DISPATCH_RECEIPT_SCHEMA_VERSION
  receipt_id: string
  receipt_ref: string
  receipt_key: string
  receipt_hash: string
  receipt_policy_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_DISPATCH_RECEIPT_POLICY_VERSION
  scope: "one_request_frame_write_close_exit_and_opaque_output_capture_outcome"
  owner: "replay_runner_worker_v10_authority_request_dispatch_registry"
  purpose: "record_transport_completion_without_parsing_or_admitting_worker_response_bytes"
  receipt_status: "process_exited_opaque_output_captured" | "transport_failed_opaque_output_captured"
  source_dispatch_attempt_hash: string
  source_dispatch_attempt: ReplayDecisionHarnessWorkerV10AuthorityRequestDispatchAttempt
  source_process_launch_receipt_hash: string
  process_instance_id: string
  observed_child_pid: number
  request_frame_hash: string
  request_frame_bytes: number
  request_frame_bytes_hash: string
  write_started_at: string
  write_completed_at: string
  process_completed_at: string
  clock_evidence: "runner_process_clock_port_not_external_time_attestation"
  stdin_bytes_written: number
  stdin_closed: true
  stdout_bytes_read: number
  stdout_bytes_hash: string
  stdout_bytes_base64: string
  stderr_bytes_read: number
  stderr_bytes_hash: string
  stderr_bytes_base64: string
  raw_capture_encoding: "base64_exact_bytes_local_receipt_carrier_v1"
  raw_capture_authority: "opaque_transport_candidate_not_response_frame"
  process_exit_observation: "runner_observed_exit_or_close_after_stdin_close"
  exit_status: number | null
  exit_signal: NodeJS.Signals | null
  transport_error_code: "timeout" | "stdout_limit" | "stderr_limit" | "stream_error" | null
  transport_error_hash: string | null
  request_frame_instance_count: 1
  request_write_receipt_count: 1
  request_decode_receipt_count: 0
  response_frame_instance_count: 0
  response_read_receipt_count: 0
  dispatch_occurrence: "one_request_frame_written_and_stdin_closed"
  harness_invocation: "worker_may_have_invoked_not_proven_by_runner"
  blocker_set_policy: "complete_deterministic_ordered_post_raw_capture_pre_response_admission_blockers"
  blockers: ["raw_response_frame_decode_validation_and_admission_not_materialized"]
  response_admission: "not_granted"
  decision_output_authority: "none"
  signal_authority: "none"
  order_authority: "none"
  economic_authority: "none"
  trial_authority: "none"
}

export type ReplayDecisionHarnessWorkerV10AuthorityRequestDispatchReceiptBody = Omit<
  ReplayDecisionHarnessWorkerV10AuthorityRequestDispatchReceipt,
  "receipt_hash"
>

export function replayDecisionHarnessWorkerV10AuthorityRequestDispatchKey(input: {
  process_launch_receipt_hash: string
  request_frame_hash: string
  dispatch_attempt_policy_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_DISPATCH_ATTEMPT_POLICY_VERSION
}): string {
  requireHash(input.process_launch_receipt_hash, "Authority Request Dispatch process receipt hash")
  requireHash(input.request_frame_hash, "Authority Request Dispatch frame hash")
  if (input.dispatch_attempt_policy_version
      !== REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_DISPATCH_ATTEMPT_POLICY_VERSION) {
    throw new Error("unsupported Authority Request Dispatch natural key")
  }
  return canonicalHash(input)
}

export function createReplayDecisionHarnessWorkerV10AuthorityRequestDispatchAttempt(
  body: ReplayDecisionHarnessWorkerV10AuthorityRequestDispatchAttemptBody,
): ReplayDecisionHarnessWorkerV10AuthorityRequestDispatchAttempt {
  const value = { ...structuredClone(body), dispatch_attempt_hash: canonicalHash(body) }
  assertReplayDecisionHarnessWorkerV10AuthorityRequestDispatchAttempt(value)
  return value
}

export function createReplayDecisionHarnessWorkerV10AuthorityRequestDispatchReceipt(
  body: ReplayDecisionHarnessWorkerV10AuthorityRequestDispatchReceiptBody,
): ReplayDecisionHarnessWorkerV10AuthorityRequestDispatchReceipt {
  const value = { ...structuredClone(body), receipt_hash: canonicalHash(body) }
  assertReplayDecisionHarnessWorkerV10AuthorityRequestDispatchReceipt(value)
  return value
}

export function assertReplayDecisionHarnessWorkerV10AuthorityRequestDispatchAttempt(
  value: ReplayDecisionHarnessWorkerV10AuthorityRequestDispatchAttempt,
): void {
  assertFields(value, ATTEMPT_FIELDS, "Authority Request Dispatch Attempt")
  if (value.schema_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_DISPATCH_ATTEMPT_SCHEMA_VERSION
      || value.dispatch_attempt_policy_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_DISPATCH_ATTEMPT_POLICY_VERSION
      || value.scope !== "one_live_process_and_request_frame_bound_at_most_once_write_slot"
      || value.owner !== "replay_runner_worker_v10_authority_request_dispatch_registry"
      || value.purpose !== "reserve_one_non_replayable_request_frame_write_before_touching_child_stdin"
      || value.status !== "write_slot_committed_transport_outcome_pending"
      || value.request_frame_encoding !== "canonical_json_utf8_lf_single_frame"
      || value.clock_evidence !== "runner_process_clock_port_not_external_time_attestation"
      || value.write_slot_policy !== "one_cas_attempt_per_process_and_request_frame_no_automatic_rewrite"
      || value.orphan_attempt_policy
        !== "attempt_without_receipt_is_indeterminate_child_may_have_consumed_request"
      || value.request_frame_instance_count !== 1 || value.request_write_receipt_count !== 0
      || value.request_decode_receipt_count !== 0 || value.response_frame_instance_count !== 0
      || value.response_read_receipt_count !== 0 || value.response_admission !== "not_granted"
      || value.decision_output_authority !== "none" || value.signal_authority !== "none"
      || value.order_authority !== "none" || value.economic_authority !== "none"
      || value.trial_authority !== "none") throw new Error("unsupported Authority Request Dispatch Attempt")
  for (const item of [value.dispatch_attempt_id, value.dispatch_attempt_ref]) {
    requireText(item, "Authority Request Dispatch Attempt identity")
  }
  for (const item of [value.dispatch_attempt_key, value.dispatch_attempt_hash,
    value.source_process_launch_receipt_hash, value.process_instance_id,
    value.source_authority_transport_contract_hash, value.source_execution_envelope_hash,
    value.process_artifact_hash, value.source_authority_execution_admission_command_hash,
    value.source_authority_process_launch_intent_hash, value.logical_request_id,
    value.worker_request_hash, value.request_frame_hash, value.request_frame_bytes_hash]) {
    requireHash(item, "Authority Request Dispatch Attempt hash")
  }
  requireUtc(value.write_slot_committed_at, "Authority Request Dispatch Attempt time")
  if (!Number.isSafeInteger(value.observed_child_pid) || value.observed_child_pid < 1
      || !Number.isSafeInteger(value.request_frame_bytes) || value.request_frame_bytes < 1) {
    throw new Error("Authority Request Dispatch Attempt process or byte count")
  }
  assertReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceipt(value.source_process_launch_receipt)
  assertReplayDecisionHarnessWorkerV10AuthorityRequestFrame(value.request_frame)
  const launch = value.source_process_launch_receipt
  const frameBytes = Buffer.from(`${canonicalJson(value.request_frame)}\n`, "utf8")
  const expectedKey = replayDecisionHarnessWorkerV10AuthorityRequestDispatchKey({
    process_launch_receipt_hash: launch.receipt_hash,
    request_frame_hash: value.request_frame.frame_hash,
    dispatch_attempt_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_DISPATCH_ATTEMPT_POLICY_VERSION,
  })
  if (launch.receipt_status !== "started_process_frame_not_written"
      || value.dispatch_attempt_key !== expectedKey
      || value.dispatch_attempt_id !== `decision-harness-worker-v10-authority-dispatch-attempt-${expectedKey.slice(0, 24)}`
      || value.dispatch_attempt_ref !== `attempt://replay-decision-harness-worker-v10-authority-dispatch/${expectedKey.slice(0, 24)}`
      || value.source_process_launch_receipt_hash !== launch.receipt_hash
      || value.process_instance_id !== launch.process_instance_id
      || value.observed_child_pid !== launch.observed_child_pid
      || value.source_authority_transport_contract_hash !== launch.source_authority_transport_contract_hash
      || value.source_execution_envelope_hash !== launch.source_execution_envelope_hash
      || value.process_artifact_hash !== launch.process_artifact_hash
      || value.source_authority_execution_admission_command_hash
        !== launch.source_authority_execution_admission_command_hash
      || value.source_authority_process_launch_intent_hash
        !== launch.source_authority_process_launch_intent_hash
      || value.logical_request_id !== launch.logical_request_id
      || value.worker_request_hash !== launch.worker_request_hash
      || value.request_frame_hash !== value.request_frame.frame_hash
      || value.request_frame.transport_contract_hash !== launch.source_authority_transport_contract_hash
      || value.request_frame.execution_envelope_hash !== launch.source_execution_envelope_hash
      || value.request_frame.process_artifact_hash !== launch.process_artifact_hash
      || value.request_frame.execution_admission_command_hash
        !== launch.source_authority_execution_admission_command_hash
      || value.request_frame.process_launch_intent_hash
        !== launch.source_authority_process_launch_intent_hash
      || value.request_frame.logical_request_id !== launch.logical_request_id
      || value.request_frame.worker_request_hash !== launch.worker_request_hash
      || value.request_frame_bytes !== frameBytes.byteLength
      || value.request_frame_bytes_hash !== sha256(frameBytes)) {
    throw new Error("Authority Request Dispatch Attempt lineage or frame drift")
  }
  const { dispatch_attempt_hash: hash, ...body } = value
  if (hash !== canonicalHash(body)) throw new Error("Authority Request Dispatch Attempt hash mismatch")
}

export function assertReplayDecisionHarnessWorkerV10AuthorityRequestDispatchReceipt(
  value: ReplayDecisionHarnessWorkerV10AuthorityRequestDispatchReceipt,
): void {
  assertFields(value, RECEIPT_FIELDS, "Authority Request Dispatch Receipt")
  if (value.schema_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_DISPATCH_RECEIPT_SCHEMA_VERSION
      || value.receipt_policy_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_DISPATCH_RECEIPT_POLICY_VERSION
      || value.scope !== "one_request_frame_write_close_exit_and_opaque_output_capture_outcome"
      || value.owner !== "replay_runner_worker_v10_authority_request_dispatch_registry"
      || value.purpose !== "record_transport_completion_without_parsing_or_admitting_worker_response_bytes"
      || !["process_exited_opaque_output_captured", "transport_failed_opaque_output_captured"]
        .includes(value.receipt_status)
      || value.clock_evidence !== "runner_process_clock_port_not_external_time_attestation"
      || value.stdin_closed !== true
      || value.raw_capture_encoding !== "base64_exact_bytes_local_receipt_carrier_v1"
      || value.raw_capture_authority !== "opaque_transport_candidate_not_response_frame"
      || value.process_exit_observation !== "runner_observed_exit_or_close_after_stdin_close"
      || value.request_frame_instance_count !== 1 || value.request_write_receipt_count !== 1
      || value.request_decode_receipt_count !== 0 || value.response_frame_instance_count !== 0
      || value.response_read_receipt_count !== 0
      || value.dispatch_occurrence !== "one_request_frame_written_and_stdin_closed"
      || value.harness_invocation !== "worker_may_have_invoked_not_proven_by_runner"
      || value.blocker_set_policy
        !== "complete_deterministic_ordered_post_raw_capture_pre_response_admission_blockers"
      || canonicalJson(value.blockers)
        !== canonicalJson(["raw_response_frame_decode_validation_and_admission_not_materialized"])
      || value.response_admission !== "not_granted" || value.decision_output_authority !== "none"
      || value.signal_authority !== "none" || value.order_authority !== "none"
      || value.economic_authority !== "none" || value.trial_authority !== "none") {
    throw new Error("unsupported Authority Request Dispatch Receipt")
  }
  for (const item of [value.receipt_id, value.receipt_ref]) requireText(item, "dispatch receipt identity")
  for (const item of [value.receipt_key, value.receipt_hash, value.source_dispatch_attempt_hash,
    value.source_process_launch_receipt_hash, value.process_instance_id, value.request_frame_hash,
    value.request_frame_bytes_hash, value.stdout_bytes_hash, value.stderr_bytes_hash]) {
    requireHash(item, "Authority Request Dispatch Receipt hash")
  }
  for (const item of [value.write_started_at, value.write_completed_at, value.process_completed_at]) {
    requireUtc(item, "Authority Request Dispatch Receipt time")
  }
  if (Date.parse(value.write_started_at) > Date.parse(value.write_completed_at)
      || Date.parse(value.write_completed_at) > Date.parse(value.process_completed_at)) {
    throw new Error("Authority Request Dispatch Receipt chronology")
  }
  for (const count of [value.observed_child_pid, value.request_frame_bytes, value.stdin_bytes_written,
    value.stdout_bytes_read, value.stderr_bytes_read]) {
    if (!Number.isSafeInteger(count) || count < 0) throw new Error("Authority Request Dispatch Receipt count")
  }
  assertReplayDecisionHarnessWorkerV10AuthorityRequestDispatchAttempt(value.source_dispatch_attempt)
  const attempt = value.source_dispatch_attempt
  const stdout = decodeExactBase64(value.stdout_bytes_base64)
  const stderr = decodeExactBase64(value.stderr_bytes_base64)
  const succeeded = value.transport_error_code === null
  if (value.receipt_key !== attempt.dispatch_attempt_key
      || value.source_dispatch_attempt_hash !== attempt.dispatch_attempt_hash
      || value.source_process_launch_receipt_hash !== attempt.source_process_launch_receipt_hash
      || value.process_instance_id !== attempt.process_instance_id
      || value.observed_child_pid !== attempt.observed_child_pid
      || value.request_frame_hash !== attempt.request_frame_hash
      || value.request_frame_bytes !== attempt.request_frame_bytes
      || value.request_frame_bytes_hash !== attempt.request_frame_bytes_hash
      || value.stdin_bytes_written !== attempt.request_frame_bytes
      || value.stdout_bytes_read !== stdout.byteLength || value.stdout_bytes_hash !== sha256(stdout)
      || value.stderr_bytes_read !== stderr.byteLength || value.stderr_bytes_hash !== sha256(stderr)
      || succeeded !== (value.receipt_status === "process_exited_opaque_output_captured")
      || (succeeded && value.transport_error_hash !== null)
      || (!succeeded && value.transport_error_hash === null)) {
    throw new Error("Authority Request Dispatch Receipt outcome or lineage drift")
  }
  if (value.transport_error_hash !== null) requireHash(value.transport_error_hash, "dispatch error hash")
  if (value.exit_status !== null && (!Number.isSafeInteger(value.exit_status) || value.exit_status < 0)) {
    throw new Error("Authority Request Dispatch Receipt exit status")
  }
  const { receipt_hash: hash, ...body } = value
  if (hash !== canonicalHash(body)) throw new Error("Authority Request Dispatch Receipt hash mismatch")
}

const ATTEMPT_FIELDS = ["clock_evidence", "decision_output_authority", "dispatch_attempt_hash",
  "dispatch_attempt_id", "dispatch_attempt_key", "dispatch_attempt_policy_version", "dispatch_attempt_ref",
  "economic_authority", "logical_request_id", "observed_child_pid", "order_authority", "orphan_attempt_policy",
  "owner", "process_artifact_hash", "process_instance_id", "purpose", "request_decode_receipt_count",
  "request_frame", "request_frame_bytes", "request_frame_bytes_hash", "request_frame_encoding",
  "request_frame_hash", "request_frame_instance_count", "request_write_receipt_count", "response_admission",
  "response_frame_instance_count", "response_read_receipt_count", "schema_version", "scope", "signal_authority",
  "source_authority_execution_admission_command_hash", "source_authority_process_launch_intent_hash",
  "source_authority_transport_contract_hash", "source_execution_envelope_hash", "source_process_launch_receipt",
  "source_process_launch_receipt_hash", "status", "trial_authority", "worker_request_hash",
  "write_slot_committed_at", "write_slot_policy"].sort()
const RECEIPT_FIELDS = ["blocker_set_policy", "blockers", "clock_evidence", "decision_output_authority",
  "dispatch_occurrence", "economic_authority", "exit_signal", "exit_status", "harness_invocation",
  "observed_child_pid", "order_authority", "owner", "process_completed_at", "process_exit_observation",
  "process_instance_id", "purpose", "raw_capture_authority", "raw_capture_encoding", "receipt_hash",
  "receipt_id", "receipt_key", "receipt_policy_version", "receipt_ref", "receipt_status",
  "request_decode_receipt_count", "request_frame_bytes", "request_frame_bytes_hash", "request_frame_hash",
  "request_frame_instance_count", "request_write_receipt_count", "response_admission", "response_frame_instance_count",
  "response_read_receipt_count", "schema_version", "scope", "signal_authority", "source_dispatch_attempt",
  "source_dispatch_attempt_hash", "source_process_launch_receipt_hash", "stderr_bytes_base64", "stderr_bytes_hash",
  "stderr_bytes_read", "stdin_bytes_written", "stdin_closed", "stdout_bytes_base64", "stdout_bytes_hash",
  "stdout_bytes_read", "transport_error_code", "transport_error_hash", "trial_authority", "write_completed_at",
  "write_started_at"].sort()

function assertFields(value: object, expected: string[], label: string): void {
  if (canonicalJson(Object.keys(value).sort()) !== canonicalJson(expected)) throw new Error(`${label} fields drift`)
}

function decodeExactBase64(value: string): Buffer {
  if (typeof value !== "string") throw new Error("Authority Request Dispatch capture base64")
  const bytes = Buffer.from(value, "base64")
  if (bytes.toString("base64") !== value) throw new Error("Authority Request Dispatch non-canonical base64")
  return bytes
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex")
}
