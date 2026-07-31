import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import {
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand,
  type ReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-command"
import {
  assertReplayDispatchClockAttestationView,
  type ReplayDispatchClockAttestationView,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-clock-attestation"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_PROCESS_LAUNCH_INTENT_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_PROCESS_LAUNCH_INTENT_SCHEMA_VERSION,
  assertReplayDecisionHarnessWorkerV10ProcessLaunchIntent,
  createReplayDecisionHarnessWorkerV10ProcessLaunchIntent,
  replayDecisionHarnessWorkerV10ProcessLaunchIntentBlockers,
  replayDecisionHarnessWorkerV10ProcessLaunchIntentKey,
  type ReplayDecisionHarnessWorkerV10ProcessLaunchIntent,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-process-launch-intent"

export interface BuildReplayDecisionHarnessWorkerV10ProcessLaunchIntentInput {
  source_execution_admission_command: ReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand
  post_command_clock_attestation: ReplayDispatchClockAttestationView
}

export function buildReplayDecisionHarnessWorkerV10ProcessLaunchIntent(
  input: BuildReplayDecisionHarnessWorkerV10ProcessLaunchIntentInput,
): ReplayDecisionHarnessWorkerV10ProcessLaunchIntent {
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand(input.source_execution_admission_command)
  assertReplayDispatchClockAttestationView(input.post_command_clock_attestation)
  const command = input.source_execution_admission_command
  const clock = input.post_command_clock_attestation
  const receipt = clock.source_registry_read_receipt
  const observation = receipt.source_observation
  const successor = command.source_clock_binding.source_registry_provenance.source_pre_issue_bundle
    .source_execution_admission_contract.source_successor_transport_contract
  const stdio = successor.source_negative_probe_receipt.source_stdio_capability
  const key = replayDecisionHarnessWorkerV10ProcessLaunchIntentKey({
    execution_admission_command_hash: command.command_hash,
    worker_request_hash: command.worker_request_hash,
    attempt_id: command.attempt_id,
    worker_id: command.worker_id,
    lease_generation: command.lease_generation,
    intent_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_PROCESS_LAUNCH_INTENT_POLICY_VERSION,
  })
  return createReplayDecisionHarnessWorkerV10ProcessLaunchIntent({
    schema_version: REPLAY_DECISION_HARNESS_WORKER_V10_PROCESS_LAUNCH_INTENT_SCHEMA_VERSION,
    intent_id: `decision-harness-worker-v10-process-launch-intent-${key.slice(0, 24)}`,
    intent_ref: `intent://replay-decision-harness-worker-v10/${key.slice(0, 24)}`,
    intent_key: key,
    intent_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_PROCESS_LAUNCH_INTENT_POLICY_VERSION,
    scope: "one_command_bound_successor_stdio_process_launch_intent",
    owner: "replay_runner_worker_v10_process_launch_intent_registry",
    status: "intent_committed_process_not_started",
    source_execution_admission_command_id: command.command_id,
    source_execution_admission_command_hash: command.command_hash,
    source_execution_admission_command: structuredClone(command),
    post_command_clock_attestation_id: clock.attestation_id,
    post_command_clock_attestation_ref: clock.attestation_ref,
    post_command_clock_attestation_hash: clock.attestation_hash,
    post_command_clock_attestation: structuredClone(clock),
    worker_request_hash: command.worker_request_hash,
    logical_request_id: command.logical_request_id,
    attempt_id: command.attempt_id,
    attempt_ordinal: command.attempt_ordinal,
    worker_id: command.worker_id,
    lease_generation: command.lease_generation,
    current_attempt_status: receipt.current_attempt_status,
    current_attempt_lease_hash: receipt.current_attempt_lease_hash,
    post_command_lease_observation_hash: observation.observation_hash,
    post_command_registry_read_receipt_hash: receipt.receipt_hash,
    intent_issued_at: clock.registry_read_completed_at,
    valid_before: command.valid_before,
    intent_time_semantics: "control_plane_post_command_clock_attestation_completion_not_local_commit_time",
    natural_key_policy: "one_process_launch_intent_per_execution_admission_command",
    post_command_revalidation: "exact_current_active_attempt_same_worker_generation_and_lease_hash",
    cancellation_revalidation: "control_plane_current_attempt_remains_claimed_or_running_at_revalidation",
    fencing_revalidation: "exact_command_attempt_worker_generation_and_lease_hash_remain_current",
    revalidation_race_limit: "intent_is_non_executable_and_spawn_boundary_must_revalidate_again",
    source_stdio_capability_hash: stdio.capability_hash,
    runtime_id: "bun",
    runtime_version: stdio.runtime.runtime_version,
    runtime_executable_hash: stdio.runtime.executable_sha256,
    process_artifact_hash: stdio.artifact.sha256,
    process_artifact_file_name: "worker-v10-stdio.mjs",
    process_model: "fresh_single_request_process_no_pool_keepalive_or_multiplex",
    artifact_materialization_policy: "ephemeral_private_file_mode_0500_hash_verified_before_spawn",
    spawn_argv_policy: "attested_runtime_then_ephemeral_exact_successor_artifact_only",
    environment_policy: "tz_utc_lang_c_lc_all_c_exact",
    working_directory_policy: "fresh_private_ephemeral_directory",
    timeout_ms: successor.timeout_ms,
    max_request_frame_bytes: successor.max_request_frame_bytes,
    max_response_frame_bytes: successor.max_response_frame_bytes,
    launch_slot_policy: "one_immutable_intent_per_command_no_automatic_replacement",
    orphan_intent_policy: "intent_without_receipt_never_proves_process_start_outcome",
    process_launch_authority: "not_granted_until_fresh_spawn_boundary_revalidation",
    required_response_echo_fields: ["execution_admission_command_hash", "worker_request_hash"],
    process_launch_intent_instance_count: 1,
    blocker_set_policy: "complete_deterministic_ordered_post_intent_pre_process_blockers",
    blockers: replayDecisionHarnessWorkerV10ProcessLaunchIntentBlockers(),
    attempt_bound_process_receipt: null,
    attempt_bound_process_receipt_count: 0,
    admitted_process_instance: null,
    admitted_process_instance_count: 0,
    process_launch_occurrence: "not_materialized",
    request_frame_instance_count: 0,
    request_write_receipt_count: 0,
    request_decode_receipt_count: 0,
    response_frame_instance_count: 0,
    response_read_receipt_count: 0,
    dispatch_occurrence: "not_materialized",
    transport_activation: "blocked",
    harness_invocation: "forbidden",
    response_admission: "not_granted",
    decision_output_authority: "none",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
    trial_authority: "none",
  })
}

export function assertReplayDecisionHarnessWorkerV10ProcessLaunchIntentLineage(
  value: ReplayDecisionHarnessWorkerV10ProcessLaunchIntent,
  input: BuildReplayDecisionHarnessWorkerV10ProcessLaunchIntentInput,
): void {
  assertReplayDecisionHarnessWorkerV10ProcessLaunchIntent(value)
  if (canonicalHash(value) !== canonicalHash(buildReplayDecisionHarnessWorkerV10ProcessLaunchIntent(input))) {
    throw new Error("Worker v10 Process Launch Intent lineage drift")
  }
}
