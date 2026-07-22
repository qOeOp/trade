import {
  REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ADMISSION_COMMAND_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ADMISSION_COMMAND_SCHEMA_VERSION,
  createReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionCommand,
  replayDecisionHarnessWorkerV10SuccessorExecutionAdmissionCommandKey,
  type ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionCommand,
  type ReplayDecisionHarnessWorkerV10SuccessorExecutionDispatchClaim,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-command-admission"
import type { ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-contract-admission"
import type { ReplayWorkerV10SuccessorExecutionCommandRegistryInput } from "./replay-worker-v10-successor-execution-command-types"

export function buildReplayWorkerV10SuccessorExecutionAdmissionCommand(
  input: ReplayWorkerV10SuccessorExecutionCommandRegistryInput,
  parent: ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission,
  parentFileSha256: string,
  claim: ReplayDecisionHarnessWorkerV10SuccessorExecutionDispatchClaim,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionCommand {
  const execution = parent.successor_execution_admission_contract
  const transport = parent.successor_artifact_bound_transport_contract
  const clock = input.control_plane_clock_attestation
  const receipt = input.control_plane_registry_read_receipt
  const key = replayDecisionHarnessWorkerV10SuccessorExecutionAdmissionCommandKey({
    source_successor_execution_contract_admission_hash: parent.admission_hash,
    source_execution_admission_contract_hash: execution.contract_hash,
    source_dispatch_claim_hash: claim.claim_hash,
    control_plane_clock_attestation_hash: clock.attestation_hash,
    target_worker_request_hash: parent.target_worker_request_hash,
    transport_contract_hash: transport.contract_hash,
    command_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ADMISSION_COMMAND_POLICY_VERSION,
  })
  return createReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionCommand({
    schema_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ADMISSION_COMMAND_SCHEMA_VERSION,
    command_id: `decision-harness-worker-v10-successor-execution-command-${key.slice(0, 24)}`,
    command_ref: `command://replay-decision-harness-worker-v10-successor/${key.slice(0, 24)}`,
    command_key: key,
    command_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ADMISSION_COMMAND_POLICY_VERSION,
    scope: "one_successor_attempt_generation_bound_process_launch_intent_admission",
    owner: "replay_runner_worker_v10_successor_execution_command_registry",
    status: "successor_command_issued_process_launch_intent_not_materialized",
    source_successor_execution_contract_admission_hash: parent.admission_hash,
    source_parent_canonical_file_sha256: parentFileSha256,
    source_execution_admission_contract_hash: execution.contract_hash,
    source_artifact_bound_transport_contract_hash: transport.contract_hash,
    source_dispatch_claim_hash: claim.claim_hash,
    source_dispatch_claim: structuredClone(claim),
    control_plane_registry_read_receipt_hash: receipt.receipt_hash,
    control_plane_clock_attestation_hash: clock.attestation_hash,
    control_plane_clock_attestation: structuredClone(clock),
    target_logical_request_id: parent.target_logical_request_id,
    target_worker_request_hash: parent.target_worker_request_hash,
    attempt_id: parent.attempt_id,
    attempt_ordinal: parent.attempt_ordinal,
    worker_id: parent.worker_id,
    lease_generation: parent.successor_lease_generation,
    current_lease_observation_hash: input.source_current_lease_observation.observation_hash,
    current_attempt_lease_hash: receipt.current_attempt_lease_hash,
    successor_process_artifact_hash: transport.successor_process_artifact_hash,
    transport_contract_hash: transport.contract_hash,
    issued_at: clock.registry_read_completed_at,
    valid_before: receipt.current_attempt_lease.lease_expires_at,
    command_identity_policy:
      "hash_exact_parent_request_attempt_generation_claim_lease_receipt_clock_artifact_and_transport",
    issuance_time_semantics:
      "control_plane_clock_attestation_completion_not_local_registry_commit_time",
    evidence_binding_policy:
      "exact_durable_parent_and_claim_plus_embedded_control_plane_clock_receipt_chain",
    natural_key_policy: "one_command_per_exact_successor_authority_evidence_set",
    execution_admission: "granted_for_exact_successor_process_launch_intent_creation_only",
    worker_request_v10_role: "immutable_non_executable_logical_payload_source",
    worker_request_marker_policy: "preserved_not_granted_and_not_invoked_until_later_dispatch",
    command_reuse_policy: "forbidden_across_parent_claim_attempt_or_lease_generation",
    renewal_policy: "new_lease_generation_requires_new_claim_observation_clock_and_command",
    retry_policy: "same_natural_key_requires_identical_evidence_new_attempt_requires_new_command",
    revocation_gate: "lease_expiry_cancellation_or_fencing_must_block_successor_intent",
    required_response_echo_fields: ["execution_admission_command_hash", "worker_request_hash"],
    command_instance_count: 1,
    process_launch_intent_count: 0,
    authority_capsule_count: 0,
    spawn_revalidation_count: 0,
    worker_process_count: 0,
    request_frame_instance_count: 0,
    request_decode_receipt_count: 0,
    response_frame_instance_count: 0,
    blocker_set_policy: "complete_deterministic_ordered_post_successor_command_blockers",
    blockers: ["successor_process_launch_intent_not_materialized",
      "successor_authority_capsule_not_materialized",
      "successor_spawn_boundary_revalidation_not_materialized",
      "successor_worker_process_and_request_dispatch_not_materialized"],
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
