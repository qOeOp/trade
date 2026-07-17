import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import {
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation,
  type ReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-clock-attestation"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_COMMAND_POLICY_VERSION,
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand,
  createReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand,
  replayDecisionHarnessWorkerV10ExecutionAdmissionCommandBlockers,
  replayDecisionHarnessWorkerV10ExecutionAdmissionCommandKey,
  type ReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-command"
import { REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_COMMAND_SCHEMA_VERSION } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-contract"

export interface BuildReplayDecisionHarnessWorkerV10ExecutionAdmissionCommandInput {
  source_clock_binding: ReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation
}

export function buildReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand(
  input: BuildReplayDecisionHarnessWorkerV10ExecutionAdmissionCommandInput,
): ReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand {
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation(input.source_clock_binding)
  const binding = input.source_clock_binding
  const provenance = binding.source_registry_provenance
  const bundle = provenance.source_pre_issue_bundle
  const contract = bundle.source_execution_admission_contract
  const clock = binding.control_plane_clock_attestation
  const successor = contract.source_successor_transport_contract
  const key = replayDecisionHarnessWorkerV10ExecutionAdmissionCommandKey({
    worker_request_hash: binding.target_worker_request_hash,
    logical_request_id: binding.target_logical_request_id,
    attempt_id: binding.attempt_id,
    attempt_ordinal: binding.attempt_ordinal,
    worker_id: binding.worker_id,
    lease_generation: binding.lease_generation,
    command_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_COMMAND_POLICY_VERSION,
  })
  return createReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand({
    schema_version: REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_COMMAND_SCHEMA_VERSION,
    command_id: `decision-harness-worker-v10-execution-command-${key.slice(0, 24)}`,
    command_ref: `command://replay-decision-harness-worker-v10/${key.slice(0, 24)}`,
    command_key: key,
    command_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_COMMAND_POLICY_VERSION,
    scope: "one_attempt_and_lease_generation_bound_process_launch_admission",
    owner: "replay_runner_worker_v10_execution_admission_command_registry",
    status: "issued_process_launch_intent_not_materialized",
    source_clock_binding_id: binding.binding_id,
    source_clock_binding_hash: binding.binding_hash,
    source_clock_binding: structuredClone(binding),
    source_execution_admission_contract_id: contract.contract_id,
    source_execution_admission_contract_hash: contract.contract_hash,
    worker_request_hash: binding.target_worker_request_hash,
    logical_request_id: binding.target_logical_request_id,
    attempt_id: binding.attempt_id,
    attempt_ordinal: binding.attempt_ordinal,
    worker_id: binding.worker_id,
    lease_generation: binding.lease_generation,
    dispatch_claim_hash: bundle.source_dispatch_claim_hash,
    current_lease_observation_hash: bundle.source_current_lease_observation_hash,
    registry_read_receipt_hash: provenance.control_plane_registry_read_receipt_hash,
    dispatch_clock_attestation_hash: clock.attestation_hash,
    current_attempt_lease_hash: binding.current_attempt_lease_hash,
    successor_process_artifact_hash: successor.successor_process_artifact_hash,
    transport_contract_hash: successor.contract_hash,
    issued_at: clock.registry_read_completed_at,
    valid_before: clock.source_registry_read_receipt.current_attempt_lease.lease_expires_at,
    issuance_time_semantics: "control_plane_clock_attestation_completion_not_registry_commit_time",
    natural_key_policy: "one_command_per_request_attempt_worker_and_lease_generation",
    execution_admission: "granted_for_exact_attempt_bound_process_launch_intent_creation_only",
    worker_request_v10_role: "immutable_non_executable_logical_payload_source",
    worker_request_marker_policy: "preserved_not_overridden_or_reinterpreted",
    command_reuse_policy: "forbidden_across_attempt_or_lease_generation",
    renewal_policy: "new_lease_generation_requires_new_command",
    retry_policy: "new_attempt_requires_new_command_logical_request_stable",
    revocation_gate: "lease_expiry_cancellation_or_fencing_must_block_process_launch_intent",
    required_response_echo_fields: ["execution_admission_command_hash", "worker_request_hash"],
    command_instance_count: 1,
    blocker_set_policy: "complete_deterministic_ordered_post_command_pre_process_blockers",
    blockers: replayDecisionHarnessWorkerV10ExecutionAdmissionCommandBlockers(),
    attempt_bound_process_launch_intent: null,
    attempt_bound_process_launch_intent_count: 0,
    attempt_bound_process_receipt: null,
    attempt_bound_process_receipt_count: 0,
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

export function assertReplayDecisionHarnessWorkerV10ExecutionAdmissionCommandLineage(
  value: ReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand,
  input: BuildReplayDecisionHarnessWorkerV10ExecutionAdmissionCommandInput,
): void {
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand(value)
  if (canonicalHash(value) !== canonicalHash(buildReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand(input))) {
    throw new Error("Execution Admission Command lineage drift")
  }
}
