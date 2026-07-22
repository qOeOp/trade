import {
  REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ADMISSION_CONTRACT_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ADMISSION_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_CONTRACT_ADMISSION_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_CONTRACT_ADMISSION_SCHEMA_VERSION,
  createReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionContract,
  createReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission,
  replayDecisionHarnessWorkerV10SuccessorExecutionAdmissionContractKey,
  replayDecisionHarnessWorkerV10SuccessorExecutionContractAdmissionKey,
  type ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionContract,
  type ReplayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContract,
  type ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-contract-admission"
import type { ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-stdio-probe-admission"

export function buildReplayWorkerV10SuccessorExecutionAdmission(
  source: ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission,
  parentFileSha256: string,
  transport: ReplayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContract,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionContract {
  const key = replayDecisionHarnessWorkerV10SuccessorExecutionAdmissionContractKey({
    source_successor_execution_stdio_probe_admission_hash: source.admission_hash,
    source_artifact_bound_transport_contract_hash: transport.contract_hash,
    admission_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ADMISSION_POLICY_VERSION,
  })
  return createReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionContract({
    schema_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ADMISSION_CONTRACT_SCHEMA_VERSION,
    contract_id: `decision-harness-worker-v10-successor-execution-admission-${key.slice(0, 24)}`,
    contract_key: key,
    admission_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ADMISSION_POLICY_VERSION,
    scope: "successor_generation_zero_instance_execution_admission_contract",
    owner: "replay_runner_worker_v10_successor_execution_contract_registry",
    purpose: "freeze_future_attempt_bound_command_model_without_issuing_command",
    status: "successor_execution_authority_model_frozen_command_not_issued",
    source_successor_execution_stdio_probe_admission_hash: source.admission_hash,
    source_parent_canonical_file_sha256: parentFileSha256,
    source_artifact_bound_transport_contract_hash: transport.contract_hash,
    target_logical_request_id: transport.target_logical_request_id,
    target_worker_request_hash: transport.target_worker_request_hash,
    target_worker_request_execution_admission: transport.target_worker_request_execution_admission,
    target_worker_request_transport_status: transport.target_worker_request_transport_status,
    attempt_id: source.attempt_id,
    attempt_ordinal: source.attempt_ordinal,
    worker_id: source.worker_id,
    lease_generation: source.successor_lease_generation,
    execution_authority_model: "separate_attempt_bound_execution_admission_command",
    command_identity_policy:
      "hash_exact_request_attempt_generation_claim_lease_observation_process_artifact_and_transport_policy",
    command_reuse_policy: "forbidden_across_attempt_or_lease_generation",
    future_command_required_bindings: [
      "worker_request_hash",
      "logical_request_id",
      "attempt_id",
      "attempt_ordinal",
      "worker_id",
      "lease_generation",
      "dispatch_claim_hash",
      "current_lease_observation_hash",
      "successor_process_artifact_hash",
      "transport_contract_hash",
    ],
    evidence_binding_policy:
      "exact_durable_local_cas_hash_references_without_recursive_lineage_reembedding",
    admission_command_instance_count: 0,
    worker_process_count: 0,
    request_frame_instance_count: 0,
    request_decode_receipt_count: 0,
    response_frame_instance_count: 0,
    blocker_set_policy:
      "complete_deterministic_ordered_successor_execution_admission_blockers",
    blockers: [
      "successor_exact_durable_dispatch_claim_not_bound",
      "successor_control_plane_registry_read_provenance_not_materialized",
      "successor_independent_dispatch_clock_attestation_not_materialized",
      "successor_current_lease_revalidation_for_command_not_materialized",
      "successor_execution_admission_command_not_issued",
    ],
    transport_activation: "blocked",
    harness_invocation: "forbidden",
    response_admission: "not_granted",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
    trial_authority: "none",
  })
}

export function buildReplayWorkerV10SuccessorExecutionContractAdmission(
  source: ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission,
  parentFileSha256: string,
  transport: ReplayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContract,
  execution: ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionContract,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission {
  const key = replayDecisionHarnessWorkerV10SuccessorExecutionContractAdmissionKey({
    source_successor_execution_stdio_probe_admission_hash: source.admission_hash,
    successor_artifact_bound_transport_contract_hash: transport.contract_hash,
    successor_execution_admission_contract_hash: execution.contract_hash,
    admission_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_CONTRACT_ADMISSION_POLICY_VERSION,
  })
  return createReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission({
    schema_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_CONTRACT_ADMISSION_SCHEMA_VERSION,
    admission_id: `decision-harness-worker-v10-successor-execution-contract-${key.slice(0, 24)}`,
    admission_ref:
      `admission://replay-decision-harness-worker-v10-successor-execution-contract/${key.slice(0, 24)}`,
    admission_key: key,
    admission_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_CONTRACT_ADMISSION_POLICY_VERSION,
    scope: "one_successor_artifact_bound_transport_and_zero_instance_execution_admission_contract",
    owner: "replay_runner_worker_v10_successor_execution_contract_registry",
    purpose:
      "rebuild_envelope_bound_execution_contracts_without_issuing_command_or_starting_worker",
    status: "successor_execution_contracts_admitted_command_not_issued",
    source_successor_execution_stdio_probe_admission_hash: source.admission_hash,
    source_parent_canonical_file_sha256: parentFileSha256,
    source_predecessor_artifact_bound_transport_contract_hash:
      source.source_predecessor_artifact_bound_transport_contract_hash,
    source_predecessor_execution_admission_contract_hash:
      source.source_predecessor_execution_admission_contract_hash,
    successor_artifact_bound_transport_contract_hash: transport.contract_hash,
    successor_artifact_bound_transport_contract: structuredClone(transport),
    successor_execution_admission_contract_hash: execution.contract_hash,
    successor_execution_admission_contract: structuredClone(execution),
    successor_base_transport_contract_hash: source.source_successor_base_transport_contract_hash,
    successor_stdio_capability_hash: source.successor_stdio_capability_hash,
    successor_negative_probe_receipt_hash: source.successor_negative_probe_receipt_hash,
    successor_execution_envelope_hash: source.source_successor_execution_envelope_hash,
    successor_process_artifact_hash: transport.successor_process_artifact_hash,
    target_logical_request_id: transport.target_logical_request_id,
    target_worker_request_hash: transport.target_worker_request_hash,
    target_worker_request_execution_admission: transport.target_worker_request_execution_admission,
    target_worker_request_transport_status: transport.target_worker_request_transport_status,
    attempt_id: source.attempt_id,
    attempt_ordinal: source.attempt_ordinal,
    worker_id: source.worker_id,
    predecessor_lease_generation: source.predecessor_lease_generation,
    successor_lease_generation: source.successor_lease_generation,
    artifact_transport_identity_policy:
      "fresh_identity_per_exact_envelope_stdio_capability_and_negative_probe_receipt",
    artifact_byte_parity_policy:
      "identical_process_artifact_hash_does_not_permit_transport_contract_identity_reuse",
    execution_admission_identity_policy:
      "fresh_identity_per_exact_artifact_bound_transport_contract",
    request_marker_policy: "worker_request_v10_remains_not_granted_and_not_invoked",
    command_issue_policy: "separate_future_attempt_bound_command_required",
    evidence_binding_policy:
      "exact_durable_local_cas_hash_references_without_recursive_lineage_reembedding",
    parent_validation_policy:
      "durable_parent_validation_receipt_binds_self_hash_and_canonical_file_sha256",
    registry_durability: "replay_local_immutable_cas_regular_file_canonical_json",
    successor_base_transport_contract_count: 1,
    successor_stdio_capability_count: 1,
    successor_negative_probe_receipt_count: 1,
    successor_negative_probe_process_count: 5,
    successor_artifact_bound_transport_contract_count: 1,
    successor_execution_admission_contract_count: 1,
    successor_execution_admission_command_count: 0,
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
    transport_authority: "artifact_bound_contract_frozen_activation_blocked",
    command_authority: "contract_frozen_zero_instance_not_issued",
    worker_process_authority: "none",
    blockers: [
      "successor_command_intent_capsule_revalidation_and_worker_process_not_materialized",
      "second_distinct_fresh_worker_process_schedule_admission_not_materialized",
      "response_reproducibility_pair_and_harness_receipt_not_materialized",
    ],
    decision_output_authority:
      "first_schedule_matched_claim_only_successor_execution_contracts_admitted",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
    trial_authority: "none",
  })
}
