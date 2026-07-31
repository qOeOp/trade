import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_COMMAND_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_CONTRACT_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_POLICY_VERSION,
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionContract,
  createReplayDecisionHarnessWorkerV10ExecutionAdmissionContract,
  replayDecisionHarnessWorkerV10ExecutionAdmissionBlockers,
  replayDecisionHarnessWorkerV10ExecutionAdmissionContractKey,
  type ReplayDecisionHarnessWorkerV10ExecutionAdmissionContract,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-contract"
import {
  assertReplayDecisionHarnessWorkerV10SuccessorTransportContract,
  type ReplayDecisionHarnessWorkerV10SuccessorTransportContract,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-transport-contract"

export interface BuildReplayDecisionHarnessWorkerV10ExecutionAdmissionContractInput {
  source_successor_transport_contract: ReplayDecisionHarnessWorkerV10SuccessorTransportContract
}

export function buildReplayDecisionHarnessWorkerV10ExecutionAdmissionContract(
  input: BuildReplayDecisionHarnessWorkerV10ExecutionAdmissionContractInput,
): ReplayDecisionHarnessWorkerV10ExecutionAdmissionContract {
  assertReplayDecisionHarnessWorkerV10SuccessorTransportContract(input.source_successor_transport_contract)
  const source = input.source_successor_transport_contract
  const contractKey = replayDecisionHarnessWorkerV10ExecutionAdmissionContractKey({
    successor_transport_contract_hash: source.contract_hash,
    admission_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_POLICY_VERSION,
  })
  return createReplayDecisionHarnessWorkerV10ExecutionAdmissionContract({
    schema_version: REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_CONTRACT_SCHEMA_VERSION,
    contract_id: `decision-harness-worker-v10-execution-admission-${contractKey.slice(0, 24)}`,
    contract_key: contractKey,
    admission_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_POLICY_VERSION,
    scope: "zero_instance_execution_authority_model_contract",
    owner: "replay_runner_worker_v10_execution_admission_registry",
    purpose: "freeze_separate_attempt_bound_execution_command_without_mutating_worker_request_v10",
    status: "authority_model_frozen_activation_blocked_zero_instance",
    source_successor_transport_contract_id: source.contract_id,
    source_successor_transport_contract_hash: source.contract_hash,
    source_successor_transport_contract: structuredClone(source),
    target_logical_request_id: source.target_logical_request_id,
    target_worker_request_hash: source.target_worker_request_hash,
    target_worker_request_execution_admission: source.target_request_execution_admission,
    target_worker_request_transport_status: source.target_request_transport_status,
    execution_authority_model: "separate_attempt_bound_execution_admission_command",
    request_v11_decision: "not_required_for_authority_only_transition",
    worker_request_v10_role: "immutable_non_executable_logical_payload_source",
    worker_request_marker_policy: "preserved_not_overridden_or_reinterpreted",
    effective_executable_object: "future_execution_admission_command_not_worker_request_v10",
    logical_identity_policy: "logical_request_id_stable_across_attempt_specific_commands",
    command_identity_policy:
      "hash_exact_request_attempt_generation_claim_lease_observation_process_artifact_and_transport_policy",
    same_attempt_renewal_policy: "new_lease_generation_requires_new_command",
    cross_attempt_retry_policy: "new_attempt_requires_new_command_logical_request_stable",
    command_reuse_policy: "forbidden_across_attempt_or_lease_generation",
    command_revocation_policy: "lease_expiry_cancellation_or_fencing_prevents_new_process_launch",
    response_echo_policy: "future_response_must_echo_command_hash_and_worker_request_hash",
    future_command_schema_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_COMMAND_SCHEMA_VERSION,
    future_command_required_bindings: ["worker_request_hash", "logical_request_id", "attempt_id",
      "attempt_ordinal", "worker_id", "lease_generation", "dispatch_claim_hash",
      "current_lease_observation_hash", "successor_process_artifact_hash", "transport_contract_hash"],
    admission_command_instances: [],
    admission_command_instance_count: 0,
    blocker_set_policy: "complete_deterministic_ordered_pre_issue_blockers",
    blockers: replayDecisionHarnessWorkerV10ExecutionAdmissionBlockers(),
    current_lease_revalidation_receipt: null,
    attempt_bound_process_launch_intent: null,
    attempt_bound_process_receipt: null,
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

export function assertReplayDecisionHarnessWorkerV10ExecutionAdmissionContractLineage(
  value: ReplayDecisionHarnessWorkerV10ExecutionAdmissionContract,
  input: BuildReplayDecisionHarnessWorkerV10ExecutionAdmissionContractInput,
): void {
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionContract(value)
  const expected = buildReplayDecisionHarnessWorkerV10ExecutionAdmissionContract(input)
  if (canonicalHash(value) !== canonicalHash(expected)) {
    throw new Error("decision harness Worker v10 Execution Admission Contract lineage drift")
  }
}
