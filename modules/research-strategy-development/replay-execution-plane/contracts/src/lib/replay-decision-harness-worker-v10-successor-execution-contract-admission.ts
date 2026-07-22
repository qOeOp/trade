import { canonicalHash, canonicalJson } from "./replay-contracts"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_REQUEST_FRAME_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_RESPONSE_FRAME_SCHEMA_VERSION,
} from "./replay-decision-harness-worker-v10-transport-contract"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
} from "./replay-cross-source-ordering"

export const REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_CONTRACT_ADMISSION_SCHEMA_VERSION =
  "trade.rd-replay-decision-harness-worker-v10-successor-execution-contract-admission.v2" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_CONTRACT_ADMISSION_POLICY_VERSION =
  "rd-replay-harness-worker-v10-successor-execution-contract-rebuild-v1" as const

const BLOCKERS = [
  "successor_command_intent_capsule_revalidation_and_worker_process_not_materialized",
  "second_distinct_fresh_worker_process_schedule_admission_not_materialized",
  "response_reproducibility_pair_and_harness_receipt_not_materialized",
] as const

export const REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ARTIFACT_TRANSPORT_SCHEMA_VERSION =
  "trade.rd-replay-decision-harness-worker-v10-successor-execution-artifact-transport.v1" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ARTIFACT_TRANSPORT_POLICY_VERSION =
  "rd-replay-harness-worker-v10-successor-execution-artifact-transport-v1" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ADMISSION_CONTRACT_SCHEMA_VERSION =
  "trade.rd-replay-decision-harness-worker-v10-successor-execution-admission-contract.v1" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ADMISSION_POLICY_VERSION =
  "rd-replay-harness-worker-v10-successor-execution-admission-v1" as const

const ARTIFACT_TRANSPORT_BLOCKERS = [
  "successor_execution_admission_command_not_issued",
  "successor_current_lease_revalidation_not_materialized",
  "successor_worker_process_not_materialized",
  "successor_worker_request_frame_write_and_decode_not_materialized",
  "successor_worker_response_frame_read_and_admission_not_materialized",
] as const

const EXECUTION_ADMISSION_BLOCKERS = [
  "successor_exact_durable_dispatch_claim_not_bound",
  "successor_control_plane_registry_read_provenance_not_materialized",
  "successor_independent_dispatch_clock_attestation_not_materialized",
  "successor_current_lease_revalidation_for_command_not_materialized",
  "successor_execution_admission_command_not_issued",
] as const

export interface ReplayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContract {
  schema_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ARTIFACT_TRANSPORT_SCHEMA_VERSION
  contract_id: string
  contract_key: string
  contract_hash: string
  transport_policy_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ARTIFACT_TRANSPORT_POLICY_VERSION
  scope: "successor_generation_artifact_bound_zero_instance_transport_contract"
  owner: "replay_runner_worker_v10_successor_execution_contract_registry"
  purpose: "bind_exact_successor_stdio_artifact_without_recursive_parent_reembedding_or_activation"
  status: "successor_artifact_bound_transport_frozen_activation_blocked"
  source_successor_execution_stdio_probe_admission_hash: string
  source_parent_canonical_file_sha256: string
  source_successor_base_transport_contract_hash: string
  source_successor_stdio_capability_hash: string
  source_successor_negative_probe_receipt_hash: string
  source_successor_execution_envelope_hash: string
  target_logical_request_id: string
  target_worker_request_hash: string
  target_worker_request_execution_admission: "not_granted"
  target_worker_request_transport_status: "not_invoked"
  successor_process_artifact_hash: string
  artifact_binding_policy: "exact_successor_stdio_capability_artifact_hash"
  evidence_binding_policy:
    "exact_durable_local_cas_hash_references_without_recursive_lineage_reembedding"
  process_model: "fresh_single_request_process_no_pool_keepalive_or_multiplex"
  process_lifecycle: [
    "spawn_exact_successor_artifact",
    "write_one_request_frame",
    "close_stdin",
    "read_one_response_frame",
    "await_process_exit",
  ]
  request_frame_schema_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_REQUEST_FRAME_SCHEMA_VERSION
  response_frame_schema_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_RESPONSE_FRAME_SCHEMA_VERSION
  request_frame_encoding: "canonical_json_utf8_lf_then_eof"
  response_frame_encoding: "canonical_json_utf8_lf_then_process_exit"
  trailing_bytes_policy: "no_non_whitespace_bytes_after_single_frame"
  max_request_frame_bytes: number
  max_response_frame_bytes: number
  timeout_ms: number
  attempt_id: string
  attempt_ordinal: number
  worker_id: string
  lease_generation: number
  source_negative_probe_process_count: 5
  worker_request_frame_count: 0
  worker_request_decode_count: 0
  worker_process_count: 0
  blocker_set_policy: "complete_deterministic_ordered_successor_artifact_transport_blockers"
  blockers: typeof ARTIFACT_TRANSPORT_BLOCKERS
  dispatch_occurrence: "not_materialized"
  transport_activation: "blocked"
  harness_invocation: "forbidden"
  response_admission: "not_granted"
  signal_authority: "none"
  order_authority: "none"
  economic_authority: "none"
  trial_authority: "none"
}

export type ReplayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContractBody = Omit<
  ReplayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContract,
  "contract_hash"
>

export function replayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContractKey(input: {
  source_successor_execution_stdio_probe_admission_hash: string
  source_successor_base_transport_contract_hash: string
  source_successor_stdio_capability_hash: string
  source_successor_negative_probe_receipt_hash: string
  successor_process_artifact_hash: string
  transport_policy_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ARTIFACT_TRANSPORT_POLICY_VERSION
}): string {
  for (const item of [input.source_successor_execution_stdio_probe_admission_hash,
    input.source_successor_base_transport_contract_hash, input.source_successor_stdio_capability_hash,
    input.source_successor_negative_probe_receipt_hash, input.successor_process_artifact_hash]) {
    requireHash(item, "successor execution artifact Transport natural key hash")
  }
  if (input.transport_policy_version
      !== REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ARTIFACT_TRANSPORT_POLICY_VERSION) {
    throw new Error("unsupported successor execution artifact Transport policy")
  }
  return canonicalHash(input)
}

export function createReplayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContract(
  body: ReplayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContractBody,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContract {
  const value = { ...structuredClone(body), contract_hash: canonicalHash(body) }
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContract(value)
  return value
}

export function assertReplayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContract(
  value: ReplayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContract,
): void {
  assertExactFields(value, ARTIFACT_TRANSPORT_FIELDS, "successor execution artifact Transport")
  if (value.schema_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ARTIFACT_TRANSPORT_SCHEMA_VERSION
      || value.transport_policy_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ARTIFACT_TRANSPORT_POLICY_VERSION
      || value.scope !== "successor_generation_artifact_bound_zero_instance_transport_contract"
      || value.owner !== "replay_runner_worker_v10_successor_execution_contract_registry"
      || value.purpose
        !== "bind_exact_successor_stdio_artifact_without_recursive_parent_reembedding_or_activation"
      || value.status !== "successor_artifact_bound_transport_frozen_activation_blocked"
      || value.target_worker_request_execution_admission !== "not_granted"
      || value.target_worker_request_transport_status !== "not_invoked"
      || value.artifact_binding_policy !== "exact_successor_stdio_capability_artifact_hash"
      || value.evidence_binding_policy
        !== "exact_durable_local_cas_hash_references_without_recursive_lineage_reembedding"
      || value.process_model !== "fresh_single_request_process_no_pool_keepalive_or_multiplex"
      || canonicalJson(value.process_lifecycle) !== canonicalJson(PROCESS_LIFECYCLE)
      || value.request_frame_schema_version !== REPLAY_DECISION_HARNESS_WORKER_V10_REQUEST_FRAME_SCHEMA_VERSION
      || value.response_frame_schema_version !== REPLAY_DECISION_HARNESS_WORKER_V10_RESPONSE_FRAME_SCHEMA_VERSION
      || value.request_frame_encoding !== "canonical_json_utf8_lf_then_eof"
      || value.response_frame_encoding !== "canonical_json_utf8_lf_then_process_exit"
      || value.trailing_bytes_policy !== "no_non_whitespace_bytes_after_single_frame"
      || value.source_negative_probe_process_count !== 5 || value.worker_request_frame_count !== 0
      || value.worker_request_decode_count !== 0 || value.worker_process_count !== 0
      || value.blocker_set_policy
        !== "complete_deterministic_ordered_successor_artifact_transport_blockers"
      || canonicalJson(value.blockers) !== canonicalJson(ARTIFACT_TRANSPORT_BLOCKERS)
      || value.dispatch_occurrence !== "not_materialized" || value.transport_activation !== "blocked"
      || value.harness_invocation !== "forbidden" || value.response_admission !== "not_granted"
      || value.signal_authority !== "none" || value.order_authority !== "none"
      || value.economic_authority !== "none" || value.trial_authority !== "none") {
    throw new Error("unsupported successor execution artifact Transport authority")
  }
  for (const item of [value.contract_id, value.attempt_id, value.worker_id]) {
    requireText(item, "successor execution artifact Transport identity")
  }
  for (const item of [value.contract_key, value.contract_hash,
    value.source_successor_execution_stdio_probe_admission_hash,
    value.source_parent_canonical_file_sha256,
    value.source_successor_base_transport_contract_hash, value.source_successor_stdio_capability_hash,
    value.source_successor_negative_probe_receipt_hash, value.source_successor_execution_envelope_hash,
    value.target_logical_request_id, value.target_worker_request_hash, value.successor_process_artifact_hash]) {
    requireHash(item, "successor execution artifact Transport hash")
  }
  for (const item of [value.attempt_ordinal, value.lease_generation, value.max_request_frame_bytes,
    value.max_response_frame_bytes, value.timeout_ms]) {
    if (!Number.isSafeInteger(item) || item < 1) {
      throw new Error("successor execution artifact Transport numeric bound")
    }
  }
  const key = replayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContractKey({
    source_successor_execution_stdio_probe_admission_hash:
      value.source_successor_execution_stdio_probe_admission_hash,
    source_successor_base_transport_contract_hash: value.source_successor_base_transport_contract_hash,
    source_successor_stdio_capability_hash: value.source_successor_stdio_capability_hash,
    source_successor_negative_probe_receipt_hash: value.source_successor_negative_probe_receipt_hash,
    successor_process_artifact_hash: value.successor_process_artifact_hash,
    transport_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ARTIFACT_TRANSPORT_POLICY_VERSION,
  })
  const { contract_hash: contractHash, ...body } = value
  if (value.contract_key !== key
      || value.contract_id !== `decision-harness-worker-v10-successor-execution-artifact-transport-${key.slice(0, 24)}`
      || contractHash !== canonicalHash(body)) {
    throw new Error("successor execution artifact Transport identity or hash mismatch")
  }
}

export interface ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionContract {
  schema_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ADMISSION_CONTRACT_SCHEMA_VERSION
  contract_id: string
  contract_key: string
  contract_hash: string
  admission_policy_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ADMISSION_POLICY_VERSION
  scope: "successor_generation_zero_instance_execution_admission_contract"
  owner: "replay_runner_worker_v10_successor_execution_contract_registry"
  purpose: "freeze_future_attempt_bound_command_model_without_issuing_command"
  status: "successor_execution_authority_model_frozen_command_not_issued"
  source_successor_execution_stdio_probe_admission_hash: string
  source_parent_canonical_file_sha256: string
  source_artifact_bound_transport_contract_hash: string
  target_logical_request_id: string
  target_worker_request_hash: string
  target_worker_request_execution_admission: "not_granted"
  target_worker_request_transport_status: "not_invoked"
  attempt_id: string
  attempt_ordinal: number
  worker_id: string
  lease_generation: number
  execution_authority_model: "separate_attempt_bound_execution_admission_command"
  command_identity_policy:
    "hash_exact_request_attempt_generation_claim_lease_observation_process_artifact_and_transport_policy"
  command_reuse_policy: "forbidden_across_attempt_or_lease_generation"
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
  evidence_binding_policy:
    "exact_durable_local_cas_hash_references_without_recursive_lineage_reembedding"
  admission_command_instance_count: 0
  worker_process_count: 0
  request_frame_instance_count: 0
  request_decode_receipt_count: 0
  response_frame_instance_count: 0
  blocker_set_policy: "complete_deterministic_ordered_successor_execution_admission_blockers"
  blockers: typeof EXECUTION_ADMISSION_BLOCKERS
  transport_activation: "blocked"
  harness_invocation: "forbidden"
  response_admission: "not_granted"
  signal_authority: "none"
  order_authority: "none"
  economic_authority: "none"
  trial_authority: "none"
}

export type ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionContractBody = Omit<
  ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionContract,
  "contract_hash"
>

export function replayDecisionHarnessWorkerV10SuccessorExecutionAdmissionContractKey(input: {
  source_successor_execution_stdio_probe_admission_hash: string
  source_artifact_bound_transport_contract_hash: string
  admission_policy_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ADMISSION_POLICY_VERSION
}): string {
  requireHash(input.source_successor_execution_stdio_probe_admission_hash,
    "successor Execution Admission source Stdio Probe Admission")
  requireHash(input.source_artifact_bound_transport_contract_hash,
    "successor Execution Admission source artifact Transport")
  if (input.admission_policy_version
      !== REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ADMISSION_POLICY_VERSION) {
    throw new Error("unsupported successor Execution Admission policy")
  }
  return canonicalHash(input)
}

export function createReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionContract(
  body: ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionContractBody,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionContract {
  const value = { ...structuredClone(body), contract_hash: canonicalHash(body) }
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionContract(value)
  return value
}

export function assertReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionContract(
  value: ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionContract,
): void {
  assertExactFields(value, EXECUTION_ADMISSION_FIELDS, "successor Execution Admission")
  if (value.schema_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ADMISSION_CONTRACT_SCHEMA_VERSION
      || value.admission_policy_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ADMISSION_POLICY_VERSION
      || value.scope !== "successor_generation_zero_instance_execution_admission_contract"
      || value.owner !== "replay_runner_worker_v10_successor_execution_contract_registry"
      || value.purpose !== "freeze_future_attempt_bound_command_model_without_issuing_command"
      || value.status !== "successor_execution_authority_model_frozen_command_not_issued"
      || value.target_worker_request_execution_admission !== "not_granted"
      || value.target_worker_request_transport_status !== "not_invoked"
      || value.execution_authority_model !== "separate_attempt_bound_execution_admission_command"
      || value.command_identity_policy
        !== "hash_exact_request_attempt_generation_claim_lease_observation_process_artifact_and_transport_policy"
      || value.command_reuse_policy !== "forbidden_across_attempt_or_lease_generation"
      || canonicalJson(value.future_command_required_bindings) !== canonicalJson(FUTURE_COMMAND_BINDINGS)
      || value.evidence_binding_policy
        !== "exact_durable_local_cas_hash_references_without_recursive_lineage_reembedding"
      || value.admission_command_instance_count !== 0 || value.worker_process_count !== 0
      || value.request_frame_instance_count !== 0 || value.request_decode_receipt_count !== 0
      || value.response_frame_instance_count !== 0
      || value.blocker_set_policy
        !== "complete_deterministic_ordered_successor_execution_admission_blockers"
      || canonicalJson(value.blockers) !== canonicalJson(EXECUTION_ADMISSION_BLOCKERS)
      || value.transport_activation !== "blocked" || value.harness_invocation !== "forbidden"
      || value.response_admission !== "not_granted" || value.signal_authority !== "none"
      || value.order_authority !== "none" || value.economic_authority !== "none"
      || value.trial_authority !== "none") {
    throw new Error("unsupported successor Execution Admission authority")
  }
  for (const item of [value.contract_id, value.attempt_id, value.worker_id]) {
    requireText(item, "successor Execution Admission identity")
  }
  for (const item of [value.contract_key, value.contract_hash,
    value.source_successor_execution_stdio_probe_admission_hash,
    value.source_parent_canonical_file_sha256,
    value.source_artifact_bound_transport_contract_hash, value.target_logical_request_id,
    value.target_worker_request_hash]) {
    requireHash(item, "successor Execution Admission hash")
  }
  for (const item of [value.attempt_ordinal, value.lease_generation]) {
    if (!Number.isSafeInteger(item) || item < 1) throw new Error("successor Execution Admission generation")
  }
  const key = replayDecisionHarnessWorkerV10SuccessorExecutionAdmissionContractKey({
    source_successor_execution_stdio_probe_admission_hash:
      value.source_successor_execution_stdio_probe_admission_hash,
    source_artifact_bound_transport_contract_hash: value.source_artifact_bound_transport_contract_hash,
    admission_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ADMISSION_POLICY_VERSION,
  })
  const { contract_hash: contractHash, ...body } = value
  if (value.contract_key !== key
      || value.contract_id !== `decision-harness-worker-v10-successor-execution-admission-${key.slice(0, 24)}`
      || contractHash !== canonicalHash(body)) {
    throw new Error("successor Execution Admission identity or hash mismatch")
  }
}

export interface ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission {
  schema_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_CONTRACT_ADMISSION_SCHEMA_VERSION
  admission_id: string
  admission_ref: string
  admission_key: string
  admission_hash: string
  admission_policy_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_CONTRACT_ADMISSION_POLICY_VERSION
  scope: "one_successor_artifact_bound_transport_and_zero_instance_execution_admission_contract"
  owner: "replay_runner_worker_v10_successor_execution_contract_registry"
  purpose: "rebuild_envelope_bound_execution_contracts_without_issuing_command_or_starting_worker"
  status: "successor_execution_contracts_admitted_command_not_issued"
  source_successor_execution_stdio_probe_admission_hash: string
  source_parent_canonical_file_sha256: string
  source_predecessor_artifact_bound_transport_contract_hash: string
  source_predecessor_execution_admission_contract_hash: string
  successor_artifact_bound_transport_contract_hash: string
  successor_artifact_bound_transport_contract:
    ReplayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContract
  successor_execution_admission_contract_hash: string
  successor_execution_admission_contract:
    ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionContract
  successor_base_transport_contract_hash: string
  successor_stdio_capability_hash: string
  successor_negative_probe_receipt_hash: string
  successor_execution_envelope_hash: string
  successor_process_artifact_hash: string
  target_logical_request_id: string
  target_worker_request_hash: string
  target_worker_request_execution_admission: "not_granted"
  target_worker_request_transport_status: "not_invoked"
  attempt_id: string
  attempt_ordinal: number
  worker_id: string
  predecessor_lease_generation: number
  successor_lease_generation: number
  artifact_transport_identity_policy:
    "fresh_identity_per_exact_envelope_stdio_capability_and_negative_probe_receipt"
  artifact_byte_parity_policy:
    "identical_process_artifact_hash_does_not_permit_transport_contract_identity_reuse"
  execution_admission_identity_policy: "fresh_identity_per_exact_artifact_bound_transport_contract"
  request_marker_policy: "worker_request_v10_remains_not_granted_and_not_invoked"
  command_issue_policy: "separate_future_attempt_bound_command_required"
  evidence_binding_policy:
    "exact_durable_local_cas_hash_references_without_recursive_lineage_reembedding"
  parent_validation_policy:
    "durable_parent_validation_receipt_binds_self_hash_and_canonical_file_sha256"
  registry_durability: "replay_local_immutable_cas_regular_file_canonical_json"
  successor_base_transport_contract_count: 1
  successor_stdio_capability_count: 1
  successor_negative_probe_receipt_count: 1
  successor_negative_probe_process_count: 5
  successor_artifact_bound_transport_contract_count: 1
  successor_execution_admission_contract_count: 1
  successor_execution_admission_command_count: 0
  successor_process_launch_intent_count: 0
  successor_authority_capsule_count: 0
  successor_spawn_revalidation_count: 0
  successor_worker_process_count: 0
  successor_worker_request_frame_count: 0
  successor_worker_request_decode_count: 0
  second_response_count: 0
  second_schedule_admission_count: 0
  reproducibility_pair_count: 0
  harness_receipt_count: 0
  transport_authority: "artifact_bound_contract_frozen_activation_blocked"
  command_authority: "contract_frozen_zero_instance_not_issued"
  worker_process_authority: "none"
  blockers: typeof BLOCKERS
  decision_output_authority: "first_schedule_matched_claim_only_successor_execution_contracts_admitted"
  signal_authority: "none"
  order_authority: "none"
  economic_authority: "none"
  trial_authority: "none"
}

export type ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmissionBody = Omit<
  ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission,
  "admission_hash"
>

export function replayDecisionHarnessWorkerV10SuccessorExecutionContractAdmissionKey(input: {
  source_successor_execution_stdio_probe_admission_hash: string
  successor_artifact_bound_transport_contract_hash: string
  successor_execution_admission_contract_hash: string
  admission_policy_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_CONTRACT_ADMISSION_POLICY_VERSION
}): string {
  for (const item of [input.source_successor_execution_stdio_probe_admission_hash,
    input.successor_artifact_bound_transport_contract_hash,
    input.successor_execution_admission_contract_hash]) {
    requireHash(item, "successor execution Contract admission natural key hash")
  }
  if (input.admission_policy_version
      !== REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_CONTRACT_ADMISSION_POLICY_VERSION) {
    throw new Error("unsupported Worker v10 successor execution Contract admission natural key")
  }
  return canonicalHash(input)
}

export function createReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission(
  body: ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmissionBody,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission {
  const value = { ...structuredClone(body), admission_hash: canonicalHash(body) }
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission(value)
  return value
}

export function assertReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission(
  value: ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission,
): void {
  assertFields(value)
  if (value.schema_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_CONTRACT_ADMISSION_SCHEMA_VERSION
      || value.admission_policy_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_CONTRACT_ADMISSION_POLICY_VERSION
      || value.scope
        !== "one_successor_artifact_bound_transport_and_zero_instance_execution_admission_contract"
      || value.owner !== "replay_runner_worker_v10_successor_execution_contract_registry"
      || value.purpose
        !== "rebuild_envelope_bound_execution_contracts_without_issuing_command_or_starting_worker"
      || value.status !== "successor_execution_contracts_admitted_command_not_issued"
      || value.artifact_transport_identity_policy
        !== "fresh_identity_per_exact_envelope_stdio_capability_and_negative_probe_receipt"
      || value.artifact_byte_parity_policy
        !== "identical_process_artifact_hash_does_not_permit_transport_contract_identity_reuse"
      || value.execution_admission_identity_policy
        !== "fresh_identity_per_exact_artifact_bound_transport_contract"
      || value.request_marker_policy !== "worker_request_v10_remains_not_granted_and_not_invoked"
      || value.command_issue_policy !== "separate_future_attempt_bound_command_required"
      || value.evidence_binding_policy
        !== "exact_durable_local_cas_hash_references_without_recursive_lineage_reembedding"
      || value.parent_validation_policy
        !== "durable_parent_validation_receipt_binds_self_hash_and_canonical_file_sha256"
      || value.registry_durability !== "replay_local_immutable_cas_regular_file_canonical_json"
      || value.successor_base_transport_contract_count !== 1 || value.successor_stdio_capability_count !== 1
      || value.successor_negative_probe_receipt_count !== 1
      || value.successor_negative_probe_process_count !== 5
      || value.successor_artifact_bound_transport_contract_count !== 1
      || value.successor_execution_admission_contract_count !== 1
      || value.successor_execution_admission_command_count !== 0
      || value.successor_process_launch_intent_count !== 0 || value.successor_authority_capsule_count !== 0
      || value.successor_spawn_revalidation_count !== 0 || value.successor_worker_process_count !== 0
      || value.successor_worker_request_frame_count !== 0 || value.successor_worker_request_decode_count !== 0
      || value.second_response_count !== 0 || value.second_schedule_admission_count !== 0
      || value.reproducibility_pair_count !== 0 || value.harness_receipt_count !== 0
      || value.transport_authority !== "artifact_bound_contract_frozen_activation_blocked"
      || value.command_authority !== "contract_frozen_zero_instance_not_issued"
      || value.worker_process_authority !== "none" || canonicalJson(value.blockers) !== canonicalJson(BLOCKERS)
      || value.decision_output_authority
        !== "first_schedule_matched_claim_only_successor_execution_contracts_admitted"
      || value.signal_authority !== "none" || value.order_authority !== "none"
      || value.economic_authority !== "none" || value.trial_authority !== "none") {
    throw new Error("unsupported Worker v10 successor execution Contract admission")
  }
  for (const item of [value.admission_id, value.admission_ref, value.attempt_id, value.worker_id]) {
    requireText(item, "Worker v10 successor execution Contract admission identity")
  }
  for (const item of [value.admission_key, value.admission_hash,
    value.source_successor_execution_stdio_probe_admission_hash,
    value.source_parent_canonical_file_sha256,
    value.source_predecessor_artifact_bound_transport_contract_hash,
    value.source_predecessor_execution_admission_contract_hash,
    value.successor_artifact_bound_transport_contract_hash,
    value.successor_execution_admission_contract_hash, value.successor_base_transport_contract_hash,
    value.successor_stdio_capability_hash, value.successor_negative_probe_receipt_hash,
    value.successor_execution_envelope_hash, value.successor_process_artifact_hash,
    value.target_logical_request_id, value.target_worker_request_hash]) {
    requireHash(item, "Worker v10 successor execution Contract admission hash")
  }
  if (!Number.isSafeInteger(value.attempt_ordinal) || value.attempt_ordinal < 1
      || !Number.isSafeInteger(value.predecessor_lease_generation)
      || value.predecessor_lease_generation < 1
      || value.successor_lease_generation !== value.predecessor_lease_generation + 1) {
    throw new Error("Worker v10 successor execution Contract admission generation")
  }
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContract(
    value.successor_artifact_bound_transport_contract,
  )
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionContract(
    value.successor_execution_admission_contract,
  )
  const transport = value.successor_artifact_bound_transport_contract
  const execution = value.successor_execution_admission_contract
  const key = replayDecisionHarnessWorkerV10SuccessorExecutionContractAdmissionKey({
    source_successor_execution_stdio_probe_admission_hash:
      value.source_successor_execution_stdio_probe_admission_hash,
    successor_artifact_bound_transport_contract_hash:
      value.successor_artifact_bound_transport_contract_hash,
    successor_execution_admission_contract_hash: value.successor_execution_admission_contract_hash,
    admission_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_CONTRACT_ADMISSION_POLICY_VERSION,
  })
  if (value.admission_key !== key
      || value.admission_id !== `decision-harness-worker-v10-successor-execution-contract-${key.slice(0, 24)}`
      || value.admission_ref
        !== `admission://replay-decision-harness-worker-v10-successor-execution-contract/${key.slice(0, 24)}`
      || value.source_predecessor_artifact_bound_transport_contract_hash
        === value.successor_artifact_bound_transport_contract_hash
      || value.source_predecessor_execution_admission_contract_hash
        === value.successor_execution_admission_contract_hash
      || value.successor_artifact_bound_transport_contract_hash !== transport.contract_hash
      || value.successor_execution_admission_contract_hash !== execution.contract_hash
      || execution.source_artifact_bound_transport_contract_hash !== transport.contract_hash
      || value.source_successor_execution_stdio_probe_admission_hash
        !== transport.source_successor_execution_stdio_probe_admission_hash
      || value.source_successor_execution_stdio_probe_admission_hash
        !== execution.source_successor_execution_stdio_probe_admission_hash
      || value.source_parent_canonical_file_sha256 !== transport.source_parent_canonical_file_sha256
      || value.source_parent_canonical_file_sha256 !== execution.source_parent_canonical_file_sha256
      || value.successor_base_transport_contract_hash
        !== transport.source_successor_base_transport_contract_hash
      || value.successor_stdio_capability_hash !== transport.source_successor_stdio_capability_hash
      || value.successor_negative_probe_receipt_hash
        !== transport.source_successor_negative_probe_receipt_hash
      || value.successor_execution_envelope_hash !== transport.source_successor_execution_envelope_hash
      || value.successor_process_artifact_hash !== transport.successor_process_artifact_hash
      || value.target_logical_request_id !== transport.target_logical_request_id
      || value.target_worker_request_hash !== transport.target_worker_request_hash
      || value.attempt_id !== transport.attempt_id || value.attempt_id !== execution.attempt_id
      || value.attempt_ordinal !== transport.attempt_ordinal
      || value.attempt_ordinal !== execution.attempt_ordinal
      || value.worker_id !== transport.worker_id || value.worker_id !== execution.worker_id
      || value.successor_lease_generation !== transport.lease_generation
      || value.successor_lease_generation !== execution.lease_generation
      || value.target_worker_request_execution_admission !== "not_granted"
      || value.target_worker_request_transport_status !== "not_invoked") {
    throw new Error("Worker v10 successor execution Contract admission lineage drift")
  }
  const { admission_hash: admissionHash, ...body } = value
  if (admissionHash !== canonicalHash(body)) {
    throw new Error("Worker v10 successor execution Contract admission hash mismatch")
  }
}

const PROCESS_LIFECYCLE = ["spawn_exact_successor_artifact", "write_one_request_frame", "close_stdin",
  "read_one_response_frame", "await_process_exit"] as const
const FUTURE_COMMAND_BINDINGS = ["worker_request_hash", "logical_request_id", "attempt_id",
  "attempt_ordinal", "worker_id", "lease_generation", "dispatch_claim_hash",
  "current_lease_observation_hash", "successor_process_artifact_hash", "transport_contract_hash"] as const
const ARTIFACT_TRANSPORT_FIELDS = ["artifact_binding_policy", "attempt_id", "attempt_ordinal",
  "blocker_set_policy", "blockers", "contract_hash", "contract_id", "contract_key", "dispatch_occurrence",
  "economic_authority", "evidence_binding_policy", "harness_invocation", "lease_generation",
  "max_request_frame_bytes", "max_response_frame_bytes", "order_authority", "owner", "process_lifecycle",
  "process_model", "purpose", "request_frame_encoding", "request_frame_schema_version", "response_admission",
  "response_frame_encoding", "response_frame_schema_version", "schema_version", "scope", "signal_authority",
  "source_negative_probe_process_count", "source_parent_canonical_file_sha256",
  "source_successor_base_transport_contract_hash",
  "source_successor_execution_envelope_hash", "source_successor_execution_stdio_probe_admission_hash",
  "source_successor_negative_probe_receipt_hash", "source_successor_stdio_capability_hash", "status",
  "successor_process_artifact_hash", "target_logical_request_id", "target_worker_request_execution_admission",
  "target_worker_request_hash", "target_worker_request_transport_status", "timeout_ms", "trailing_bytes_policy",
  "transport_activation", "transport_policy_version", "trial_authority", "worker_id", "worker_process_count",
  "worker_request_decode_count", "worker_request_frame_count"].sort()
const EXECUTION_ADMISSION_FIELDS = ["admission_command_instance_count", "admission_policy_version",
  "attempt_id", "attempt_ordinal", "blocker_set_policy", "blockers", "command_identity_policy",
  "command_reuse_policy", "contract_hash", "contract_id", "contract_key", "economic_authority",
  "evidence_binding_policy", "execution_authority_model", "future_command_required_bindings",
  "harness_invocation", "lease_generation", "order_authority", "owner", "purpose",
  "request_decode_receipt_count", "request_frame_instance_count", "response_admission",
  "response_frame_instance_count", "schema_version", "scope", "signal_authority",
  "source_artifact_bound_transport_contract_hash", "source_parent_canonical_file_sha256",
  "source_successor_execution_stdio_probe_admission_hash",
  "status", "target_logical_request_id", "target_worker_request_execution_admission",
  "target_worker_request_hash", "target_worker_request_transport_status", "transport_activation",
  "trial_authority", "worker_id", "worker_process_count"].sort()

const FIELDS = ["admission_hash", "admission_id", "admission_key", "admission_policy_version",
  "admission_ref", "artifact_byte_parity_policy", "artifact_transport_identity_policy", "attempt_id",
  "attempt_ordinal", "blockers", "command_authority", "command_issue_policy", "decision_output_authority",
  "economic_authority", "evidence_binding_policy", "execution_admission_identity_policy",
  "harness_receipt_count", "order_authority",
  "owner", "parent_validation_policy", "predecessor_lease_generation", "purpose", "registry_durability",
  "reproducibility_pair_count",
  "request_marker_policy", "schema_version", "scope", "second_response_count",
  "second_schedule_admission_count", "signal_authority", "source_predecessor_artifact_bound_transport_contract_hash",
  "source_parent_canonical_file_sha256", "source_predecessor_execution_admission_contract_hash",
  "source_successor_execution_stdio_probe_admission_hash", "status",
  "successor_artifact_bound_transport_contract", "successor_artifact_bound_transport_contract_count",
  "successor_artifact_bound_transport_contract_hash",
  "successor_authority_capsule_count", "successor_base_transport_contract_count",
  "successor_execution_admission_command_count",
  "successor_execution_admission_contract", "successor_execution_admission_contract_count",
  "successor_execution_admission_contract_hash",
  "successor_execution_envelope_hash", "successor_lease_generation", "successor_negative_probe_process_count",
  "successor_negative_probe_receipt_count", "successor_negative_probe_receipt_hash",
  "successor_process_artifact_hash", "successor_process_launch_intent_count",
  "successor_spawn_revalidation_count", "successor_stdio_capability_count", "successor_worker_process_count",
  "successor_stdio_capability_hash", "successor_base_transport_contract_hash",
  "successor_worker_request_decode_count", "successor_worker_request_frame_count", "target_logical_request_id",
  "target_worker_request_execution_admission", "target_worker_request_hash",
  "target_worker_request_transport_status", "transport_authority", "trial_authority", "worker_id",
  "worker_process_authority"].sort()

function assertFields(value: object): void {
  if (canonicalJson(Object.keys(value).sort()) !== canonicalJson(FIELDS)) {
    throw new Error("Worker v10 successor execution Contract admission fields drift")
  }
}

function assertExactFields(value: object, fields: string[], label: string): void {
  if (canonicalJson(Object.keys(value).sort()) !== canonicalJson(fields)) {
    throw new Error(`${label} fields drift`)
  }
}
