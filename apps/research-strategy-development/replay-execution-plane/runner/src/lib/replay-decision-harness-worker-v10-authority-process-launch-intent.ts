import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_ACTIVATED_STDIO_ARTIFACT_FILE,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_ENV,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_FIELDS,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-activated-stdio-capability"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_COMMAND_RESPONSE_ECHO_FIELDS,
  assertReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand,
  type ReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-execution-admission-command"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_FRAME_SCHEMA_VERSION,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-frame-build-contract"
import {
  assertReplayDispatchClockAttestationView,
  type ReplayDispatchClockAttestationView,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-clock-attestation"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_LAUNCH_INTENT_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_LAUNCH_INTENT_SCHEMA_VERSION,
  assertReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent,
  createReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent,
  replayDecisionHarnessWorkerV10AuthorityProcessLaunchIntentBlockers,
  replayDecisionHarnessWorkerV10AuthorityProcessLaunchIntentKey,
  type ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-process-launch-intent"

export interface BuildReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntentInput {
  source_authority_execution_admission_command: ReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand
  post_command_clock_attestation: ReplayDispatchClockAttestationView
}

export function buildReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent(
  input: BuildReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntentInput,
): ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent {
  assertReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand(
    input.source_authority_execution_admission_command,
  )
  assertReplayDispatchClockAttestationView(input.post_command_clock_attestation)
  const command = input.source_authority_execution_admission_command
  const transport = command.source_authority_transport_contract
  const capability = transport.source_activated_stdio_capability
  const clock = input.post_command_clock_attestation
  const receipt = clock.source_registry_read_receipt
  const observation = receipt.source_observation
  const key = replayDecisionHarnessWorkerV10AuthorityProcessLaunchIntentKey({
    authority_execution_admission_command_hash: command.command_hash,
    worker_request_hash: command.worker_request_hash,
    attempt_id: command.attempt_id,
    worker_id: command.worker_id,
    lease_generation: command.lease_generation,
    intent_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_LAUNCH_INTENT_POLICY_VERSION,
  })
  return createReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent({
    schema_version: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_LAUNCH_INTENT_SCHEMA_VERSION,
    intent_id: `decision-harness-worker-v10-authority-intent-${key.slice(0, 24)}`,
    intent_ref: `intent://replay-decision-harness-worker-v10-authority/${key.slice(0, 24)}`,
    intent_key: key,
    intent_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_LAUNCH_INTENT_POLICY_VERSION,
    scope: "one_authority_command_bound_fresh_process_launch_intent",
    owner: "replay_runner_worker_v10_authority_process_launch_intent_registry",
    purpose: "freeze_authority_artifact_runtime_capsule_derivation_and_post_command_lease_evidence",
    status: "intent_committed_capsule_and_process_not_materialized",
    source_authority_execution_admission_command_id: command.command_id,
    source_authority_execution_admission_command_hash: command.command_hash,
    source_authority_execution_admission_command: structuredClone(command),
    source_authority_transport_contract_hash: transport.contract_hash,
    post_command_clock_attestation_id: clock.attestation_id,
    post_command_clock_attestation_ref: clock.attestation_ref,
    post_command_clock_attestation_hash: clock.attestation_hash,
    post_command_clock_attestation: structuredClone(clock),
    source_execution_envelope_hash: command.source_execution_envelope_hash,
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
    intent_time_semantics: "fresh_post_command_control_plane_clock_completion_not_local_commit_time",
    natural_key_policy: "one_authority_process_launch_intent_per_authority_command",
    post_command_revalidation: "entire_current_attempt_read_starts_after_authority_command_issuance",
    cancellation_revalidation: "control_plane_current_attempt_remains_claimed_or_running_at_revalidation",
    fencing_revalidation: "exact_command_attempt_worker_generation_and_lease_hash_remain_current",
    revalidation_race_limit: "intent_is_non_executable_and_spawn_boundary_must_revalidate_again",
    runtime_id: "bun",
    runtime_version: capability.runtime.runtime_version,
    runtime_executable_hash: capability.runtime.executable_sha256,
    process_artifact_hash: capability.artifact.sha256,
    process_artifact_file_name: REPLAY_DECISION_HARNESS_WORKER_V10_ACTIVATED_STDIO_ARTIFACT_FILE,
    process_model: "fresh_single_request_process_no_pool_keepalive_or_multiplex",
    artifact_materialization_policy: "ephemeral_private_file_mode_0500_hash_verified_before_spawn",
    spawn_argv_policy: "attested_runtime_then_ephemeral_exact_authority_artifact_only",
    base_environment_policy: "tz_utc_lang_c_lc_all_c_no_inherited_values",
    authority_capsule_environment_variable: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_ENV,
    authority_capsule_fields: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_FIELDS,
    authority_capsule_encoding: "canonical_json_utf8_environment_value",
    authority_capsule_static_bindings:
      "transport_artifact_envelope_logical_request_and_worker_request_from_source_command",
    authority_capsule_command_binding: "exact_committed_authority_command_hash",
    authority_capsule_intent_binding: "intent_hash_added_after_exact_intent_commit_not_embedded_in_payload",
    authority_capsule_derivation:
      "launcher_builds_canonical_object_from_exact_committed_transport_command_intent_and_request_lineage",
    authority_capsule_hash_time: "after_exact_intent_commit_before_spawn_boundary_revalidation",
    authority_capsule_reuse_policy: "forbidden_across_command_intent_attempt_or_lease_generation",
    working_directory_policy: "fresh_private_ephemeral_directory",
    timeout_ms: transport.timeout_ms,
    max_request_frame_bytes: transport.max_request_frame_bytes,
    max_response_frame_bytes: transport.max_response_frame_bytes,
    request_frame_schema_version: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_SCHEMA_VERSION,
    response_frame_schema_version: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_FRAME_SCHEMA_VERSION,
    launch_slot_policy: "one_immutable_intent_per_authority_command_no_automatic_replacement",
    orphan_intent_policy: "intent_without_capsule_revalidation_and_receipt_never_proves_process_start",
    process_launch_authority: "not_granted_until_capsule_and_fresh_spawn_boundary_revalidation",
    required_response_echo_fields: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_COMMAND_RESPONSE_ECHO_FIELDS,
    authority_transport_contract_instance_count: 1,
    authority_execution_admission_command_instance_count: 1,
    authority_process_launch_intent_instance_count: 1,
    blocker_set_policy: "complete_deterministic_ordered_post_authority_intent_pre_dispatch_blockers",
    blockers: replayDecisionHarnessWorkerV10AuthorityProcessLaunchIntentBlockers(),
    authority_capsule_instance: null,
    authority_capsule_instance_count: 0,
    spawn_boundary_revalidation_receipt: null,
    process_launch_receipt: null,
    process_launch_receipt_count: 0,
    admitted_process_instance: null,
    admitted_process_instance_count: 0,
    process_launch_occurrence: "not_materialized",
    request_frame_instance_count: 0,
    request_write_receipt_count: 0,
    request_decode_receipt_count: 0,
    response_frame_instance_count: 0,
    response_read_receipt_count: 0,
    dispatch_occurrence: "not_materialized",
    transport_activation: "intent_issued_capsule_and_spawn_blocked",
    harness_invocation: "forbidden",
    response_admission: "not_granted",
    decision_output_authority: "none",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
    trial_authority: "none",
  })
}

export function assertReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntentLineage(
  value: ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent,
  input: BuildReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntentInput,
): void {
  assertReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent(value)
  const expected = buildReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent(input)
  if (canonicalHash(value) !== canonicalHash(expected)) {
    throw new Error("decision harness Worker v10 Authority Process Launch Intent lineage drift")
  }
}
