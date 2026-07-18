import { canonicalHash, canonicalJson } from "./replay-contracts"
import {
  assertReplayDecisionHarnessWorkerV10AuthorityRequestDispatchReceipt,
  type ReplayDecisionHarnessWorkerV10AuthorityRequestDispatchReceipt,
} from "./replay-decision-harness-worker-v10-authority-request-dispatch"
import {
  assertReplayDecisionHarnessWorkerV10AuthorityResponseFrame,
  type ReplayDecisionHarnessWorkerV10AuthorityResponseFrame,
} from "./replay-decision-harness-worker-v10-authority-frame-build-contract"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
} from "./replay-cross-source-ordering"

export const REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_VALIDATION_SCHEMA_VERSION =
  "trade.rd-replay-decision-harness-worker-v10-authority-response-validation.v1" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_VALIDATION_POLICY_VERSION =
  "rd-replay-harness-worker-v10-authority-response-validation-v1" as const

export type ReplayDecisionHarnessWorkerV10AuthorityResponseValidationErrorCode =
  | "transport_outcome_not_admissible"
  | "response_frame_empty"
  | "response_frame_malformed_utf8"
  | "response_frame_not_single_canonical_json_utf8_lf"
  | "response_frame_json_invalid"
  | "response_frame_contract_or_echo_invalid"

export type ReplayDecisionHarnessWorkerV10AuthorityResponseDecodeResult =
  | {
    status: "admitted"
    response_frame: ReplayDecisionHarnessWorkerV10AuthorityResponseFrame
  }
  | {
    status: "rejected"
    error_code: ReplayDecisionHarnessWorkerV10AuthorityResponseValidationErrorCode
    error_hash: string
  }

export interface ReplayDecisionHarnessWorkerV10AuthorityResponseValidation {
  schema_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_VALIDATION_SCHEMA_VERSION
  validation_id: string
  validation_ref: string
  validation_key: string
  validation_hash: string
  validation_policy_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_VALIDATION_POLICY_VERSION
  scope: "one_dispatch_receipt_bound_response_frame_decode_echo_and_inner_response_validation"
  owner: "replay_runner_worker_v10_authority_response_validation_registry"
  purpose: "admit_or_reject_one_opaque_capture_without_granting_schedule_or_economic_authority"
  validation_status: "admitted_non_economic_worker_response_candidate" | "rejected_response_capture"
  source_dispatch_receipt_hash: string
  source_dispatch_receipt: ReplayDecisionHarnessWorkerV10AuthorityRequestDispatchReceipt
  source_dispatch_attempt_hash: string
  source_process_launch_receipt_hash: string
  process_instance_id: string
  request_frame_hash: string
  worker_request_hash: string
  raw_stdout_bytes: number
  raw_stdout_bytes_hash: string
  raw_stderr_bytes: number
  raw_stderr_bytes_hash: string
  process_exit_policy: "exit_zero_no_signal_no_transport_error_and_empty_stderr"
  decode_policy: "fatal_utf8_single_canonical_json_utf8_lf"
  outer_validation_policy: "exact_fields_schema_self_hash_and_request_authority_echo"
  inner_validation_policy: "worker_response_v10_exact_request_echo_payload_and_self_hash"
  raw_capture_reuse_policy: "exact_dispatch_receipt_bytes_only_no_caller_payload"
  validation_time_policy: "not_recorded_pure_deterministic_content_addressed_validation"
  validation_error_code: ReplayDecisionHarnessWorkerV10AuthorityResponseValidationErrorCode | null
  validation_error_hash: string | null
  response_frame: ReplayDecisionHarnessWorkerV10AuthorityResponseFrame | null
  response_frame_hash: string | null
  worker_response_hash: string | null
  request_frame_instance_count: 1
  request_write_receipt_count: 1
  request_decode_receipt_count: 0 | 1
  response_frame_instance_count: 0 | 1
  response_read_receipt_count: 1
  response_validation_receipt_count: 1
  harness_invocation: "activated_artifact_emitted_valid_typed_worker_claim" | "not_proven"
  blocker_set_policy: "complete_deterministic_ordered_post_response_validation_blockers"
  blockers: Array<
    "valid_authority_response_frame_not_admitted"
    | "schedule_and_harness_receipt_admission_not_materialized"
  >
  response_admission: "granted_non_economic_worker_response_candidate_only" | "not_granted"
  decision_output_authority: "typed_worker_claim_only_not_schedule_admitted" | "none"
  signal_authority: "none"
  order_authority: "none"
  economic_authority: "none"
  trial_authority: "none"
}

export type ReplayDecisionHarnessWorkerV10AuthorityResponseValidationBody = Omit<
  ReplayDecisionHarnessWorkerV10AuthorityResponseValidation,
  "validation_hash"
>

export function replayDecisionHarnessWorkerV10AuthorityResponseValidationKey(input: {
  dispatch_receipt_hash: string
  validation_policy_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_VALIDATION_POLICY_VERSION
}): string {
  requireHash(input.dispatch_receipt_hash, "Authority Response Validation Dispatch Receipt hash")
  if (input.validation_policy_version
      !== REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_VALIDATION_POLICY_VERSION) {
    throw new Error("unsupported Authority Response Validation natural key")
  }
  return canonicalHash(input)
}

export function createReplayDecisionHarnessWorkerV10AuthorityResponseValidation(
  body: ReplayDecisionHarnessWorkerV10AuthorityResponseValidationBody,
): ReplayDecisionHarnessWorkerV10AuthorityResponseValidation {
  const value = { ...structuredClone(body), validation_hash: canonicalHash(body) }
  assertReplayDecisionHarnessWorkerV10AuthorityResponseValidation(value)
  return value
}

export function decodeReplayDecisionHarnessWorkerV10AuthorityResponseCapture(
  dispatch: ReplayDecisionHarnessWorkerV10AuthorityRequestDispatchReceipt,
): ReplayDecisionHarnessWorkerV10AuthorityResponseDecodeResult {
  assertReplayDecisionHarnessWorkerV10AuthorityRequestDispatchReceipt(dispatch)
  const reject = (
    errorCode: ReplayDecisionHarnessWorkerV10AuthorityResponseValidationErrorCode,
    detail: string,
  ): ReplayDecisionHarnessWorkerV10AuthorityResponseDecodeResult => ({
    status: "rejected",
    error_code: errorCode,
    error_hash: canonicalHash({ error_code: errorCode, detail_hash: sha256(Buffer.from(detail, "utf8")) }),
  })
  if (dispatch.receipt_status !== "process_exited_opaque_output_captured"
      || dispatch.transport_error_code !== null || dispatch.exit_status !== 0
      || dispatch.exit_signal !== null || dispatch.stderr_bytes_read !== 0) {
    return reject("transport_outcome_not_admissible", canonicalJson({
      receipt_status: dispatch.receipt_status,
      transport_error_code: dispatch.transport_error_code,
      exit_status: dispatch.exit_status,
      exit_signal: dispatch.exit_signal,
      stderr_bytes_read: dispatch.stderr_bytes_read,
    }))
  }
  const bytes = Buffer.from(dispatch.stdout_bytes_base64, "base64")
  if (bytes.byteLength === 0) return reject("response_frame_empty", "stdout_bytes=0")
  let text: string
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch (error) {
    return reject("response_frame_malformed_utf8", error instanceof Error ? error.message : String(error))
  }
  if (!text.endsWith("\n") || text.indexOf("\n") !== text.length - 1) {
    return reject("response_frame_not_single_canonical_json_utf8_lf", "single_terminal_lf_required")
  }
  let candidate: ReplayDecisionHarnessWorkerV10AuthorityResponseFrame
  try {
    candidate = JSON.parse(text.slice(0, -1)) as ReplayDecisionHarnessWorkerV10AuthorityResponseFrame
  } catch (error) {
    return reject("response_frame_json_invalid", error instanceof Error ? error.message : String(error))
  }
  if (`${canonicalJson(candidate)}\n` !== text) {
    return reject("response_frame_not_single_canonical_json_utf8_lf", "canonical_json_mismatch")
  }
  try {
    assertReplayDecisionHarnessWorkerV10AuthorityResponseFrame(
      candidate,
      dispatch.source_dispatch_attempt.request_frame,
    )
  } catch (error) {
    return reject("response_frame_contract_or_echo_invalid", error instanceof Error ? error.message : String(error))
  }
  return { status: "admitted", response_frame: candidate }
}

export function assertReplayDecisionHarnessWorkerV10AuthorityResponseValidation(
  value: ReplayDecisionHarnessWorkerV10AuthorityResponseValidation,
): void {
  assertFields(value, FIELDS, "Authority Response Validation")
  const admitted = value.validation_status === "admitted_non_economic_worker_response_candidate"
  if (value.schema_version !== REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_VALIDATION_SCHEMA_VERSION
      || value.validation_policy_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_VALIDATION_POLICY_VERSION
      || value.scope !== "one_dispatch_receipt_bound_response_frame_decode_echo_and_inner_response_validation"
      || value.owner !== "replay_runner_worker_v10_authority_response_validation_registry"
      || value.purpose !== "admit_or_reject_one_opaque_capture_without_granting_schedule_or_economic_authority"
      || !["admitted_non_economic_worker_response_candidate", "rejected_response_capture"]
        .includes(value.validation_status)
      || value.process_exit_policy !== "exit_zero_no_signal_no_transport_error_and_empty_stderr"
      || value.decode_policy !== "fatal_utf8_single_canonical_json_utf8_lf"
      || value.outer_validation_policy !== "exact_fields_schema_self_hash_and_request_authority_echo"
      || value.inner_validation_policy !== "worker_response_v10_exact_request_echo_payload_and_self_hash"
      || value.raw_capture_reuse_policy !== "exact_dispatch_receipt_bytes_only_no_caller_payload"
      || value.validation_time_policy !== "not_recorded_pure_deterministic_content_addressed_validation"
      || value.request_frame_instance_count !== 1 || value.request_write_receipt_count !== 1
      || value.response_read_receipt_count !== 1
      || value.response_validation_receipt_count !== 1 || value.signal_authority !== "none"
      || value.order_authority !== "none" || value.economic_authority !== "none"
      || value.trial_authority !== "none") throw new Error("unsupported Authority Response Validation")
  for (const item of [value.validation_id, value.validation_ref]) {
    requireText(item, "Authority Response Validation identity")
  }
  for (const item of [value.validation_key, value.validation_hash, value.source_dispatch_receipt_hash,
    value.source_dispatch_attempt_hash, value.source_process_launch_receipt_hash, value.process_instance_id,
    value.request_frame_hash, value.worker_request_hash, value.raw_stdout_bytes_hash,
    value.raw_stderr_bytes_hash]) requireHash(item, "Authority Response Validation hash")
  for (const count of [value.raw_stdout_bytes, value.raw_stderr_bytes]) {
    if (!Number.isSafeInteger(count) || count < 0) throw new Error("Authority Response Validation byte count")
  }
  assertReplayDecisionHarnessWorkerV10AuthorityRequestDispatchReceipt(value.source_dispatch_receipt)
  const dispatch = value.source_dispatch_receipt
  const attempt = dispatch.source_dispatch_attempt
  const decoded = decodeReplayDecisionHarnessWorkerV10AuthorityResponseCapture(dispatch)
  const expectedKey = replayDecisionHarnessWorkerV10AuthorityResponseValidationKey({
    dispatch_receipt_hash: dispatch.receipt_hash,
    validation_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_VALIDATION_POLICY_VERSION,
  })
  if (value.validation_key !== expectedKey
      || value.validation_id !== `decision-harness-worker-v10-authority-response-validation-${expectedKey.slice(0, 24)}`
      || value.validation_ref !== `validation://replay-decision-harness-worker-v10-authority-response/${expectedKey.slice(0, 24)}`
      || value.source_dispatch_receipt_hash !== dispatch.receipt_hash
      || value.source_dispatch_attempt_hash !== dispatch.source_dispatch_attempt_hash
      || value.source_process_launch_receipt_hash !== dispatch.source_process_launch_receipt_hash
      || value.process_instance_id !== dispatch.process_instance_id
      || value.request_frame_hash !== dispatch.request_frame_hash
      || value.worker_request_hash !== attempt.request_frame.worker_request_hash
      || value.raw_stdout_bytes !== dispatch.stdout_bytes_read
      || value.raw_stdout_bytes_hash !== dispatch.stdout_bytes_hash
      || value.raw_stderr_bytes !== dispatch.stderr_bytes_read
      || value.raw_stderr_bytes_hash !== dispatch.stderr_bytes_hash) {
    throw new Error("Authority Response Validation parent binding drift")
  }
  if (admitted) {
    if (value.validation_error_code !== null || value.validation_error_hash !== null
        || value.response_frame === null || value.response_frame_hash === null
        || value.worker_response_hash === null || value.request_decode_receipt_count !== 1
        || value.response_frame_instance_count !== 1
        || value.harness_invocation !== "activated_artifact_emitted_valid_typed_worker_claim"
        || canonicalJson(value.blockers)
          !== canonicalJson(["schedule_and_harness_receipt_admission_not_materialized"])
        || value.response_admission !== "granted_non_economic_worker_response_candidate_only"
        || value.decision_output_authority !== "typed_worker_claim_only_not_schedule_admitted") {
      throw new Error("Authority Response Validation admitted projection drift")
    }
    assertReplayDecisionHarnessWorkerV10AuthorityResponseFrame(value.response_frame, attempt.request_frame)
    if (value.response_frame_hash !== value.response_frame.frame_hash
        || value.worker_response_hash !== value.response_frame.worker_response.response_hash
        || decoded.status !== "admitted"
        || canonicalJson(decoded.response_frame) !== canonicalJson(value.response_frame)) {
      throw new Error("Authority Response Validation admitted Response hash drift")
    }
  } else {
    if (value.validation_error_code === null || value.validation_error_hash === null
        || value.response_frame !== null || value.response_frame_hash !== null
        || value.request_decode_receipt_count !== 0
        || value.worker_response_hash !== null || value.response_frame_instance_count !== 0
        || value.harness_invocation !== "not_proven"
        || canonicalJson(value.blockers) !== canonicalJson(["valid_authority_response_frame_not_admitted"])
        || value.response_admission !== "not_granted" || value.decision_output_authority !== "none") {
      throw new Error("Authority Response Validation rejected projection drift")
    }
    requireHash(value.validation_error_hash, "Authority Response Validation error hash")
    if (decoded.status !== "rejected" || decoded.error_code !== value.validation_error_code
        || decoded.error_hash !== value.validation_error_hash) {
      throw new Error("Authority Response Validation rejected decode projection drift")
    }
  }
  const { validation_hash: hash, ...body } = value
  if (hash !== canonicalHash(body)) throw new Error("Authority Response Validation hash mismatch")
}

const FIELDS = ["blocker_set_policy", "blockers", "decision_output_authority", "decode_policy",
  "economic_authority", "harness_invocation", "inner_validation_policy", "order_authority",
  "outer_validation_policy", "owner", "process_exit_policy", "process_instance_id", "purpose",
  "raw_capture_reuse_policy", "raw_stderr_bytes", "raw_stderr_bytes_hash", "raw_stdout_bytes",
  "raw_stdout_bytes_hash", "request_decode_receipt_count", "request_frame_hash", "request_frame_instance_count",
  "request_write_receipt_count", "response_admission", "response_frame", "response_frame_hash",
  "response_frame_instance_count", "response_read_receipt_count", "response_validation_receipt_count",
  "schema_version", "scope", "signal_authority", "source_dispatch_attempt_hash", "source_dispatch_receipt",
  "source_dispatch_receipt_hash", "source_process_launch_receipt_hash", "trial_authority", "validation_error_code",
  "validation_error_hash", "validation_hash", "validation_id", "validation_key", "validation_policy_version",
  "validation_ref", "validation_status", "validation_time_policy", "worker_request_hash",
  "worker_response_hash"].sort()

function assertFields(value: object, expected: string[], label: string): void {
  if (canonicalJson(Object.keys(value).sort()) !== canonicalJson(expected)) throw new Error(`${label} fields drift`)
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex")
}
import { Buffer } from "node:buffer"
import { createHash } from "node:crypto"
