import { canonicalHash, canonicalJson } from "./replay-contracts"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_ACTIVATED_STDIO_ARTIFACT_FILE,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_ENV,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_FIELDS,
  assertReplayDecisionHarnessWorkerV10ActivatedStdioCapability,
  type ReplayDecisionHarnessWorkerV10ActivatedStdioCapability,
} from "./replay-decision-harness-worker-v10-activated-stdio-capability"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_FIELDS,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_FRAME_FIELDS,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_FRAME_SCHEMA_VERSION,
} from "./replay-decision-harness-worker-v10-authority-frame-build-contract"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
} from "./replay-cross-source-ordering"

export const REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_TRANSPORT_CONTRACT_SCHEMA_VERSION =
  "trade.rd-replay-decision-harness-worker-v10-successor-transport-contract.v3" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_TRANSPORT_POLICY_VERSION =
  "rd-replay-harness-worker-v10-fresh-single-request-successor-transport-v3" as const

export const REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_RECEIPT_BINDINGS = [
  "authority_capsule_hash", "execution_admission_command_hash", "process_artifact_hash",
  "process_launch_intent_hash", "runtime_executable_hash", "spawn_boundary_revalidation_hash",
  "transport_contract_hash", "worker_request_hash",
] as const

export type ReplayDecisionHarnessWorkerV10AuthorityTransportBlocker =
  | "successor_execution_admission_command_not_issued"
  | "successor_process_launch_intent_not_issued"
  | "fresh_spawn_boundary_revalidation_not_materialized"
  | "attempt_bound_process_launch_receipt_not_materialized"
  | "authority_frame_write_decode_read_and_admission_not_materialized"

export interface ReplayDecisionHarnessWorkerV10AuthorityTransportContract {
  schema_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_TRANSPORT_CONTRACT_SCHEMA_VERSION
  contract_id: string
  contract_hash: string
  contract_key: string
  transport_policy_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_TRANSPORT_POLICY_VERSION
  scope: "activated_artifact_bound_authority_frame_zero_process_transport_contract"
  owner: "replay_runner_worker_v10_authority_transport_registry"
  purpose: "bind_activated_artifact_frame_v2_capsule_derivation_and_future_receipt_requirements"
  status: "activated_artifact_bound_authority_issuance_blocked_zero_process"
  source_activated_stdio_capability_id: string
  source_activated_stdio_capability_hash: string
  source_activated_stdio_capability: ReplayDecisionHarnessWorkerV10ActivatedStdioCapability
  source_authority_frame_build_contract_hash: string
  source_predecessor_transport_contract_id: string
  source_predecessor_transport_contract_hash: string
  source_execution_envelope_id: string
  source_execution_envelope_hash: string
  target_logical_request_id: string
  target_worker_request_hash: string
  target_request_execution_admission: "not_granted"
  target_request_transport_status: "not_invoked"
  immutable_request_policy: "request_v10_markers_remain_non_executable_outer_authority_is_separate"
  activated_process_artifact_hash: string
  activated_process_artifact_file_name:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_ACTIVATED_STDIO_ARTIFACT_FILE
  artifact_binding_policy: "transport_v3_process_hash_is_exact_activated_stdio_capability_artifact"
  predecessor_transport_relation: "r4_121_transport_v2_and_r4_120_artifact_remain_immutable_historical"
  authority_frame_build_relation: "r4_129_contract_is_exact_schema_and_build_policy_parent"
  process_model: "fresh_single_request_process_no_pool_keepalive_or_multiplex"
  process_lifecycle: [
    "commit_successor_command_and_intent",
    "derive_authority_capsule_from_exact_committed_authority",
    "revalidate_current_attempt_at_spawn_boundary",
    "materialize_and_verify_exact_activated_artifact",
    "spawn_with_fixed_environment_plus_one_authority_capsule",
    "write_one_authority_request_frame_then_close_stdin",
    "read_one_authority_response_frame_then_await_exit",
    "admit_response_only_after_receipt_and_echo_validation",
  ]
  request_frame_schema_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_SCHEMA_VERSION
  response_frame_schema_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_FRAME_SCHEMA_VERSION
  request_frame_fields: typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_FIELDS
  response_frame_fields: typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_FRAME_FIELDS
  frame_encoding: "canonical_json_utf8_lf_single_frame_per_direction"
  malformed_utf8_policy: "fatal_no_replacement_decoding"
  trailing_bytes_policy: "no_non_whitespace_bytes_after_single_frame"
  timeout_ms: number
  max_request_frame_bytes: number
  max_response_frame_bytes: number
  authority_capsule_environment_variable: typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_ENV
  authority_capsule_fields: typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_FIELDS
  authority_capsule_encoding: "canonical_json_utf8_environment_value"
  authority_capsule_static_bindings:
    "transport_artifact_envelope_logical_request_and_worker_request_from_this_contract"
  authority_capsule_command_binding: "future_successor_command_hash_after_exact_command_commit"
  authority_capsule_intent_binding: "future_successor_intent_hash_derived_at_spawn_not_stored_in_intent_payload"
  authority_capsule_derivation:
    "canonical_object_from_exact_contract_artifact_envelope_command_intent_and_request_hashes"
  authority_capsule_hash_time: "after_intent_commit_before_spawn_boundary_revalidation"
  authority_capsule_reuse_policy: "forbidden_across_command_intent_attempt_or_lease_generation"
  environment_policy: "tz_utc_lang_c_lc_all_c_plus_exact_single_authority_capsule_no_inherited_values"
  response_echo_policy:
    "response_frame_v2_must_echo_transport_artifact_envelope_command_intent_request_frame_and_worker_request"
  process_receipt_required_bindings:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_RECEIPT_BINDINGS
  process_receipt_schema_status: "not_materialized_exact_process_identity_fields_pending"
  blocker_set_policy: "complete_deterministic_ordered_post_transport_pre_dispatch_blockers"
  blockers: ReplayDecisionHarnessWorkerV10AuthorityTransportBlocker[]
  activated_stdio_artifact_count: 1
  authority_transport_contract_instance_count: 1
  successor_execution_admission_command: null
  successor_execution_admission_command_count: 0
  successor_process_launch_intent: null
  successor_process_launch_intent_count: 0
  authority_capsule_instance: null
  authority_capsule_instance_count: 0
  spawn_boundary_revalidation_receipt: null
  process_launch_receipt: null
  process_launch_receipt_count: 0
  admitted_process_instance: null
  admitted_process_instance_count: 0
  request_frame_instances: []
  request_frame_instance_count: 0
  request_write_receipts: []
  request_write_receipt_count: 0
  request_decode_receipts: []
  request_decode_receipt_count: 0
  response_frame_instances: []
  response_frame_instance_count: 0
  response_read_receipts: []
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

export type ReplayDecisionHarnessWorkerV10AuthorityTransportContractBody = Omit<
  ReplayDecisionHarnessWorkerV10AuthorityTransportContract,
  "contract_hash"
>

export function replayDecisionHarnessWorkerV10AuthorityTransportBlockers():
ReplayDecisionHarnessWorkerV10AuthorityTransportBlocker[] {
  return [
    "successor_execution_admission_command_not_issued",
    "successor_process_launch_intent_not_issued",
    "fresh_spawn_boundary_revalidation_not_materialized",
    "attempt_bound_process_launch_receipt_not_materialized",
    "authority_frame_write_decode_read_and_admission_not_materialized",
  ]
}

export function replayDecisionHarnessWorkerV10AuthorityTransportContractKey(input: {
  activated_stdio_capability_hash: string
  execution_envelope_hash: string
  transport_policy_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_TRANSPORT_POLICY_VERSION
}): string {
  requireHash(input.activated_stdio_capability_hash, "Authority Transport Capability hash")
  requireHash(input.execution_envelope_hash, "Authority Transport Envelope hash")
  if (input.transport_policy_version !== REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_TRANSPORT_POLICY_VERSION) {
    throw new Error("unsupported Authority Transport policy")
  }
  return canonicalHash(input)
}

export function createReplayDecisionHarnessWorkerV10AuthorityTransportContract(
  body: ReplayDecisionHarnessWorkerV10AuthorityTransportContractBody,
): ReplayDecisionHarnessWorkerV10AuthorityTransportContract {
  const value = { ...structuredClone(body), contract_hash: canonicalHash(body) }
  assertReplayDecisionHarnessWorkerV10AuthorityTransportContract(value)
  return value
}

export function assertReplayDecisionHarnessWorkerV10AuthorityTransportContract(
  value: ReplayDecisionHarnessWorkerV10AuthorityTransportContract,
): void {
  assertFields(value)
  if (value.schema_version !== REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_TRANSPORT_CONTRACT_SCHEMA_VERSION
      || value.transport_policy_version !== REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_TRANSPORT_POLICY_VERSION
      || value.scope !== "activated_artifact_bound_authority_frame_zero_process_transport_contract"
      || value.owner !== "replay_runner_worker_v10_authority_transport_registry"
      || value.purpose
        !== "bind_activated_artifact_frame_v2_capsule_derivation_and_future_receipt_requirements"
      || value.status !== "activated_artifact_bound_authority_issuance_blocked_zero_process"
      || value.target_request_execution_admission !== "not_granted"
      || value.target_request_transport_status !== "not_invoked"
      || value.immutable_request_policy
        !== "request_v10_markers_remain_non_executable_outer_authority_is_separate"
      || value.activated_process_artifact_file_name
        !== REPLAY_DECISION_HARNESS_WORKER_V10_ACTIVATED_STDIO_ARTIFACT_FILE
      || value.artifact_binding_policy
        !== "transport_v3_process_hash_is_exact_activated_stdio_capability_artifact"
      || value.predecessor_transport_relation
        !== "r4_121_transport_v2_and_r4_120_artifact_remain_immutable_historical"
      || value.authority_frame_build_relation !== "r4_129_contract_is_exact_schema_and_build_policy_parent"
      || value.process_model !== "fresh_single_request_process_no_pool_keepalive_or_multiplex"
      || canonicalJson(value.process_lifecycle) !== canonicalJson(PROCESS_LIFECYCLE)
      || value.request_frame_schema_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_SCHEMA_VERSION
      || value.response_frame_schema_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_FRAME_SCHEMA_VERSION
      || canonicalJson(value.request_frame_fields)
        !== canonicalJson(REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_FIELDS)
      || canonicalJson(value.response_frame_fields)
        !== canonicalJson(REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_FRAME_FIELDS)
      || value.frame_encoding !== "canonical_json_utf8_lf_single_frame_per_direction"
      || value.malformed_utf8_policy !== "fatal_no_replacement_decoding"
      || value.trailing_bytes_policy !== "no_non_whitespace_bytes_after_single_frame"
      || value.authority_capsule_environment_variable !== REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_ENV
      || canonicalJson(value.authority_capsule_fields)
        !== canonicalJson(REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_FIELDS)
      || value.authority_capsule_encoding !== "canonical_json_utf8_environment_value"
      || value.authority_capsule_static_bindings
        !== "transport_artifact_envelope_logical_request_and_worker_request_from_this_contract"
      || value.authority_capsule_command_binding !== "future_successor_command_hash_after_exact_command_commit"
      || value.authority_capsule_intent_binding
        !== "future_successor_intent_hash_derived_at_spawn_not_stored_in_intent_payload"
      || value.authority_capsule_derivation
        !== "canonical_object_from_exact_contract_artifact_envelope_command_intent_and_request_hashes"
      || value.authority_capsule_hash_time !== "after_intent_commit_before_spawn_boundary_revalidation"
      || value.authority_capsule_reuse_policy !== "forbidden_across_command_intent_attempt_or_lease_generation"
      || value.environment_policy
        !== "tz_utc_lang_c_lc_all_c_plus_exact_single_authority_capsule_no_inherited_values"
      || value.response_echo_policy
        !== "response_frame_v2_must_echo_transport_artifact_envelope_command_intent_request_frame_and_worker_request"
      || canonicalJson(value.process_receipt_required_bindings)
        !== canonicalJson(REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_RECEIPT_BINDINGS)
      || value.process_receipt_schema_status !== "not_materialized_exact_process_identity_fields_pending"
      || value.blocker_set_policy !== "complete_deterministic_ordered_post_transport_pre_dispatch_blockers"
      || canonicalJson(value.blockers) !== canonicalJson(replayDecisionHarnessWorkerV10AuthorityTransportBlockers())
      || value.activated_stdio_artifact_count !== 1 || value.authority_transport_contract_instance_count !== 1
      || value.successor_execution_admission_command !== null
      || value.successor_execution_admission_command_count !== 0
      || value.successor_process_launch_intent !== null || value.successor_process_launch_intent_count !== 0
      || value.authority_capsule_instance !== null || value.authority_capsule_instance_count !== 0
      || value.spawn_boundary_revalidation_receipt !== null || value.process_launch_receipt !== null
      || value.process_launch_receipt_count !== 0 || value.admitted_process_instance !== null
      || value.admitted_process_instance_count !== 0 || value.request_frame_instances.length !== 0
      || value.request_frame_instance_count !== 0 || value.request_write_receipts.length !== 0
      || value.request_write_receipt_count !== 0 || value.request_decode_receipts.length !== 0
      || value.request_decode_receipt_count !== 0 || value.response_frame_instances.length !== 0
      || value.response_frame_instance_count !== 0 || value.response_read_receipts.length !== 0
      || value.response_read_receipt_count !== 0 || value.dispatch_occurrence !== "not_materialized"
      || value.transport_activation !== "blocked" || value.harness_invocation !== "forbidden"
      || value.response_admission !== "not_granted" || value.decision_output_authority !== "none"
      || value.signal_authority !== "none" || value.order_authority !== "none"
      || value.economic_authority !== "none" || value.trial_authority !== "none") {
    throw new Error("unsupported Authority Transport Contract authority")
  }
  for (const item of [value.contract_id, value.source_activated_stdio_capability_id,
    value.source_predecessor_transport_contract_id, value.source_execution_envelope_id]) {
    requireText(item, "Authority Transport Contract identity")
  }
  for (const item of [value.contract_hash, value.contract_key, value.source_activated_stdio_capability_hash,
    value.source_authority_frame_build_contract_hash, value.source_predecessor_transport_contract_hash,
    value.source_execution_envelope_hash, value.target_logical_request_id, value.target_worker_request_hash,
    value.activated_process_artifact_hash]) {
    requireHash(item, "Authority Transport Contract hash")
  }
  for (const bound of [value.timeout_ms, value.max_request_frame_bytes, value.max_response_frame_bytes]) {
    if (!Number.isSafeInteger(bound) || bound < 1) throw new Error("Authority Transport resource bound")
  }
  assertReplayDecisionHarnessWorkerV10ActivatedStdioCapability(value.source_activated_stdio_capability)
  const capability = value.source_activated_stdio_capability
  const frameBuild = capability.source_authority_frame_build_contract
  const gate = frameBuild.source_launch_readiness_gate
  const oldCommand = gate.source_process_launch_intent.source_execution_admission_command
  const predecessor = oldCommand.source_clock_binding.source_registry_provenance.source_pre_issue_bundle
    .source_execution_admission_contract.source_successor_transport_contract
  const oldTransport = predecessor.source_negative_probe_receipt.source_stdio_capability.source_transport_contract
  const envelope = oldTransport.source_execution_envelope
  const request = oldTransport.target_worker_request
  const expectedKey = replayDecisionHarnessWorkerV10AuthorityTransportContractKey({
    activated_stdio_capability_hash: capability.capability_hash,
    execution_envelope_hash: envelope.envelope_hash,
    transport_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_TRANSPORT_POLICY_VERSION,
  })
  if (value.contract_key !== expectedKey
      || value.contract_id !== `decision-harness-worker-v10-authority-transport-${expectedKey.slice(0, 24)}`
      || value.source_activated_stdio_capability_id !== capability.capability_id
      || value.source_activated_stdio_capability_hash !== capability.capability_hash
      || value.source_authority_frame_build_contract_hash !== frameBuild.contract_hash
      || value.source_predecessor_transport_contract_id !== predecessor.contract_id
      || value.source_predecessor_transport_contract_hash !== predecessor.contract_hash
      || value.source_execution_envelope_id !== envelope.envelope_id
      || value.source_execution_envelope_hash !== envelope.envelope_hash
      || value.target_logical_request_id !== request.logical_request_id
      || value.target_worker_request_hash !== request.request_hash
      || value.target_request_execution_admission !== request.execution_admission
      || value.target_request_transport_status !== request.transport_status
      || value.activated_process_artifact_hash !== capability.artifact.sha256
      || value.activated_process_artifact_hash === predecessor.successor_process_artifact_hash
      || value.timeout_ms !== capability.timeout_ms
      || value.max_request_frame_bytes !== capability.max_request_frame_bytes
      || value.max_response_frame_bytes !== capability.max_response_frame_bytes) {
    throw new Error("Authority Transport Contract parent or artifact binding drift")
  }
  const { contract_hash: contractHash, ...body } = value
  if (contractHash !== canonicalHash(body)) throw new Error("Authority Transport Contract hash mismatch")
}

const PROCESS_LIFECYCLE = ["commit_successor_command_and_intent",
  "derive_authority_capsule_from_exact_committed_authority", "revalidate_current_attempt_at_spawn_boundary",
  "materialize_and_verify_exact_activated_artifact", "spawn_with_fixed_environment_plus_one_authority_capsule",
  "write_one_authority_request_frame_then_close_stdin", "read_one_authority_response_frame_then_await_exit",
  "admit_response_only_after_receipt_and_echo_validation"] as const
const FIELDS = ["activated_process_artifact_file_name", "activated_process_artifact_hash",
  "activated_stdio_artifact_count", "admitted_process_instance", "admitted_process_instance_count",
  "artifact_binding_policy", "authority_capsule_command_binding", "authority_capsule_derivation",
  "authority_capsule_encoding", "authority_capsule_environment_variable", "authority_capsule_fields",
  "authority_capsule_hash_time", "authority_capsule_instance", "authority_capsule_instance_count",
  "authority_capsule_intent_binding", "authority_capsule_reuse_policy", "authority_capsule_static_bindings",
  "authority_frame_build_relation", "authority_transport_contract_instance_count", "blocker_set_policy", "blockers",
  "contract_hash", "contract_id", "contract_key", "decision_output_authority", "dispatch_occurrence",
  "economic_authority", "environment_policy", "frame_encoding", "harness_invocation", "immutable_request_policy",
  "malformed_utf8_policy", "max_request_frame_bytes", "max_response_frame_bytes", "order_authority", "owner",
  "predecessor_transport_relation", "process_launch_receipt", "process_launch_receipt_count", "process_lifecycle",
  "process_model", "process_receipt_required_bindings", "process_receipt_schema_status", "purpose",
  "request_decode_receipt_count", "request_decode_receipts", "request_frame_fields", "request_frame_instance_count",
  "request_frame_instances", "request_frame_schema_version", "request_write_receipt_count",
  "request_write_receipts", "response_admission", "response_echo_policy", "response_frame_fields",
  "response_frame_instance_count", "response_frame_instances", "response_frame_schema_version",
  "response_read_receipt_count", "response_read_receipts", "schema_version", "scope", "signal_authority",
  "source_activated_stdio_capability", "source_activated_stdio_capability_hash",
  "source_activated_stdio_capability_id", "source_authority_frame_build_contract_hash",
  "source_execution_envelope_hash", "source_execution_envelope_id", "source_predecessor_transport_contract_hash",
  "source_predecessor_transport_contract_id", "spawn_boundary_revalidation_receipt", "status",
  "successor_execution_admission_command", "successor_execution_admission_command_count",
  "successor_process_launch_intent", "successor_process_launch_intent_count", "target_logical_request_id",
  "target_request_execution_admission", "target_request_transport_status", "target_worker_request_hash", "timeout_ms",
  "trailing_bytes_policy", "transport_activation", "transport_policy_version", "trial_authority"].sort()

function assertFields(value: object): void {
  if (canonicalHash(Object.keys(value).sort()) !== canonicalHash(FIELDS)) {
    throw new Error("Authority Transport Contract field whitelist drift")
  }
}
