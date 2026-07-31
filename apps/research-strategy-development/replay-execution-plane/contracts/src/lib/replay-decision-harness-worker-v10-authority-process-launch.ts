import { canonicalHash, canonicalJson } from "./replay-contracts"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_ACTIVATED_STDIO_ARTIFACT_FILE,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_ENV,
} from "./replay-decision-harness-worker-v10-activated-stdio-capability"
import {
  assertReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidation,
  type ReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidation,
} from "./replay-decision-harness-worker-v10-authority-spawn-boundary-revalidation"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
  requireReplayCrossSourceUtc as requireUtc,
} from "./replay-cross-source-ordering"

export const REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_LAUNCH_ATTEMPT_SCHEMA_VERSION =
  "trade.rd-replay-decision-harness-worker-v10-authority-process-launch-attempt.v1" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_LAUNCH_ATTEMPT_POLICY_VERSION =
  "rd-replay-harness-worker-v10-authority-process-launch-attempt-v1" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_LAUNCH_RECEIPT_SCHEMA_VERSION =
  "trade.rd-replay-decision-harness-worker-v10-authority-process-launch-receipt.v1" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_LAUNCH_RECEIPT_POLICY_VERSION =
  "rd-replay-harness-worker-v10-authority-process-launch-receipt-v1" as const

export interface ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchAttempt {
  schema_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_LAUNCH_ATTEMPT_SCHEMA_VERSION
  launch_attempt_id: string
  launch_attempt_ref: string
  launch_attempt_key: string
  launch_attempt_hash: string
  launch_attempt_policy_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_LAUNCH_ATTEMPT_POLICY_VERSION
  scope: "one_spawn_revalidation_bound_at_most_once_local_process_launch_slot"
  owner: "replay_runner_worker_v10_authority_process_launch_registry"
  purpose: "reserve_one_non_replayable_fresh_child_process_start_before_any_frame_write"
  status: "launch_slot_committed_process_outcome_pending"
  source_spawn_revalidation_id: string
  source_spawn_revalidation_hash: string
  source_spawn_revalidation: ReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidation
  source_authority_capsule_id: string
  source_authority_capsule_record_hash: string
  authority_capsule_hash: string
  source_revalidation_request_hash: string
  control_plane_revalidation_receipt_hash: string
  attempt_id: string
  attempt_ordinal: number
  worker_id: string
  lease_generation: number
  current_attempt_lease_hash: string
  revalidated_at: string
  launch_invoked_at: string
  valid_before: string
  clock_evidence: "runner_process_clock_port_not_external_time_attestation"
  freshness_relation: "control_plane_revalidation_completed_at_or_before_launch_invocation_before_lease_expiry"
  cancellation_race_limit: "cancellation_or_fencing_may_occur_between_revalidation_and_kernel_spawn"
  runtime_id: "bun"
  runtime_version: string
  runtime_executable_hash: string
  process_artifact_hash: string
  process_artifact_file_name:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_ACTIVATED_STDIO_ARTIFACT_FILE
  runtime_binding_policy: "current_runner_runtime_exactly_matches_authority_intent"
  artifact_materialization_policy: "fresh_private_ephemeral_file_mode_0500_and_hash_verified_before_spawn"
  spawn_argv_policy: "attested_runtime_then_ephemeral_exact_authority_artifact_only"
  working_directory_policy: "fresh_private_ephemeral_directory_path_not_persisted"
  environment_policy: "tz_utc_lang_c_lc_all_c_plus_exact_single_capsule_no_inherited_values"
  authority_capsule_environment_variable: typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_ENV
  authority_capsule_canonical_json_hash: string
  stdio_policy: "three_pipes_open_zero_request_bytes_written_and_stdin_not_closed"
  launch_slot_policy: "one_cas_attempt_per_spawn_revalidation_no_automatic_relaunch"
  orphan_attempt_policy: "attempt_without_receipt_is_indeterminate_and_requires_manual_recovery"
  process_launch_occurrence: "pending"
  process_launch_receipt: null
  process_launch_receipt_count: 0
  admitted_process_instance: null
  admitted_process_instance_count: 0
  request_frame_instance_count: 0
  request_write_receipt_count: 0
  request_decode_receipt_count: 0
  response_frame_instance_count: 0
  response_read_receipt_count: 0
  dispatch_occurrence: "not_materialized"
  transport_activation: "launch_slot_committed_process_and_frames_pending"
  harness_invocation: "forbidden"
  response_admission: "not_granted"
  decision_output_authority: "none"
  signal_authority: "none"
  order_authority: "none"
  economic_authority: "none"
  trial_authority: "none"
}

export type ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchAttemptBody = Omit<
  ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchAttempt,
  "launch_attempt_hash"
>

export type ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceiptStatus =
  | "started_process_frame_not_written"
  | "failed_before_start"

export type ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchBlocker =
  | "authority_frame_write_decode_read_and_admission_not_materialized"
  | "process_launch_failed_fresh_authority_lineage_required"

export interface ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceipt {
  schema_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_LAUNCH_RECEIPT_SCHEMA_VERSION
  receipt_id: string
  receipt_ref: string
  receipt_key: string
  receipt_hash: string
  receipt_policy_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_LAUNCH_RECEIPT_POLICY_VERSION
  scope: "one_attempt_bound_local_child_process_start_outcome_before_any_frame_write"
  owner: "replay_runner_worker_v10_authority_process_launch_registry"
  purpose: "record_one_at_most_once_spawn_outcome_without_worker_request_dispatch"
  receipt_status: ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceiptStatus
  source_launch_attempt_id: string
  source_launch_attempt_ref: string
  source_launch_attempt_hash: string
  source_launch_attempt: ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchAttempt
  source_spawn_revalidation_hash: string
  source_authority_capsule_record_hash: string
  authority_capsule_hash: string
  source_authority_process_launch_intent_hash: string
  source_authority_execution_admission_command_hash: string
  source_authority_transport_contract_hash: string
  process_artifact_hash: string
  source_execution_envelope_hash: string
  logical_request_id: string
  worker_request_hash: string
  attempt_id: string
  attempt_ordinal: number
  worker_id: string
  lease_generation: number
  current_attempt_lease_hash: string
  launch_invoked_at: string
  spawn_observed_at: string
  valid_before: string
  clock_evidence: "runner_process_clock_port_not_external_time_attestation"
  observed_child_pid: number | null
  process_instance_id: string | null
  process_error_code: "spawn_error" | "runner_pre_start_failure" | null
  process_error_hash: string | null
  pid_namespace: "runner_local_os_namespace_unattested"
  process_identity_strength:
    "local_child_spawn_event_pid_exact_runtime_argv_environment_and_ephemeral_cwd_hash"
  pid_reuse_policy: "pid_never_sufficient_receipt_context_spawn_time_and_hash_required"
  kernel_start_evidence: "runner_observed_child_spawn_event_not_kernel_timestamp_or_remote_attestation"
  lease_freshness_evidence: "source_control_plane_revalidation_then_runner_launch_time_not_post_spawn_authority_read"
  cancellation_race_limit: "receipt_cannot_prove_absence_of_cancellation_or_fencing_after_revalidation"
  runtime_executable_hash: string
  artifact_materialization_hash: string | null
  spawn_argv_hash: string | null
  working_directory_instance_hash: string | null
  environment_hash: string | null
  authority_capsule_environment_value_hash: string
  process_launch_occurrence: "runner_observed_child_started" | "not_observed_failed_before_start"
  process_liveness_at_receipt: "live_child_handle_observed" | "no_child_handle"
  process_handle_durability: "process_handle_is_ephemeral_and_not_recoverable_from_receipt"
  process_recovery_policy: "future_frame_requires_exact_new_live_handle_receipt_alone_is_insufficient"
  retry_policy: "no_automatic_relaunch_same_attempt_even_after_failure_or_orphan"
  stdin_bytes_written: 0
  stdin_closed: false
  stdout_bytes_read: 0
  stderr_bytes_read: 0
  process_exit_observation: "not_observed_at_receipt"
  exit_status: null
  exit_signal: null
  blocker_set_policy: "complete_deterministic_ordered_post_launch_pre_dispatch_blockers"
  blockers: ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchBlocker[]
  process_launch_receipt_count: 1
  admitted_process_instance: string | null
  admitted_process_instance_count: 0 | 1
  request_frame_instance_count: 0
  request_write_receipt_count: 0
  request_decode_receipt_count: 0
  response_frame_instance_count: 0
  response_read_receipt_count: 0
  dispatch_occurrence: "not_materialized_zero_worker_request_bytes"
  transport_activation: "process_started_frame_blocked" | "process_not_started"
  harness_invocation: "forbidden"
  response_admission: "not_granted"
  decision_output_authority: "none"
  signal_authority: "none"
  order_authority: "none"
  economic_authority: "none"
  trial_authority: "none"
}

export type ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceiptBody = Omit<
  ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceipt,
  "receipt_hash"
>

export function replayDecisionHarnessWorkerV10AuthorityProcessLaunchKey(input: {
  spawn_revalidation_hash: string
  launch_attempt_policy_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_LAUNCH_ATTEMPT_POLICY_VERSION
}): string {
  requireHash(input.spawn_revalidation_hash, "Authority Process Launch revalidation hash")
  if (input.launch_attempt_policy_version
      !== REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_LAUNCH_ATTEMPT_POLICY_VERSION) {
    throw new Error("unsupported Authority Process Launch natural key")
  }
  return canonicalHash(input)
}

export function createReplayDecisionHarnessWorkerV10AuthorityProcessLaunchAttempt(
  body: ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchAttemptBody,
): ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchAttempt {
  const value = { ...structuredClone(body), launch_attempt_hash: canonicalHash(body) }
  assertReplayDecisionHarnessWorkerV10AuthorityProcessLaunchAttempt(value)
  return value
}

export function createReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceipt(
  body: ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceiptBody,
): ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceipt {
  const value = { ...structuredClone(body), receipt_hash: canonicalHash(body) }
  assertReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceipt(value)
  return value
}

export function replayDecisionHarnessWorkerV10AuthorityProcessLaunchBlockers(
  status: ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceiptStatus,
): ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchBlocker[] {
  return status === "started_process_frame_not_written"
    ? ["authority_frame_write_decode_read_and_admission_not_materialized"]
    : ["process_launch_failed_fresh_authority_lineage_required"]
}

export function assertReplayDecisionHarnessWorkerV10AuthorityProcessLaunchAttempt(
  value: ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchAttempt,
): void {
  assertFields(value, ATTEMPT_FIELDS, "Authority Process Launch Attempt")
  if (value.schema_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_LAUNCH_ATTEMPT_SCHEMA_VERSION
      || value.launch_attempt_policy_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_LAUNCH_ATTEMPT_POLICY_VERSION
      || value.scope !== "one_spawn_revalidation_bound_at_most_once_local_process_launch_slot"
      || value.owner !== "replay_runner_worker_v10_authority_process_launch_registry"
      || value.purpose !== "reserve_one_non_replayable_fresh_child_process_start_before_any_frame_write"
      || value.status !== "launch_slot_committed_process_outcome_pending"
      || value.clock_evidence !== "runner_process_clock_port_not_external_time_attestation"
      || value.freshness_relation
        !== "control_plane_revalidation_completed_at_or_before_launch_invocation_before_lease_expiry"
      || value.cancellation_race_limit
        !== "cancellation_or_fencing_may_occur_between_revalidation_and_kernel_spawn"
      || value.runtime_id !== "bun"
      || value.process_artifact_file_name
        !== REPLAY_DECISION_HARNESS_WORKER_V10_ACTIVATED_STDIO_ARTIFACT_FILE
      || value.runtime_binding_policy !== "current_runner_runtime_exactly_matches_authority_intent"
      || value.artifact_materialization_policy
        !== "fresh_private_ephemeral_file_mode_0500_and_hash_verified_before_spawn"
      || value.spawn_argv_policy !== "attested_runtime_then_ephemeral_exact_authority_artifact_only"
      || value.working_directory_policy !== "fresh_private_ephemeral_directory_path_not_persisted"
      || value.environment_policy
        !== "tz_utc_lang_c_lc_all_c_plus_exact_single_capsule_no_inherited_values"
      || value.authority_capsule_environment_variable
        !== REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_ENV
      || value.stdio_policy !== "three_pipes_open_zero_request_bytes_written_and_stdin_not_closed"
      || value.launch_slot_policy !== "one_cas_attempt_per_spawn_revalidation_no_automatic_relaunch"
      || value.orphan_attempt_policy
        !== "attempt_without_receipt_is_indeterminate_and_requires_manual_recovery"
      || value.process_launch_occurrence !== "pending" || value.process_launch_receipt !== null
      || value.process_launch_receipt_count !== 0 || value.admitted_process_instance !== null
      || value.admitted_process_instance_count !== 0 || value.request_frame_instance_count !== 0
      || value.request_write_receipt_count !== 0 || value.request_decode_receipt_count !== 0
      || value.response_frame_instance_count !== 0 || value.response_read_receipt_count !== 0
      || value.dispatch_occurrence !== "not_materialized"
      || value.transport_activation !== "launch_slot_committed_process_and_frames_pending"
      || value.harness_invocation !== "forbidden" || value.response_admission !== "not_granted"
      || value.decision_output_authority !== "none" || value.signal_authority !== "none"
      || value.order_authority !== "none" || value.economic_authority !== "none"
      || value.trial_authority !== "none") {
    throw new Error("unsupported Authority Process Launch Attempt authority")
  }
  for (const item of [value.launch_attempt_id, value.launch_attempt_ref,
    value.source_spawn_revalidation_id, value.source_authority_capsule_id,
    value.attempt_id, value.worker_id, value.runtime_version]) {
    requireText(item, "Authority Process Launch Attempt identity")
  }
  for (const item of [value.launch_attempt_key, value.launch_attempt_hash,
    value.source_spawn_revalidation_hash, value.source_authority_capsule_record_hash,
    value.authority_capsule_hash, value.source_revalidation_request_hash,
    value.control_plane_revalidation_receipt_hash, value.current_attempt_lease_hash,
    value.runtime_executable_hash, value.process_artifact_hash,
    value.authority_capsule_canonical_json_hash]) {
    requireHash(item, "Authority Process Launch Attempt hash")
  }
  for (const item of [value.revalidated_at, value.launch_invoked_at,
    value.valid_before]) requireUtc(item, "Authority Process Launch Attempt time")
  if (!Number.isSafeInteger(value.attempt_ordinal) || value.attempt_ordinal < 1
      || !Number.isSafeInteger(value.lease_generation) || value.lease_generation < 1) {
    throw new Error("Authority Process Launch Attempt fencing identity")
  }
  assertReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidation(
    value.source_spawn_revalidation,
  )
  const spawn = value.source_spawn_revalidation
  const capsule = spawn.source_authority_capsule
  const intent = capsule.source_authority_process_launch_intent
  const expectedKey = replayDecisionHarnessWorkerV10AuthorityProcessLaunchKey({
    spawn_revalidation_hash: spawn.binding_hash,
    launch_attempt_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_LAUNCH_ATTEMPT_POLICY_VERSION,
  })
  if (value.launch_attempt_key !== expectedKey
      || value.launch_attempt_id !== `decision-harness-worker-v10-authority-launch-attempt-${expectedKey.slice(0, 24)}`
      || value.launch_attempt_ref !== `attempt://replay-decision-harness-worker-v10-authority-launch/${expectedKey.slice(0, 24)}`
      || value.source_spawn_revalidation_id !== spawn.binding_id
      || value.source_spawn_revalidation_hash !== spawn.binding_hash
      || value.source_authority_capsule_id !== capsule.capsule_id
      || value.source_authority_capsule_record_hash !== capsule.record_hash
      || value.authority_capsule_hash !== capsule.capsule_hash
      || value.source_revalidation_request_hash !== spawn.source_revalidation_request_hash
      || value.control_plane_revalidation_receipt_hash !== spawn.control_plane_revalidation_receipt_hash
      || value.attempt_id !== spawn.attempt_id || value.attempt_ordinal !== spawn.attempt_ordinal
      || value.worker_id !== spawn.worker_id || value.lease_generation !== spawn.lease_generation
      || value.current_attempt_lease_hash !== spawn.current_attempt_lease_hash
      || value.revalidated_at !== spawn.revalidated_at || value.valid_before !== spawn.valid_before
      || Date.parse(value.launch_invoked_at) < Date.parse(value.revalidated_at)
      || Date.parse(value.launch_invoked_at) >= Date.parse(value.valid_before)
      || value.runtime_version !== intent.runtime_version
      || value.runtime_executable_hash !== intent.runtime_executable_hash
      || value.process_artifact_hash !== intent.process_artifact_hash
      || value.authority_capsule_canonical_json_hash !== canonicalHash(capsule.authority_capsule)) {
    throw new Error("Authority Process Launch Attempt parent, runtime, capsule, or chronology drift")
  }
  const { launch_attempt_hash: attemptHash, ...body } = value
  if (attemptHash !== canonicalHash(body)) throw new Error("Authority Process Launch Attempt hash mismatch")
}

export function assertReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceipt(
  value: ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceipt,
): void {
  assertFields(value, RECEIPT_FIELDS, "Authority Process Launch Receipt")
  const started = value.receipt_status === "started_process_frame_not_written"
  if (value.schema_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_LAUNCH_RECEIPT_SCHEMA_VERSION
      || value.receipt_policy_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_LAUNCH_RECEIPT_POLICY_VERSION
      || value.scope !== "one_attempt_bound_local_child_process_start_outcome_before_any_frame_write"
      || value.owner !== "replay_runner_worker_v10_authority_process_launch_registry"
      || value.purpose !== "record_one_at_most_once_spawn_outcome_without_worker_request_dispatch"
      || !["started_process_frame_not_written", "failed_before_start"].includes(value.receipt_status)
      || value.clock_evidence !== "runner_process_clock_port_not_external_time_attestation"
      || value.pid_namespace !== "runner_local_os_namespace_unattested"
      || value.process_identity_strength
        !== "local_child_spawn_event_pid_exact_runtime_argv_environment_and_ephemeral_cwd_hash"
      || value.pid_reuse_policy !== "pid_never_sufficient_receipt_context_spawn_time_and_hash_required"
      || value.kernel_start_evidence
        !== "runner_observed_child_spawn_event_not_kernel_timestamp_or_remote_attestation"
      || value.lease_freshness_evidence
        !== "source_control_plane_revalidation_then_runner_launch_time_not_post_spawn_authority_read"
      || value.cancellation_race_limit
        !== "receipt_cannot_prove_absence_of_cancellation_or_fencing_after_revalidation"
      || value.process_handle_durability
        !== "process_handle_is_ephemeral_and_not_recoverable_from_receipt"
      || value.process_recovery_policy
        !== "future_frame_requires_exact_new_live_handle_receipt_alone_is_insufficient"
      || value.retry_policy !== "no_automatic_relaunch_same_attempt_even_after_failure_or_orphan"
      || value.stdin_bytes_written !== 0 || value.stdin_closed !== false
      || value.stdout_bytes_read !== 0 || value.stderr_bytes_read !== 0
      || value.process_exit_observation !== "not_observed_at_receipt"
      || value.exit_status !== null || value.exit_signal !== null
      || value.blocker_set_policy !== "complete_deterministic_ordered_post_launch_pre_dispatch_blockers"
      || canonicalJson(value.blockers)
        !== canonicalJson(replayDecisionHarnessWorkerV10AuthorityProcessLaunchBlockers(value.receipt_status))
      || value.process_launch_receipt_count !== 1 || value.request_frame_instance_count !== 0
      || value.request_write_receipt_count !== 0 || value.request_decode_receipt_count !== 0
      || value.response_frame_instance_count !== 0 || value.response_read_receipt_count !== 0
      || value.dispatch_occurrence !== "not_materialized_zero_worker_request_bytes"
      || value.harness_invocation !== "forbidden" || value.response_admission !== "not_granted"
      || value.decision_output_authority !== "none" || value.signal_authority !== "none"
      || value.order_authority !== "none" || value.economic_authority !== "none"
      || value.trial_authority !== "none") {
    throw new Error("unsupported Authority Process Launch Receipt authority")
  }
  for (const item of [value.receipt_id, value.receipt_ref, value.source_launch_attempt_id,
    value.source_launch_attempt_ref, value.logical_request_id, value.attempt_id,
    value.worker_id]) requireText(item, "Authority Process Launch Receipt identity")
  for (const item of [value.receipt_key, value.receipt_hash, value.source_launch_attempt_hash,
    value.source_spawn_revalidation_hash, value.source_authority_capsule_record_hash,
    value.authority_capsule_hash, value.source_authority_process_launch_intent_hash,
    value.source_authority_execution_admission_command_hash,
    value.source_authority_transport_contract_hash, value.process_artifact_hash,
    value.source_execution_envelope_hash, value.worker_request_hash,
    value.current_attempt_lease_hash, value.runtime_executable_hash,
    value.authority_capsule_environment_value_hash]) {
    requireHash(item, "Authority Process Launch Receipt hash")
  }
  for (const item of [value.launch_invoked_at, value.spawn_observed_at,
    value.valid_before]) requireUtc(item, "Authority Process Launch Receipt time")
  if (!Number.isSafeInteger(value.attempt_ordinal) || value.attempt_ordinal < 1
      || !Number.isSafeInteger(value.lease_generation) || value.lease_generation < 1) {
    throw new Error("Authority Process Launch Receipt fencing identity")
  }
  assertReplayDecisionHarnessWorkerV10AuthorityProcessLaunchAttempt(value.source_launch_attempt)
  const attempt = value.source_launch_attempt
  const spawn = attempt.source_spawn_revalidation
  const capsule = spawn.source_authority_capsule
  const intent = capsule.source_authority_process_launch_intent
  const command = intent.source_authority_execution_admission_command
  if (value.receipt_key !== attempt.launch_attempt_key
      || value.source_launch_attempt_id !== attempt.launch_attempt_id
      || value.source_launch_attempt_ref !== attempt.launch_attempt_ref
      || value.source_launch_attempt_hash !== attempt.launch_attempt_hash
      || value.source_spawn_revalidation_hash !== spawn.binding_hash
      || value.source_authority_capsule_record_hash !== capsule.record_hash
      || value.authority_capsule_hash !== capsule.capsule_hash
      || value.source_authority_process_launch_intent_hash !== intent.intent_hash
      || value.source_authority_execution_admission_command_hash !== command.command_hash
      || value.source_authority_transport_contract_hash !== intent.source_authority_transport_contract_hash
      || value.process_artifact_hash !== intent.process_artifact_hash
      || value.source_execution_envelope_hash !== intent.source_execution_envelope_hash
      || value.logical_request_id !== intent.logical_request_id
      || value.worker_request_hash !== intent.worker_request_hash
      || value.attempt_id !== attempt.attempt_id || value.attempt_ordinal !== attempt.attempt_ordinal
      || value.worker_id !== attempt.worker_id || value.lease_generation !== attempt.lease_generation
      || value.current_attempt_lease_hash !== attempt.current_attempt_lease_hash
      || value.launch_invoked_at !== attempt.launch_invoked_at || value.valid_before !== attempt.valid_before
      || Date.parse(value.spawn_observed_at) < Date.parse(value.launch_invoked_at)
      || value.runtime_executable_hash !== attempt.runtime_executable_hash
      || value.authority_capsule_environment_value_hash !== capsule.capsule_hash) {
    throw new Error("Authority Process Launch Receipt parent or runtime lineage drift")
  }
  if (started) {
    for (const item of [value.process_instance_id, value.artifact_materialization_hash,
      value.spawn_argv_hash, value.working_directory_instance_hash,
      value.environment_hash]) requireHash(item ?? "", "started Authority Process Launch evidence")
    if (!Number.isSafeInteger(value.observed_child_pid) || (value.observed_child_pid ?? 0) < 1
        || value.process_error_code !== null || value.process_error_hash !== null
        || value.process_launch_occurrence !== "runner_observed_child_started"
        || value.process_liveness_at_receipt !== "live_child_handle_observed"
        || value.admitted_process_instance !== value.process_instance_id
        || value.admitted_process_instance_count !== 1
        || value.transport_activation !== "process_started_frame_blocked") {
      throw new Error("started Authority Process Launch evidence is invalid")
    }
    const expectedProcessId = canonicalHash({
      launch_attempt_hash: attempt.launch_attempt_hash,
      observed_child_pid: value.observed_child_pid,
      spawn_observed_at: value.spawn_observed_at,
      runtime_executable_hash: value.runtime_executable_hash,
      artifact_materialization_hash: value.artifact_materialization_hash,
      spawn_argv_hash: value.spawn_argv_hash,
      working_directory_instance_hash: value.working_directory_instance_hash,
      environment_hash: value.environment_hash,
      authority_capsule_environment_value_hash: value.authority_capsule_environment_value_hash,
    })
    const expectedArgvHash = canonicalHash({
      runtime_executable_hash: attempt.runtime_executable_hash,
      artifact_file_name: attempt.process_artifact_file_name,
    })
    const expectedEnvironmentHash = canonicalHash({
      TZ: "UTC",
      LANG: "C",
      LC_ALL: "C",
      [REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_ENV]:
        capsule.authority_capsule_canonical_json,
    })
    if (value.process_instance_id !== expectedProcessId
        || value.artifact_materialization_hash !== value.process_artifact_hash
        || value.spawn_argv_hash !== expectedArgvHash
        || value.environment_hash !== expectedEnvironmentHash) {
      throw new Error("Authority Process Launch process identity mismatch")
    }
  } else {
    if (value.observed_child_pid !== null || value.process_instance_id !== null
        || value.process_error_code === null || value.process_error_hash === null
        || value.artifact_materialization_hash !== null || value.spawn_argv_hash !== null
        || value.working_directory_instance_hash !== null || value.environment_hash !== null
        || value.process_launch_occurrence !== "not_observed_failed_before_start"
        || value.process_liveness_at_receipt !== "no_child_handle"
        || value.admitted_process_instance !== null || value.admitted_process_instance_count !== 0
        || value.transport_activation !== "process_not_started") {
      throw new Error("failed Authority Process Launch evidence is invalid")
    }
    requireHash(value.process_error_hash, "Authority Process Launch error hash")
  }
  const outcomeHash = canonicalHash({
    receipt_status: value.receipt_status,
    spawn_observed_at: value.spawn_observed_at,
    observed_child_pid: value.observed_child_pid,
    process_instance_id: value.process_instance_id,
    process_error_code: value.process_error_code,
    process_error_hash: value.process_error_hash,
    artifact_materialization_hash: value.artifact_materialization_hash,
    spawn_argv_hash: value.spawn_argv_hash,
    working_directory_instance_hash: value.working_directory_instance_hash,
    environment_hash: value.environment_hash,
  })
  if (value.receipt_id !== `decision-harness-worker-v10-authority-launch-receipt-${outcomeHash.slice(0, 24)}`
      || value.receipt_ref !== `receipt://replay-decision-harness-worker-v10-authority-launch/${outcomeHash.slice(0, 24)}`) {
    throw new Error("Authority Process Launch Receipt identity mismatch")
  }
  const { receipt_hash: receiptHash, ...body } = value
  if (receiptHash !== canonicalHash(body)) throw new Error("Authority Process Launch Receipt hash mismatch")
}

const ATTEMPT_FIELDS = ["admitted_process_instance", "admitted_process_instance_count", "artifact_materialization_policy",
  "attempt_id", "attempt_ordinal", "authority_capsule_canonical_json_hash", "authority_capsule_environment_variable",
  "authority_capsule_hash", "cancellation_race_limit", "clock_evidence", "control_plane_revalidation_receipt_hash",
  "current_attempt_lease_hash", "decision_output_authority", "dispatch_occurrence", "economic_authority",
  "environment_policy", "freshness_relation", "harness_invocation", "launch_attempt_hash", "launch_attempt_id",
  "launch_attempt_key", "launch_attempt_policy_version", "launch_attempt_ref", "launch_invoked_at",
  "launch_slot_policy", "lease_generation", "order_authority", "orphan_attempt_policy", "owner",
  "process_artifact_file_name", "process_artifact_hash", "process_launch_occurrence", "process_launch_receipt",
  "process_launch_receipt_count", "purpose", "request_decode_receipt_count", "request_frame_instance_count",
  "request_write_receipt_count", "response_admission", "response_frame_instance_count", "response_read_receipt_count",
  "revalidated_at", "runtime_binding_policy", "runtime_executable_hash", "runtime_id", "runtime_version",
  "schema_version", "scope", "signal_authority", "source_authority_capsule_id",
  "source_authority_capsule_record_hash", "source_revalidation_request_hash", "source_spawn_revalidation",
  "source_spawn_revalidation_hash", "source_spawn_revalidation_id", "spawn_argv_policy", "status", "stdio_policy",
  "transport_activation", "trial_authority", "valid_before", "worker_id", "working_directory_policy"].sort()

const RECEIPT_FIELDS = ["admitted_process_instance", "admitted_process_instance_count",
  "artifact_materialization_hash", "attempt_id", "attempt_ordinal", "authority_capsule_environment_value_hash",
  "authority_capsule_hash", "blocker_set_policy", "blockers", "cancellation_race_limit", "clock_evidence",
  "current_attempt_lease_hash", "decision_output_authority", "dispatch_occurrence", "economic_authority",
  "environment_hash", "exit_signal", "exit_status", "harness_invocation", "kernel_start_evidence",
  "launch_invoked_at", "lease_freshness_evidence", "lease_generation", "logical_request_id", "observed_child_pid",
  "order_authority", "owner", "pid_namespace", "pid_reuse_policy", "process_artifact_hash", "process_error_code",
  "process_error_hash", "process_exit_observation", "process_handle_durability", "process_identity_strength",
  "process_instance_id", "process_launch_occurrence", "process_launch_receipt_count", "process_liveness_at_receipt",
  "process_recovery_policy", "purpose", "receipt_hash", "receipt_id", "receipt_key", "receipt_policy_version",
  "receipt_ref", "receipt_status", "request_decode_receipt_count", "request_frame_instance_count",
  "request_write_receipt_count", "response_admission", "response_frame_instance_count", "response_read_receipt_count",
  "retry_policy", "runtime_executable_hash", "schema_version", "scope", "signal_authority", "source_authority_capsule_record_hash",
  "source_authority_execution_admission_command_hash", "source_authority_process_launch_intent_hash",
  "source_authority_transport_contract_hash", "source_execution_envelope_hash", "source_launch_attempt",
  "source_launch_attempt_hash", "source_launch_attempt_id", "source_launch_attempt_ref",
  "source_spawn_revalidation_hash", "spawn_argv_hash", "spawn_observed_at", "stderr_bytes_read", "stdin_bytes_written",
  "stdin_closed", "stdout_bytes_read", "transport_activation", "trial_authority", "valid_before", "worker_id",
  "worker_request_hash", "working_directory_instance_hash"].sort()

function assertFields(value: object, expected: string[], label: string): void {
  if (canonicalHash(Object.keys(value).sort()) !== canonicalHash(expected)) {
    throw new Error(`${label} field whitelist drift`)
  }
}
