import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import {
  type ReplayDispatchClockAttestationView,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-clock-attestation"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_FRAME_SCHEMA_VERSION,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-frame-build-contract"
import {
  type ReplayDecisionHarnessWorkerV10AuthorityTransportContract,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-transport-contract"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_COMMAND_RESPONSE_ECHO_FIELDS,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_EXECUTION_ADMISSION_COMMAND_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_EXECUTION_ADMISSION_COMMAND_SCHEMA_VERSION,
  assertReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand,
  createReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand,
  replayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommandBlockers,
  replayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommandKey,
  type ReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-execution-admission-command"

export interface BuildReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommandInput {
  source_authority_transport_contract: ReplayDecisionHarnessWorkerV10AuthorityTransportContract
  control_plane_clock_attestation: ReplayDispatchClockAttestationView
}

export function buildReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand(
  input: BuildReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommandInput,
): ReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand {
  const transport = input.source_authority_transport_contract
  const clock = input.control_plane_clock_attestation
  const receipt = clock.source_registry_read_receipt
  const lease = receipt.current_attempt_lease
  const frameBuild = transport.source_activated_stdio_capability.source_authority_frame_build_contract
  const oldIntent = frameBuild.source_launch_readiness_gate.source_process_launch_intent
  const oldCommand = oldIntent.source_execution_admission_command
  const key = replayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommandKey({
    transport_contract_hash: transport.contract_hash,
    worker_request_hash: transport.target_worker_request_hash,
    logical_request_id: transport.target_logical_request_id,
    attempt_id: oldCommand.attempt_id,
    attempt_ordinal: oldCommand.attempt_ordinal,
    worker_id: oldCommand.worker_id,
    lease_generation: oldCommand.lease_generation,
    command_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_EXECUTION_ADMISSION_COMMAND_POLICY_VERSION,
  })
  return createReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand({
    schema_version: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_EXECUTION_ADMISSION_COMMAND_SCHEMA_VERSION,
    command_id: `decision-harness-worker-v10-authority-command-${key.slice(0, 24)}`,
    command_ref: `command://replay-decision-harness-worker-v10-authority/${key.slice(0, 24)}`,
    command_key: key,
    command_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_EXECUTION_ADMISSION_COMMAND_POLICY_VERSION,
    scope: "one_attempt_generation_and_authority_transport_bound_intent_creation_admission",
    owner: "replay_runner_worker_v10_authority_execution_admission_command_registry",
    purpose: "reissue_command_for_activated_artifact_and_frame_v2_after_fresh_control_plane_authority_read",
    status: "issued_successor_intent_not_materialized_zero_process",
    source_authority_transport_contract_id: transport.contract_id,
    source_authority_transport_contract_hash: transport.contract_hash,
    source_authority_transport_contract: structuredClone(transport),
    source_predecessor_execution_admission_command_hash: oldCommand.command_hash,
    source_predecessor_process_launch_intent_hash: oldIntent.intent_hash,
    control_plane_clock_attestation_id: clock.attestation_id,
    control_plane_clock_attestation_ref: clock.attestation_ref,
    control_plane_clock_attestation_hash: clock.attestation_hash,
    control_plane_clock_attestation: structuredClone(clock),
    source_execution_envelope_hash: transport.source_execution_envelope_hash,
    worker_request_hash: transport.target_worker_request_hash,
    logical_request_id: transport.target_logical_request_id,
    attempt_id: oldCommand.attempt_id,
    attempt_ordinal: oldCommand.attempt_ordinal,
    worker_id: oldCommand.worker_id,
    lease_generation: oldCommand.lease_generation,
    dispatch_claim_hash: oldCommand.dispatch_claim_hash,
    current_lease_observation_hash: receipt.source_observation_hash,
    current_attempt_lease_hash: receipt.current_attempt_lease_hash,
    activated_process_artifact_hash: transport.activated_process_artifact_hash,
    transport_contract_hash: transport.contract_hash,
    request_frame_schema_version: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_SCHEMA_VERSION,
    response_frame_schema_version: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_FRAME_SCHEMA_VERSION,
    issued_at: clock.registry_read_completed_at,
    valid_before: lease.lease_expires_at,
    issuance_time_semantics: "fresh_control_plane_clock_attestation_completion_not_local_registry_commit_time",
    fresh_authority_policy: "entire_current_attempt_read_must_start_after_predecessor_intent_issuance",
    local_commit_time_policy: "not_authority_and_not_recorded_in_content_addressed_command",
    natural_key_policy: "one_authority_command_per_transport_request_attempt_worker_and_lease_generation",
    execution_admission: "granted_for_exact_successor_process_launch_intent_creation_only",
    worker_request_v10_role: "immutable_non_executable_logical_payload_source",
    worker_request_marker_policy: "preserved_not_overridden_or_reinterpreted",
    old_authority_reuse_policy:
      "predecessor_command_and_intent_are_historical_and_not_executable_for_transport_v3",
    command_reuse_policy: "forbidden_across_transport_attempt_or_lease_generation",
    renewal_policy: "new_lease_generation_requires_new_command_and_fresh_control_plane_read",
    retry_policy: "new_attempt_requires_new_command_logical_request_stable",
    revocation_gate: "lease_expiry_cancellation_or_fencing_must_block_successor_intent",
    authority_capsule_command_binding:
      "command_hash_added_only_after_exact_command_commit_not_embedded_in_payload",
    required_response_echo_fields: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_COMMAND_RESPONSE_ECHO_FIELDS,
    authority_transport_contract_instance_count: 1,
    activated_stdio_artifact_count: 1,
    authority_execution_admission_command_instance_count: 1,
    blocker_set_policy: "complete_deterministic_ordered_post_authority_command_pre_dispatch_blockers",
    blockers: replayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommandBlockers(),
    successor_process_launch_intent: null,
    successor_process_launch_intent_count: 0,
    authority_capsule_instance: null,
    authority_capsule_instance_count: 0,
    spawn_boundary_revalidation_receipt: null,
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
    transport_activation: "command_issued_successor_intent_blocked",
    harness_invocation: "forbidden",
    response_admission: "not_granted",
    decision_output_authority: "none",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
    trial_authority: "none",
  })
}

export function assertReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommandLineage(
  value: ReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand,
  input: BuildReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommandInput,
): void {
  assertReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand(value)
  const expected = buildReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand(input)
  if (canonicalHash(value) !== canonicalHash(expected)) {
    throw new Error("decision harness Worker v10 Authority Execution Admission Command lineage drift")
  }
}
