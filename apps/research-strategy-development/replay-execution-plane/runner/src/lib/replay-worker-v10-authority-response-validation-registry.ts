import { existsSync, lstatSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_VALIDATION_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_VALIDATION_SCHEMA_VERSION,
  assertReplayDecisionHarnessWorkerV10AuthorityResponseValidation,
  createReplayDecisionHarnessWorkerV10AuthorityResponseValidation,
  decodeReplayDecisionHarnessWorkerV10AuthorityResponseCapture,
  replayDecisionHarnessWorkerV10AuthorityResponseValidationKey,
  type ReplayDecisionHarnessWorkerV10AuthorityResponseValidation,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-response-validation"
import {
  assertReplayDecisionHarnessWorkerV10AuthorityRequestDispatchReceipt,
  type ReplayDecisionHarnessWorkerV10AuthorityRequestDispatchReceipt,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-request-dispatch"
import { canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import { writeReplayImmutableCas } from "./replay-local-artifact-store"
import { readReplayWorkerV10AuthorityRequestDispatchReceipt } from "./replay-worker-v10-authority-request-dispatch-registry"

export interface RegisterReplayWorkerV10AuthorityResponseValidationInput {
  registry_root: string
  source_dispatch_receipt: ReplayDecisionHarnessWorkerV10AuthorityRequestDispatchReceipt
}

export function registerReplayWorkerV10AuthorityResponseValidation(
  input: RegisterReplayWorkerV10AuthorityResponseValidationInput,
): ReplayDecisionHarnessWorkerV10AuthorityResponseValidation {
  requireDurableDispatch(input)
  const dispatch = input.source_dispatch_receipt
  const key = validationKey(dispatch)
  const existing = readReplayWorkerV10AuthorityResponseValidation(input)
  if (existing) return existing
  const decoded = decodeReplayDecisionHarnessWorkerV10AuthorityResponseCapture(dispatch)
  const admitted = decoded.status === "admitted"
  const validation = createReplayDecisionHarnessWorkerV10AuthorityResponseValidation({
    schema_version: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_VALIDATION_SCHEMA_VERSION,
    validation_id: `decision-harness-worker-v10-authority-response-validation-${key.slice(0, 24)}`,
    validation_ref: `validation://replay-decision-harness-worker-v10-authority-response/${key.slice(0, 24)}`,
    validation_key: key,
    validation_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_VALIDATION_POLICY_VERSION,
    scope: "one_dispatch_receipt_bound_response_frame_decode_echo_and_inner_response_validation",
    owner: "replay_runner_worker_v10_authority_response_validation_registry",
    purpose: "admit_or_reject_one_opaque_capture_without_granting_schedule_or_economic_authority",
    validation_status: admitted
      ? "admitted_non_economic_worker_response_candidate" : "rejected_response_capture",
    source_dispatch_receipt_hash: dispatch.receipt_hash,
    source_dispatch_receipt: structuredClone(dispatch),
    source_dispatch_attempt_hash: dispatch.source_dispatch_attempt_hash,
    source_process_launch_receipt_hash: dispatch.source_process_launch_receipt_hash,
    process_instance_id: dispatch.process_instance_id,
    request_frame_hash: dispatch.request_frame_hash,
    worker_request_hash: dispatch.source_dispatch_attempt.request_frame.worker_request_hash,
    raw_stdout_bytes: dispatch.stdout_bytes_read,
    raw_stdout_bytes_hash: dispatch.stdout_bytes_hash,
    raw_stderr_bytes: dispatch.stderr_bytes_read,
    raw_stderr_bytes_hash: dispatch.stderr_bytes_hash,
    process_exit_policy: "exit_zero_no_signal_no_transport_error_and_empty_stderr",
    decode_policy: "fatal_utf8_single_canonical_json_utf8_lf",
    outer_validation_policy: "exact_fields_schema_self_hash_and_request_authority_echo",
    inner_validation_policy: "worker_response_v10_exact_request_echo_payload_and_self_hash",
    raw_capture_reuse_policy: "exact_dispatch_receipt_bytes_only_no_caller_payload",
    validation_time_policy: "not_recorded_pure_deterministic_content_addressed_validation",
    validation_error_code: admitted ? null : decoded.error_code,
    validation_error_hash: admitted ? null : decoded.error_hash,
    response_frame: admitted ? structuredClone(decoded.response_frame) : null,
    response_frame_hash: admitted ? decoded.response_frame.frame_hash : null,
    worker_response_hash: admitted ? decoded.response_frame.worker_response.response_hash : null,
    request_frame_instance_count: 1,
    request_write_receipt_count: 1,
    request_decode_receipt_count: admitted ? 1 : 0,
    response_frame_instance_count: admitted ? 1 : 0,
    response_read_receipt_count: 1,
    response_validation_receipt_count: 1,
    harness_invocation: admitted ? "activated_artifact_emitted_valid_typed_worker_claim" : "not_proven",
    blocker_set_policy: "complete_deterministic_ordered_post_response_validation_blockers",
    blockers: admitted
      ? ["schedule_and_harness_receipt_admission_not_materialized"]
      : ["valid_authority_response_frame_not_admitted"],
    response_admission: admitted
      ? "granted_non_economic_worker_response_candidate_only" : "not_granted",
    decision_output_authority: admitted ? "typed_worker_claim_only_not_schedule_admitted" : "none",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
    trial_authority: "none",
  })
  const content = `${canonicalJson(validation)}\n`
  writeReplayImmutableCas(validationPath(input.registry_root, key), content)
  return parseValidation(content)
}

export function readReplayWorkerV10AuthorityResponseValidation(
  input: RegisterReplayWorkerV10AuthorityResponseValidationInput,
): ReplayDecisionHarnessWorkerV10AuthorityResponseValidation | null {
  requireDurableDispatch(input)
  const path = validationPath(input.registry_root, validationKey(input.source_dispatch_receipt))
  if (!existsSync(path)) return null
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("Authority Response Validation must be a regular file")
  }
  const validation = parseValidation(readFileSync(path, "utf8"))
  if (validation.source_dispatch_receipt_hash !== input.source_dispatch_receipt.receipt_hash) {
    throw new Error("Authority Response Validation parent mismatch")
  }
  return validation
}

function requireDurableDispatch(input: RegisterReplayWorkerV10AuthorityResponseValidationInput): void {
  if (input.registry_root.trim() === "") throw new Error("Authority Response Validation registry root is required")
  assertReplayDecisionHarnessWorkerV10AuthorityRequestDispatchReceipt(input.source_dispatch_receipt)
  const dispatch = input.source_dispatch_receipt
  const durable = readReplayWorkerV10AuthorityRequestDispatchReceipt({
    registry_root: input.registry_root,
    source_process_launch_receipt: dispatch.source_dispatch_attempt.source_process_launch_receipt,
  })
  if (!durable || durable.receipt_hash !== dispatch.receipt_hash) {
    throw new Error("Authority Response Validation requires the exact durable Request Dispatch Receipt")
  }
}

function validationKey(dispatch: ReplayDecisionHarnessWorkerV10AuthorityRequestDispatchReceipt): string {
  return replayDecisionHarnessWorkerV10AuthorityResponseValidationKey({
    dispatch_receipt_hash: dispatch.receipt_hash,
    validation_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_VALIDATION_POLICY_VERSION,
  })
}

function validationPath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-authority-response-validation-${key}.json`)
}

function parseValidation(content: string): ReplayDecisionHarnessWorkerV10AuthorityResponseValidation {
  const value = JSON.parse(content) as ReplayDecisionHarnessWorkerV10AuthorityResponseValidation
  assertReplayDecisionHarnessWorkerV10AuthorityResponseValidation(value)
  if (content !== `${canonicalJson(value)}\n`) throw new Error("Authority Response Validation is not canonical")
  return value
}
