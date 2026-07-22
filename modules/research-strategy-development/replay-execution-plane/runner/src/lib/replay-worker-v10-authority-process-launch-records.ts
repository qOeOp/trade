import {
  REPLAY_DECISION_HARNESS_WORKER_V10_ACTIVATED_STDIO_ARTIFACT_FILE,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_ENV,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-activated-stdio-capability"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_LAUNCH_ATTEMPT_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_LAUNCH_ATTEMPT_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_LAUNCH_RECEIPT_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_LAUNCH_RECEIPT_SCHEMA_VERSION,
  createReplayDecisionHarnessWorkerV10AuthorityProcessLaunchAttempt,
  createReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceipt,
  replayDecisionHarnessWorkerV10AuthorityProcessLaunchBlockers,
  type ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchAttempt,
  type ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceipt,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-process-launch"
import type { ReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidation } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-spawn-boundary-revalidation"
import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import type { ReplayWorkerV10StartedAuthorityProcess } from "./replay-worker-v10-authority-process-runtime"
import { sha256ReplayWorkerV10AuthorityValue } from "./replay-worker-v10-authority-process-runtime"

export function buildReplayWorkerV10AuthorityProcessLaunchAttempt(input: {
  key: string
  spawn_binding: ReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidation
  launch_invoked_at: string
}): ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchAttempt {
  const binding = input.spawn_binding
  const capsule = binding.source_authority_capsule
  const intent = capsule.source_authority_process_launch_intent
  return createReplayDecisionHarnessWorkerV10AuthorityProcessLaunchAttempt({
    schema_version: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_LAUNCH_ATTEMPT_SCHEMA_VERSION,
    launch_attempt_id: `decision-harness-worker-v10-authority-launch-attempt-${input.key.slice(0, 24)}`,
    launch_attempt_ref: `attempt://replay-decision-harness-worker-v10-authority-launch/${input.key.slice(0, 24)}`,
    launch_attempt_key: input.key,
    launch_attempt_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_LAUNCH_ATTEMPT_POLICY_VERSION,
    scope: "one_spawn_revalidation_bound_at_most_once_local_process_launch_slot",
    owner: "replay_runner_worker_v10_authority_process_launch_registry",
    purpose: "reserve_one_non_replayable_fresh_child_process_start_before_any_frame_write",
    status: "launch_slot_committed_process_outcome_pending",
    source_spawn_revalidation_id: binding.binding_id,
    source_spawn_revalidation_hash: binding.binding_hash,
    source_spawn_revalidation: structuredClone(binding),
    source_authority_capsule_id: capsule.capsule_id,
    source_authority_capsule_record_hash: capsule.record_hash,
    authority_capsule_hash: capsule.capsule_hash,
    source_revalidation_request_hash: binding.source_revalidation_request_hash,
    control_plane_revalidation_receipt_hash: binding.control_plane_revalidation_receipt_hash,
    attempt_id: binding.attempt_id,
    attempt_ordinal: binding.attempt_ordinal,
    worker_id: binding.worker_id,
    lease_generation: binding.lease_generation,
    current_attempt_lease_hash: binding.current_attempt_lease_hash,
    revalidated_at: binding.revalidated_at,
    launch_invoked_at: input.launch_invoked_at,
    valid_before: binding.valid_before,
    clock_evidence: "runner_process_clock_port_not_external_time_attestation",
    freshness_relation:
      "control_plane_revalidation_completed_at_or_before_launch_invocation_before_lease_expiry",
    cancellation_race_limit: "cancellation_or_fencing_may_occur_between_revalidation_and_kernel_spawn",
    runtime_id: "bun",
    runtime_version: intent.runtime_version,
    runtime_executable_hash: intent.runtime_executable_hash,
    process_artifact_hash: intent.process_artifact_hash,
    process_artifact_file_name: REPLAY_DECISION_HARNESS_WORKER_V10_ACTIVATED_STDIO_ARTIFACT_FILE,
    runtime_binding_policy: "current_runner_runtime_exactly_matches_authority_intent",
    artifact_materialization_policy:
      "fresh_private_ephemeral_file_mode_0500_and_hash_verified_before_spawn",
    spawn_argv_policy: "attested_runtime_then_ephemeral_exact_authority_artifact_only",
    working_directory_policy: "fresh_private_ephemeral_directory_path_not_persisted",
    environment_policy: "tz_utc_lang_c_lc_all_c_plus_exact_single_capsule_no_inherited_values",
    authority_capsule_environment_variable: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_ENV,
    authority_capsule_canonical_json_hash: canonicalHash(capsule.authority_capsule),
    stdio_policy: "three_pipes_open_zero_request_bytes_written_and_stdin_not_closed",
    launch_slot_policy: "one_cas_attempt_per_spawn_revalidation_no_automatic_relaunch",
    orphan_attempt_policy: "attempt_without_receipt_is_indeterminate_and_requires_manual_recovery",
    process_launch_occurrence: "pending",
    process_launch_receipt: null,
    process_launch_receipt_count: 0,
    admitted_process_instance: null,
    admitted_process_instance_count: 0,
    request_frame_instance_count: 0,
    request_write_receipt_count: 0,
    request_decode_receipt_count: 0,
    response_frame_instance_count: 0,
    response_read_receipt_count: 0,
    dispatch_occurrence: "not_materialized",
    transport_activation: "launch_slot_committed_process_and_frames_pending",
    harness_invocation: "forbidden",
    response_admission: "not_granted",
    decision_output_authority: "none",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
    trial_authority: "none",
  })
}

export function buildReplayWorkerV10AuthorityProcessLaunchReceipt(input: {
  key: string
  attempt: ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchAttempt
  started: ReplayWorkerV10StartedAuthorityProcess | null
  process_error_code: "spawn_error" | "runner_pre_start_failure" | null
  process_error_hash: string | null
  spawn_observed_at: string
}): {
  receipt: ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceipt
  started_process: boolean
  process_instance_id: string | null
  observed_child_pid: number | null
} {
  const attempt = input.attempt
  const capsule = attempt.source_spawn_revalidation.source_authority_capsule
  const intent = capsule.source_authority_process_launch_intent
  const observedPid = input.started?.child.pid ?? null
  const startedProcess = input.started !== null && Number.isSafeInteger(observedPid)
    && (observedPid ?? 0) > 0
  const processId = startedProcess ? canonicalHash({
    launch_attempt_hash: attempt.launch_attempt_hash,
    observed_child_pid: observedPid,
    spawn_observed_at: input.spawn_observed_at,
    runtime_executable_hash: attempt.runtime_executable_hash,
    artifact_materialization_hash: input.started!.artifact_materialization_hash,
    spawn_argv_hash: input.started!.spawn_argv_hash,
    working_directory_instance_hash: input.started!.working_directory_instance_hash,
    environment_hash: input.started!.environment_hash,
    authority_capsule_environment_value_hash: capsule.capsule_hash,
  }) : null
  const status = startedProcess ? "started_process_frame_not_written" : "failed_before_start"
  const outcomeHash = canonicalHash({
    receipt_status: status,
    spawn_observed_at: input.spawn_observed_at,
    observed_child_pid: observedPid,
    process_instance_id: processId,
    process_error_code: input.process_error_code,
    process_error_hash: input.process_error_hash,
    artifact_materialization_hash: input.started?.artifact_materialization_hash ?? null,
    spawn_argv_hash: input.started?.spawn_argv_hash ?? null,
    working_directory_instance_hash: input.started?.working_directory_instance_hash ?? null,
    environment_hash: input.started?.environment_hash ?? null,
  })
  const receipt = createReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceipt({
    schema_version: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_LAUNCH_RECEIPT_SCHEMA_VERSION,
    receipt_id: `decision-harness-worker-v10-authority-launch-receipt-${outcomeHash.slice(0, 24)}`,
    receipt_ref: `receipt://replay-decision-harness-worker-v10-authority-launch/${outcomeHash.slice(0, 24)}`,
    receipt_key: input.key,
    receipt_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_LAUNCH_RECEIPT_POLICY_VERSION,
    scope: "one_attempt_bound_local_child_process_start_outcome_before_any_frame_write",
    owner: "replay_runner_worker_v10_authority_process_launch_registry",
    purpose: "record_one_at_most_once_spawn_outcome_without_worker_request_dispatch",
    receipt_status: status,
    source_launch_attempt_id: attempt.launch_attempt_id,
    source_launch_attempt_ref: attempt.launch_attempt_ref,
    source_launch_attempt_hash: attempt.launch_attempt_hash,
    source_launch_attempt: structuredClone(attempt),
    source_spawn_revalidation_hash: attempt.source_spawn_revalidation_hash,
    source_authority_capsule_record_hash: capsule.record_hash,
    authority_capsule_hash: capsule.capsule_hash,
    source_authority_process_launch_intent_hash: intent.intent_hash,
    source_authority_execution_admission_command_hash:
      capsule.source_authority_execution_admission_command_hash,
    source_authority_transport_contract_hash: capsule.source_authority_transport_contract_hash,
    process_artifact_hash: capsule.process_artifact_hash,
    source_execution_envelope_hash: capsule.source_execution_envelope_hash,
    logical_request_id: capsule.logical_request_id,
    worker_request_hash: capsule.worker_request_hash,
    attempt_id: attempt.attempt_id,
    attempt_ordinal: attempt.attempt_ordinal,
    worker_id: attempt.worker_id,
    lease_generation: attempt.lease_generation,
    current_attempt_lease_hash: attempt.current_attempt_lease_hash,
    launch_invoked_at: attempt.launch_invoked_at,
    spawn_observed_at: input.spawn_observed_at,
    valid_before: attempt.valid_before,
    clock_evidence: "runner_process_clock_port_not_external_time_attestation",
    observed_child_pid: startedProcess ? observedPid : null,
    process_instance_id: processId,
    process_error_code: startedProcess ? null
      : input.process_error_code ?? "runner_pre_start_failure",
    process_error_hash: startedProcess ? null
      : input.process_error_hash ?? sha256ReplayWorkerV10AuthorityValue("unknown pre-start failure"),
    pid_namespace: "runner_local_os_namespace_unattested",
    process_identity_strength:
      "local_child_spawn_event_pid_exact_runtime_argv_environment_and_ephemeral_cwd_hash",
    pid_reuse_policy: "pid_never_sufficient_receipt_context_spawn_time_and_hash_required",
    kernel_start_evidence:
      "runner_observed_child_spawn_event_not_kernel_timestamp_or_remote_attestation",
    lease_freshness_evidence:
      "source_control_plane_revalidation_then_runner_launch_time_not_post_spawn_authority_read",
    cancellation_race_limit:
      "receipt_cannot_prove_absence_of_cancellation_or_fencing_after_revalidation",
    runtime_executable_hash: attempt.runtime_executable_hash,
    artifact_materialization_hash: startedProcess
      ? input.started?.artifact_materialization_hash ?? null : null,
    spawn_argv_hash: startedProcess ? input.started?.spawn_argv_hash ?? null : null,
    working_directory_instance_hash: startedProcess
      ? input.started?.working_directory_instance_hash ?? null : null,
    environment_hash: startedProcess ? input.started?.environment_hash ?? null : null,
    authority_capsule_environment_value_hash: capsule.capsule_hash,
    process_launch_occurrence: startedProcess
      ? "runner_observed_child_started" : "not_observed_failed_before_start",
    process_liveness_at_receipt: startedProcess ? "live_child_handle_observed" : "no_child_handle",
    process_handle_durability: "process_handle_is_ephemeral_and_not_recoverable_from_receipt",
    process_recovery_policy:
      "future_frame_requires_exact_new_live_handle_receipt_alone_is_insufficient",
    retry_policy: "no_automatic_relaunch_same_attempt_even_after_failure_or_orphan",
    stdin_bytes_written: 0,
    stdin_closed: false,
    stdout_bytes_read: 0,
    stderr_bytes_read: 0,
    process_exit_observation: "not_observed_at_receipt",
    exit_status: null,
    exit_signal: null,
    blocker_set_policy: "complete_deterministic_ordered_post_launch_pre_dispatch_blockers",
    blockers: replayDecisionHarnessWorkerV10AuthorityProcessLaunchBlockers(status),
    process_launch_receipt_count: 1,
    admitted_process_instance: processId,
    admitted_process_instance_count: startedProcess ? 1 : 0,
    request_frame_instance_count: 0,
    request_write_receipt_count: 0,
    request_decode_receipt_count: 0,
    response_frame_instance_count: 0,
    response_read_receipt_count: 0,
    dispatch_occurrence: "not_materialized_zero_worker_request_bytes",
    transport_activation: startedProcess ? "process_started_frame_blocked" : "process_not_started",
    harness_invocation: "forbidden",
    response_admission: "not_granted",
    decision_output_authority: "none",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
    trial_authority: "none",
  })
  return {
    receipt,
    started_process: startedProcess,
    process_instance_id: processId,
    observed_child_pid: observedPid,
  }
}
