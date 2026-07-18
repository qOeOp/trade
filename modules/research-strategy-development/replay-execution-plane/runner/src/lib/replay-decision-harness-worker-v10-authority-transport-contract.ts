import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_ACTIVATED_STDIO_ARTIFACT_FILE,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_ENV,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_FIELDS,
  assertReplayDecisionHarnessWorkerV10ActivatedStdioCapability,
  type ReplayDecisionHarnessWorkerV10ActivatedStdioCapability,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-activated-stdio-capability"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_FIELDS,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_FRAME_FIELDS,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_FRAME_SCHEMA_VERSION,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-frame-build-contract"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_RECEIPT_BINDINGS,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_TRANSPORT_CONTRACT_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_TRANSPORT_POLICY_VERSION,
  assertReplayDecisionHarnessWorkerV10AuthorityTransportContract,
  createReplayDecisionHarnessWorkerV10AuthorityTransportContract,
  replayDecisionHarnessWorkerV10AuthorityTransportBlockers,
  replayDecisionHarnessWorkerV10AuthorityTransportContractKey,
  type ReplayDecisionHarnessWorkerV10AuthorityTransportContract,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-transport-contract"

export interface BuildReplayDecisionHarnessWorkerV10AuthorityTransportContractInput {
  source_activated_stdio_capability: ReplayDecisionHarnessWorkerV10ActivatedStdioCapability
}

export function buildReplayDecisionHarnessWorkerV10AuthorityTransportContract(
  input: BuildReplayDecisionHarnessWorkerV10AuthorityTransportContractInput,
): ReplayDecisionHarnessWorkerV10AuthorityTransportContract {
  assertReplayDecisionHarnessWorkerV10ActivatedStdioCapability(input.source_activated_stdio_capability)
  const capability = input.source_activated_stdio_capability
  const frameBuild = capability.source_authority_frame_build_contract
  const gate = frameBuild.source_launch_readiness_gate
  const oldCommand = gate.source_process_launch_intent.source_execution_admission_command
  const predecessor = oldCommand.source_clock_binding.source_registry_provenance.source_pre_issue_bundle
    .source_execution_admission_contract.source_successor_transport_contract
  const oldTransport = predecessor.source_negative_probe_receipt.source_stdio_capability.source_transport_contract
  const envelope = oldTransport.source_execution_envelope
  const request = oldTransport.target_worker_request
  const contractKey = replayDecisionHarnessWorkerV10AuthorityTransportContractKey({
    activated_stdio_capability_hash: capability.capability_hash,
    execution_envelope_hash: envelope.envelope_hash,
    transport_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_TRANSPORT_POLICY_VERSION,
  })
  return createReplayDecisionHarnessWorkerV10AuthorityTransportContract({
    schema_version: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_TRANSPORT_CONTRACT_SCHEMA_VERSION,
    contract_id: `decision-harness-worker-v10-authority-transport-${contractKey.slice(0, 24)}`,
    contract_key: contractKey,
    transport_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_TRANSPORT_POLICY_VERSION,
    scope: "activated_artifact_bound_authority_frame_zero_process_transport_contract",
    owner: "replay_runner_worker_v10_authority_transport_registry",
    purpose: "bind_activated_artifact_frame_v2_capsule_derivation_and_future_receipt_requirements",
    status: "activated_artifact_bound_authority_issuance_blocked_zero_process",
    source_activated_stdio_capability_id: capability.capability_id,
    source_activated_stdio_capability_hash: capability.capability_hash,
    source_activated_stdio_capability: structuredClone(capability),
    source_authority_frame_build_contract_hash: frameBuild.contract_hash,
    source_predecessor_transport_contract_id: predecessor.contract_id,
    source_predecessor_transport_contract_hash: predecessor.contract_hash,
    source_execution_envelope_id: envelope.envelope_id,
    source_execution_envelope_hash: envelope.envelope_hash,
    target_logical_request_id: request.logical_request_id,
    target_worker_request_hash: request.request_hash,
    target_request_execution_admission: request.execution_admission,
    target_request_transport_status: request.transport_status,
    immutable_request_policy: "request_v10_markers_remain_non_executable_outer_authority_is_separate",
    activated_process_artifact_hash: capability.artifact.sha256,
    activated_process_artifact_file_name: REPLAY_DECISION_HARNESS_WORKER_V10_ACTIVATED_STDIO_ARTIFACT_FILE,
    artifact_binding_policy: "transport_v3_process_hash_is_exact_activated_stdio_capability_artifact",
    predecessor_transport_relation: "r4_121_transport_v2_and_r4_120_artifact_remain_immutable_historical",
    authority_frame_build_relation: "r4_129_contract_is_exact_schema_and_build_policy_parent",
    process_model: "fresh_single_request_process_no_pool_keepalive_or_multiplex",
    process_lifecycle: [
      "commit_successor_command_and_intent",
      "derive_authority_capsule_from_exact_committed_authority",
      "revalidate_current_attempt_at_spawn_boundary",
      "materialize_and_verify_exact_activated_artifact",
      "spawn_with_fixed_environment_plus_one_authority_capsule",
      "write_one_authority_request_frame_then_close_stdin",
      "read_one_authority_response_frame_then_await_exit",
      "admit_response_only_after_receipt_and_echo_validation",
    ],
    request_frame_schema_version: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_SCHEMA_VERSION,
    response_frame_schema_version: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_FRAME_SCHEMA_VERSION,
    request_frame_fields: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_FIELDS,
    response_frame_fields: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_FRAME_FIELDS,
    frame_encoding: "canonical_json_utf8_lf_single_frame_per_direction",
    malformed_utf8_policy: "fatal_no_replacement_decoding",
    trailing_bytes_policy: "no_non_whitespace_bytes_after_single_frame",
    timeout_ms: capability.timeout_ms,
    max_request_frame_bytes: capability.max_request_frame_bytes,
    max_response_frame_bytes: capability.max_response_frame_bytes,
    authority_capsule_environment_variable: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_ENV,
    authority_capsule_fields: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_FIELDS,
    authority_capsule_encoding: "canonical_json_utf8_environment_value",
    authority_capsule_static_bindings:
      "transport_artifact_envelope_logical_request_and_worker_request_from_this_contract",
    authority_capsule_command_binding: "future_successor_command_hash_after_exact_command_commit",
    authority_capsule_intent_binding: "future_successor_intent_hash_derived_at_spawn_not_stored_in_intent_payload",
    authority_capsule_derivation:
      "canonical_object_from_exact_contract_artifact_envelope_command_intent_and_request_hashes",
    authority_capsule_hash_time: "after_intent_commit_before_spawn_boundary_revalidation",
    authority_capsule_reuse_policy: "forbidden_across_command_intent_attempt_or_lease_generation",
    environment_policy: "tz_utc_lang_c_lc_all_c_plus_exact_single_authority_capsule_no_inherited_values",
    response_echo_policy:
      "response_frame_v2_must_echo_transport_artifact_envelope_command_intent_request_frame_and_worker_request",
    process_receipt_required_bindings: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_RECEIPT_BINDINGS,
    process_receipt_schema_status: "not_materialized_exact_process_identity_fields_pending",
    blocker_set_policy: "complete_deterministic_ordered_post_transport_pre_dispatch_blockers",
    blockers: replayDecisionHarnessWorkerV10AuthorityTransportBlockers(),
    activated_stdio_artifact_count: 1,
    authority_transport_contract_instance_count: 1,
    successor_execution_admission_command: null,
    successor_execution_admission_command_count: 0,
    successor_process_launch_intent: null,
    successor_process_launch_intent_count: 0,
    authority_capsule_instance: null,
    authority_capsule_instance_count: 0,
    spawn_boundary_revalidation_receipt: null,
    process_launch_receipt: null,
    process_launch_receipt_count: 0,
    admitted_process_instance: null,
    admitted_process_instance_count: 0,
    request_frame_instances: [],
    request_frame_instance_count: 0,
    request_write_receipts: [],
    request_write_receipt_count: 0,
    request_decode_receipts: [],
    request_decode_receipt_count: 0,
    response_frame_instances: [],
    response_frame_instance_count: 0,
    response_read_receipts: [],
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

export function assertReplayDecisionHarnessWorkerV10AuthorityTransportContractLineage(
  value: ReplayDecisionHarnessWorkerV10AuthorityTransportContract,
  input: BuildReplayDecisionHarnessWorkerV10AuthorityTransportContractInput,
): void {
  assertReplayDecisionHarnessWorkerV10AuthorityTransportContract(value)
  const expected = buildReplayDecisionHarnessWorkerV10AuthorityTransportContract(input)
  if (canonicalHash(value) !== canonicalHash(expected)) {
    throw new Error("decision harness Worker v10 Authority Transport Contract lineage drift")
  }
}
