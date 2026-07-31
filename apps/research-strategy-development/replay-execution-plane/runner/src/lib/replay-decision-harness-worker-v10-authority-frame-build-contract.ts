import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_FRAME_BUILD_CONTRACT_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_FRAME_BUILD_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_FIELDS,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_FRAME_FIELDS,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_FRAME_SCHEMA_VERSION,
  assertReplayDecisionHarnessWorkerV10AuthorityFrameBuildContract,
  createReplayDecisionHarnessWorkerV10AuthorityFrameBuildContract,
  replayDecisionHarnessWorkerV10AuthorityFrameBuildBlockers,
  replayDecisionHarnessWorkerV10AuthorityFrameBuildContractKey,
  type ReplayDecisionHarnessWorkerV10AuthorityFrameBuildContract,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-frame-build-contract"
import {
  assertReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGate,
  type ReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGate,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-process-launch-readiness-gate"

export interface BuildReplayDecisionHarnessWorkerV10AuthorityFrameBuildContractInput {
  source_launch_readiness_gate: ReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGate
}

export function buildReplayDecisionHarnessWorkerV10AuthorityFrameBuildContract(
  input: BuildReplayDecisionHarnessWorkerV10AuthorityFrameBuildContractInput,
): ReplayDecisionHarnessWorkerV10AuthorityFrameBuildContract {
  assertReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGate(input.source_launch_readiness_gate)
  const gate = input.source_launch_readiness_gate
  const command = gate.source_process_launch_intent.source_execution_admission_command
  const successor = command.source_clock_binding.source_registry_provenance.source_pre_issue_bundle
    .source_execution_admission_contract.source_successor_transport_contract
  const key = replayDecisionHarnessWorkerV10AuthorityFrameBuildContractKey({
    launch_readiness_gate_hash: gate.gate_hash,
    build_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_FRAME_BUILD_POLICY_VERSION,
  })
  return createReplayDecisionHarnessWorkerV10AuthorityFrameBuildContract({
    schema_version: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_FRAME_BUILD_CONTRACT_SCHEMA_VERSION,
    contract_id: `decision-harness-worker-v10-authority-frame-build-${key.slice(0, 24)}`,
    contract_key: key,
    build_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_FRAME_BUILD_POLICY_VERSION,
    scope: "one_blocked_launch_readiness_gate_authority_frame_and_activated_build_contract",
    owner: "replay_runner_worker_v10_authority_frame_build_registry",
    purpose: "freeze_executable_cutover_protocol_without_building_artifact_or_reissuing_authority",
    status: "contract_frozen_build_not_materialized",
    source_launch_readiness_gate_id: gate.gate_id,
    source_launch_readiness_gate_hash: gate.gate_hash,
    source_launch_readiness_gate: structuredClone(gate),
    source_execution_envelope_hash: successor.source_execution_envelope_hash,
    source_worker_request_hash: successor.target_worker_request_hash,
    source_logical_request_id: successor.target_logical_request_id,
    predecessor_transport_contract_hash: successor.contract_hash,
    predecessor_process_artifact_hash: gate.intent_bound_process_artifact_hash,
    predecessor_valid_frame_policy: "reject_before_decode_until_successor_transport_activation",
    predecessor_immutability: "r4_119_to_r4_128_contracts_and_artifacts_remain_immutable",
    frame_v1_status: "historical_unadmitted_candidate_schema_not_reused",
    worker_request_v10_role: "immutable_inner_payload_non_executable_alone",
    worker_response_v10_role: "immutable_inner_result_outer_frame_supplies_authority_echo",
    request_frame_schema_version: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_SCHEMA_VERSION,
    response_frame_schema_version: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_FRAME_SCHEMA_VERSION,
    request_frame_fields: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_FIELDS,
    response_frame_fields: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_FRAME_FIELDS,
    request_authority_binding:
      "outer_frame_exactly_binds_transport_artifact_envelope_command_intent_and_worker_request",
    response_authority_echo:
      "outer_frame_exactly_echoes_transport_artifact_envelope_command_intent_request_frame_and_worker_request",
    required_response_echo_fields: [
      "execution_admission_command_hash",
      "process_launch_intent_hash",
      "request_frame_hash",
      "worker_request_hash",
    ],
    frame_encoding: "one_canonical_json_utf8_lf_frame_per_direction",
    malformed_utf8_policy: "fatal_no_replacement_decoding",
    trailing_bytes_policy: "no_non_whitespace_bytes_after_single_frame",
    activated_build_decode_policy:
      "decode_request_frame_v2_then_verify_outer_authority_then_decode_worker_request_v10",
    activated_build_invoke_policy:
      "invoke_harness_only_after_exact_outer_and_inner_binding_validation",
    activated_build_response_policy:
      "emit_response_frame_v2_only_after_inner_response_v10_validation_and_exact_authority_echo",
    old_authority_reuse_policy: "forbidden_new_artifact_requires_new_transport_command_and_intent",
    cutover_order: [
      "build_and_attest_activated_stdio_artifact",
      "bind_artifact_to_successor_transport",
      "issue_successor_execution_admission_command",
      "commit_successor_process_launch_intent",
      "revalidate_at_spawn_boundary",
      "materialize_process_and_authority_frame_receipts",
    ],
    blocker_set_policy: "complete_deterministic_ordered_pre_build_cutover_blockers",
    blockers: replayDecisionHarnessWorkerV10AuthorityFrameBuildBlockers(),
    contract_instance_count: 1,
    activated_stdio_artifact: null,
    activated_stdio_artifact_count: 0,
    successor_transport_contract: null,
    successor_transport_contract_count: 0,
    successor_execution_admission_command: null,
    successor_execution_admission_command_count: 0,
    successor_process_launch_intent: null,
    successor_process_launch_intent_count: 0,
    process_launch_receipt_count: 0,
    admitted_process_instance_count: 0,
    request_frame_instance_count: 0,
    response_frame_instance_count: 0,
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

export function assertReplayDecisionHarnessWorkerV10AuthorityFrameBuildContractLineage(
  value: ReplayDecisionHarnessWorkerV10AuthorityFrameBuildContract,
  input: BuildReplayDecisionHarnessWorkerV10AuthorityFrameBuildContractInput,
): void {
  assertReplayDecisionHarnessWorkerV10AuthorityFrameBuildContract(value)
  if (canonicalHash(value) !== canonicalHash(buildReplayDecisionHarnessWorkerV10AuthorityFrameBuildContract(input))) {
    throw new Error("Authority Frame Build Contract lineage drift")
  }
}
