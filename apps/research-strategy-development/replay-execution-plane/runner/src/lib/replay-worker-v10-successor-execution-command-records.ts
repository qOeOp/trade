import {
  REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_COMMAND_ADMISSION_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_COMMAND_ADMISSION_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_DISPATCH_CLAIM_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_DISPATCH_CLAIM_SCHEMA_VERSION,
  createReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission,
  createReplayDecisionHarnessWorkerV10SuccessorExecutionDispatchClaim,
  replayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmissionKey,
  replayDecisionHarnessWorkerV10SuccessorExecutionDispatchClaimKey,
  type ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionCommand,
  type ReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission,
  type ReplayDecisionHarnessWorkerV10SuccessorExecutionDispatchClaim,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-command-admission"
import type { ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-contract-admission"
import type { ReplayWorkerV10SuccessorExecutionCommandRegistryInput } from "./replay-worker-v10-successor-execution-command-types"

export function buildReplayWorkerV10SuccessorExecutionDispatchClaim(
  input: ReplayWorkerV10SuccessorExecutionCommandRegistryInput,
  parent: ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission,
  parentFileSha256: string,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionDispatchClaim {
  const key = replayDecisionHarnessWorkerV10SuccessorExecutionDispatchClaimKey({
    source_successor_execution_contract_admission_hash: parent.admission_hash,
    target_logical_request_id: parent.target_logical_request_id,
    attempt_id: parent.attempt_id,
    attempt_ordinal: parent.attempt_ordinal,
    worker_id: parent.worker_id,
    lease_generation: parent.successor_lease_generation,
    claim_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_DISPATCH_CLAIM_POLICY_VERSION,
  })
  return createReplayDecisionHarnessWorkerV10SuccessorExecutionDispatchClaim({
    schema_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_DISPATCH_CLAIM_SCHEMA_VERSION,
    claim_id: `decision-harness-worker-v10-successor-execution-claim-${key.slice(0, 24)}`,
    claim_ref: `claim://replay-decision-harness-worker-v10-successor/${key.slice(0, 24)}`,
    claim_key: key,
    claim_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_DISPATCH_CLAIM_POLICY_VERSION,
    scope: "one_successor_attempt_generation_local_dispatch_claim",
    owner: "replay_runner_worker_v10_successor_execution_command_registry",
    status: "successor_dispatch_exclusivity_claimed_command_not_issued",
    source_successor_execution_contract_admission_hash: parent.admission_hash,
    source_parent_canonical_file_sha256: parentFileSha256,
    target_logical_request_id: parent.target_logical_request_id,
    target_worker_request_hash: parent.target_worker_request_hash,
    attempt_id: parent.attempt_id,
    attempt_ordinal: parent.attempt_ordinal,
    worker_id: parent.worker_id,
    lease_generation: parent.successor_lease_generation,
    dispatcher_claimant_id: input.dispatcher_claimant_id,
    claimed_at: input.claimed_at,
    natural_key_policy: "one_claim_per_parent_request_attempt_worker_and_lease_generation",
    claim_effect: "at_most_one_local_successor_command_issuer_while_cas_record_is_preserved",
    claim_reuse_policy: "forbidden_across_parent_attempt_or_lease_generation",
    claim_authority_limit:
      "cas_exclusivity_only_not_command_process_transport_or_economic_authority",
    execution_admission_command_instance_count: 0,
    worker_process_count: 0,
    dispatch_occurrence: "not_materialized",
    transport_activation: "blocked",
    harness_invocation: "forbidden",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
    trial_authority: "none",
  })
}

export function buildReplayWorkerV10SuccessorExecutionCommandAdmission(
  parent: ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission,
  parentFileSha256: string,
  command: ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionCommand,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission {
  const key = replayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmissionKey({
    source_successor_execution_contract_admission_hash: parent.admission_hash,
    successor_dispatch_claim_hash: command.source_dispatch_claim_hash,
    successor_execution_admission_command_hash: command.command_hash,
    admission_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_COMMAND_ADMISSION_POLICY_VERSION,
  })
  return createReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission({
    schema_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_COMMAND_ADMISSION_SCHEMA_VERSION,
    admission_id: `decision-harness-worker-v10-successor-command-${key.slice(0, 24)}`,
    admission_ref:
      `admission://replay-decision-harness-worker-v10-successor-command/${key.slice(0, 24)}`,
    admission_key: key,
    admission_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_COMMAND_ADMISSION_POLICY_VERSION,
    scope: "one_successor_dispatch_claim_and_execution_admission_command",
    owner: "replay_runner_worker_v10_successor_execution_command_registry",
    purpose: "issue_generation_specific_command_after_fresh_control_plane_authority_evidence",
    status: "successor_command_admitted_process_launch_intent_not_materialized",
    source_successor_execution_contract_admission_hash: parent.admission_hash,
    source_parent_canonical_file_sha256: parentFileSha256,
    source_execution_admission_contract_hash: parent.successor_execution_admission_contract_hash,
    source_artifact_bound_transport_contract_hash:
      parent.successor_artifact_bound_transport_contract_hash,
    successor_dispatch_claim_hash: command.source_dispatch_claim_hash,
    successor_execution_admission_command_hash: command.command_hash,
    successor_execution_admission_command: structuredClone(command),
    target_logical_request_id: parent.target_logical_request_id,
    target_worker_request_hash: parent.target_worker_request_hash,
    target_worker_request_execution_admission: parent.target_worker_request_execution_admission,
    target_worker_request_transport_status: parent.target_worker_request_transport_status,
    attempt_id: parent.attempt_id,
    attempt_ordinal: parent.attempt_ordinal,
    worker_id: parent.worker_id,
    predecessor_lease_generation: parent.predecessor_lease_generation,
    successor_lease_generation: parent.successor_lease_generation,
    parent_validation_policy:
      "first_registration_direct_parent_self_hash_successor_reads_file_sha256_key_hash_reference",
    evidence_binding_policy:
      "thin_direct_parent_hash_closure_with_embedded_command_authority_evidence",
    registry_durability: "replay_local_immutable_cas_regular_file_canonical_json",
    successor_dispatch_claim_count: 1,
    successor_current_lease_observation_count: 1,
    successor_registry_read_receipt_count: 1,
    successor_clock_attestation_count: 1,
    successor_execution_admission_command_count: 1,
    successor_process_launch_intent_count: 0,
    successor_authority_capsule_count: 0,
    successor_spawn_revalidation_count: 0,
    successor_worker_process_count: 0,
    successor_worker_request_frame_count: 0,
    successor_worker_request_decode_count: 0,
    second_response_count: 0,
    second_schedule_admission_count: 0,
    reproducibility_pair_count: 0,
    harness_receipt_count: 0,
    transport_authority: "artifact_bound_command_issued_activation_blocked",
    command_authority: "issued_for_exact_successor_process_launch_intent_creation_only",
    worker_process_authority: "none",
    blockers: ["successor_intent_capsule_revalidation_and_worker_process_not_materialized",
      "second_distinct_fresh_worker_process_schedule_admission_not_materialized",
      "response_reproducibility_pair_and_harness_receipt_not_materialized"],
    decision_output_authority: "first_schedule_matched_claim_only_successor_command_admitted",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
    trial_authority: "none",
  })
}
