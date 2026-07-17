import { canonicalHash, canonicalJson } from "./replay-contracts"
import {
  assertReplayDecisionHarnessWorkerV10SuccessorTransportContract,
  type ReplayDecisionHarnessWorkerV10SuccessorTransportContract,
} from "./replay-decision-harness-worker-v10-successor-transport-contract"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
} from "./replay-cross-source-ordering"

export const REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_CONTRACT_SCHEMA_VERSION =
  "trade.rd-replay-decision-harness-worker-v10-execution-admission-contract.v1" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_POLICY_VERSION =
  "rd-replay-harness-worker-v10-separate-execution-admission-command-v1" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_COMMAND_SCHEMA_VERSION =
  "trade.rd-replay-decision-harness-worker-v10-execution-admission-command.v1" as const

export type ReplayDecisionHarnessWorkerV10ExecutionAdmissionBlocker =
  | "exact_durable_dispatch_claim_not_bound"
  | "control_plane_registry_read_provenance_not_materialized"
  | "independent_dispatch_clock_attestation_not_materialized"
  | "current_lease_revalidation_for_admission_command_not_materialized"
  | "execution_admission_command_instance_not_issued"
  | "attempt_bound_stdio_process_launch_intent_not_materialized"
  | "attempt_bound_stdio_process_receipt_not_materialized"
  | "worker_request_frame_write_and_decode_not_materialized"
  | "worker_response_frame_read_and_admission_not_materialized"

export interface ReplayDecisionHarnessWorkerV10ExecutionAdmissionContract {
  schema_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_CONTRACT_SCHEMA_VERSION
  contract_id: string
  contract_hash: string
  contract_key: string
  admission_policy_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_POLICY_VERSION
  scope: "zero_instance_execution_authority_model_contract"
  owner: "replay_runner_worker_v10_execution_admission_registry"
  purpose: "freeze_separate_attempt_bound_execution_command_without_mutating_worker_request_v10"
  status: "authority_model_frozen_activation_blocked_zero_instance"
  source_successor_transport_contract_id: string
  source_successor_transport_contract_hash: string
  source_successor_transport_contract: ReplayDecisionHarnessWorkerV10SuccessorTransportContract
  target_logical_request_id: string
  target_worker_request_hash: string
  target_worker_request_execution_admission: "not_granted"
  target_worker_request_transport_status: "not_invoked"
  execution_authority_model: "separate_attempt_bound_execution_admission_command"
  request_v11_decision: "not_required_for_authority_only_transition"
  worker_request_v10_role: "immutable_non_executable_logical_payload_source"
  worker_request_marker_policy: "preserved_not_overridden_or_reinterpreted"
  effective_executable_object: "future_execution_admission_command_not_worker_request_v10"
  logical_identity_policy: "logical_request_id_stable_across_attempt_specific_commands"
  command_identity_policy:
    "hash_exact_request_attempt_generation_claim_lease_observation_process_artifact_and_transport_policy"
  same_attempt_renewal_policy: "new_lease_generation_requires_new_command"
  cross_attempt_retry_policy: "new_attempt_requires_new_command_logical_request_stable"
  command_reuse_policy: "forbidden_across_attempt_or_lease_generation"
  command_revocation_policy: "lease_expiry_cancellation_or_fencing_prevents_new_process_launch"
  response_echo_policy: "future_response_must_echo_command_hash_and_worker_request_hash"
  future_command_schema_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_COMMAND_SCHEMA_VERSION
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
  ]
  admission_command_instances: []
  admission_command_instance_count: 0
  blocker_set_policy: "complete_deterministic_ordered_pre_issue_blockers"
  blockers: ReplayDecisionHarnessWorkerV10ExecutionAdmissionBlocker[]
  current_lease_revalidation_receipt: null
  attempt_bound_process_launch_intent: null
  attempt_bound_process_receipt: null
  request_frame_instance_count: 0
  request_write_receipt_count: 0
  request_decode_receipt_count: 0
  response_frame_instance_count: 0
  response_read_receipt_count: 0
  dispatch_occurrence: "not_materialized"
  transport_activation: "blocked"
  harness_invocation: "forbidden"
  response_admission: "not_granted"
  decision_output_authority: "none"
  signal_authority: "none"
  order_authority: "none"
  economic_authority: "none"
  trial_authority: "none"
}

export type ReplayDecisionHarnessWorkerV10ExecutionAdmissionContractBody = Omit<
  ReplayDecisionHarnessWorkerV10ExecutionAdmissionContract,
  "contract_hash"
>

export function replayDecisionHarnessWorkerV10ExecutionAdmissionBlockers():
ReplayDecisionHarnessWorkerV10ExecutionAdmissionBlocker[] {
  return [
    "exact_durable_dispatch_claim_not_bound",
    "control_plane_registry_read_provenance_not_materialized",
    "independent_dispatch_clock_attestation_not_materialized",
    "current_lease_revalidation_for_admission_command_not_materialized",
    "execution_admission_command_instance_not_issued",
    "attempt_bound_stdio_process_launch_intent_not_materialized",
    "attempt_bound_stdio_process_receipt_not_materialized",
    "worker_request_frame_write_and_decode_not_materialized",
    "worker_response_frame_read_and_admission_not_materialized",
  ]
}

export function replayDecisionHarnessWorkerV10ExecutionAdmissionContractKey(input: {
  successor_transport_contract_hash: string
  admission_policy_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_POLICY_VERSION
}): string {
  requireHash(input.successor_transport_contract_hash, "decision harness Worker v10 Execution Admission Contract parent")
  if (input.admission_policy_version
      !== REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_POLICY_VERSION) {
    throw new Error("unsupported decision harness Worker v10 Execution Admission policy")
  }
  return canonicalHash(input)
}

export function createReplayDecisionHarnessWorkerV10ExecutionAdmissionContract(
  body: ReplayDecisionHarnessWorkerV10ExecutionAdmissionContractBody,
): ReplayDecisionHarnessWorkerV10ExecutionAdmissionContract {
  const value = { ...structuredClone(body), contract_hash: canonicalHash(body) }
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionContract(value)
  return value
}

export function assertReplayDecisionHarnessWorkerV10ExecutionAdmissionContract(
  value: ReplayDecisionHarnessWorkerV10ExecutionAdmissionContract,
): void {
  assertFields(value)
  if (value.schema_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_CONTRACT_SCHEMA_VERSION
      || value.admission_policy_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_POLICY_VERSION
      || value.scope !== "zero_instance_execution_authority_model_contract"
      || value.owner !== "replay_runner_worker_v10_execution_admission_registry"
      || value.purpose
        !== "freeze_separate_attempt_bound_execution_command_without_mutating_worker_request_v10"
      || value.status !== "authority_model_frozen_activation_blocked_zero_instance"
      || value.target_worker_request_execution_admission !== "not_granted"
      || value.target_worker_request_transport_status !== "not_invoked"
      || value.execution_authority_model !== "separate_attempt_bound_execution_admission_command"
      || value.request_v11_decision !== "not_required_for_authority_only_transition"
      || value.worker_request_v10_role !== "immutable_non_executable_logical_payload_source"
      || value.worker_request_marker_policy !== "preserved_not_overridden_or_reinterpreted"
      || value.effective_executable_object !== "future_execution_admission_command_not_worker_request_v10"
      || value.logical_identity_policy !== "logical_request_id_stable_across_attempt_specific_commands"
      || value.command_identity_policy
        !== "hash_exact_request_attempt_generation_claim_lease_observation_process_artifact_and_transport_policy"
      || value.same_attempt_renewal_policy !== "new_lease_generation_requires_new_command"
      || value.cross_attempt_retry_policy !== "new_attempt_requires_new_command_logical_request_stable"
      || value.command_reuse_policy !== "forbidden_across_attempt_or_lease_generation"
      || value.command_revocation_policy
        !== "lease_expiry_cancellation_or_fencing_prevents_new_process_launch"
      || value.response_echo_policy !== "future_response_must_echo_command_hash_and_worker_request_hash"
      || value.future_command_schema_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_COMMAND_SCHEMA_VERSION
      || canonicalJson(value.future_command_required_bindings) !== canonicalJson(FUTURE_COMMAND_BINDINGS)
      || value.admission_command_instances.length !== 0 || value.admission_command_instance_count !== 0
      || value.blocker_set_policy !== "complete_deterministic_ordered_pre_issue_blockers"
      || canonicalJson(value.blockers) !== canonicalJson(replayDecisionHarnessWorkerV10ExecutionAdmissionBlockers())
      || value.current_lease_revalidation_receipt !== null
      || value.attempt_bound_process_launch_intent !== null || value.attempt_bound_process_receipt !== null
      || value.request_frame_instance_count !== 0 || value.request_write_receipt_count !== 0
      || value.request_decode_receipt_count !== 0 || value.response_frame_instance_count !== 0
      || value.response_read_receipt_count !== 0 || value.dispatch_occurrence !== "not_materialized"
      || value.transport_activation !== "blocked" || value.harness_invocation !== "forbidden"
      || value.response_admission !== "not_granted" || value.decision_output_authority !== "none"
      || value.signal_authority !== "none" || value.order_authority !== "none"
      || value.economic_authority !== "none" || value.trial_authority !== "none") {
    throw new Error("unsupported decision harness Worker v10 Execution Admission Contract authority")
  }
  for (const item of [value.contract_id, value.source_successor_transport_contract_id]) {
    requireText(item, "decision harness Worker v10 Execution Admission Contract identity")
  }
  for (const item of [value.contract_hash, value.contract_key, value.source_successor_transport_contract_hash,
    value.target_logical_request_id, value.target_worker_request_hash]) {
    requireHash(item, "decision harness Worker v10 Execution Admission Contract hash")
  }
  assertReplayDecisionHarnessWorkerV10SuccessorTransportContract(value.source_successor_transport_contract)
  const source = value.source_successor_transport_contract
  const expectedKey = replayDecisionHarnessWorkerV10ExecutionAdmissionContractKey({
    successor_transport_contract_hash: source.contract_hash,
    admission_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_POLICY_VERSION,
  })
  if (value.contract_key !== expectedKey
      || value.source_successor_transport_contract_id !== source.contract_id
      || value.source_successor_transport_contract_hash !== source.contract_hash
      || value.target_logical_request_id !== source.target_logical_request_id
      || value.target_worker_request_hash !== source.target_worker_request_hash
      || value.target_worker_request_execution_admission !== source.target_request_execution_admission
      || value.target_worker_request_transport_status !== source.target_request_transport_status) {
    throw new Error("decision harness Worker v10 Execution Admission Contract parent binding drift")
  }
  const { contract_hash: contractHash, ...body } = value
  if (value.contract_id !== `decision-harness-worker-v10-execution-admission-${value.contract_key.slice(0, 24)}`
      || contractHash !== canonicalHash(body)) {
    throw new Error("decision harness Worker v10 Execution Admission Contract identity or hash mismatch")
  }
}

const FUTURE_COMMAND_BINDINGS = ["worker_request_hash", "logical_request_id", "attempt_id", "attempt_ordinal",
  "worker_id", "lease_generation", "dispatch_claim_hash", "current_lease_observation_hash",
  "successor_process_artifact_hash", "transport_contract_hash"] as const
const FIELDS = ["admission_command_instance_count", "admission_command_instances", "admission_policy_version",
  "attempt_bound_process_launch_intent", "attempt_bound_process_receipt", "blocker_set_policy", "blockers",
  "command_identity_policy", "command_reuse_policy", "command_revocation_policy", "contract_hash", "contract_id",
  "contract_key", "cross_attempt_retry_policy", "current_lease_revalidation_receipt", "decision_output_authority",
  "dispatch_occurrence", "economic_authority", "effective_executable_object", "execution_authority_model",
  "future_command_required_bindings", "future_command_schema_version", "harness_invocation",
  "logical_identity_policy", "order_authority", "owner", "purpose", "request_decode_receipt_count",
  "request_frame_instance_count", "request_v11_decision", "request_write_receipt_count", "response_admission",
  "response_echo_policy", "response_frame_instance_count", "response_read_receipt_count", "same_attempt_renewal_policy",
  "schema_version", "scope", "signal_authority", "source_successor_transport_contract",
  "source_successor_transport_contract_hash", "source_successor_transport_contract_id", "status",
  "target_logical_request_id", "target_worker_request_execution_admission", "target_worker_request_hash",
  "target_worker_request_transport_status", "transport_activation", "trial_authority", "worker_request_marker_policy",
  "worker_request_v10_role"].sort()

function assertFields(value: object): void {
  if (canonicalHash(Object.keys(value).sort()) !== canonicalHash(FIELDS)) {
    throw new Error("decision harness Worker v10 Execution Admission Contract field whitelist drift")
  }
}
