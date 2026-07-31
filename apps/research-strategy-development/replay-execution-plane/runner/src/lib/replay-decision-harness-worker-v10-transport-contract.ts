import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import {
  assertReplayDecisionHarnessExecutionEnvelope,
  type ReplayDecisionHarnessExecutionEnvelope,
} from "../../../contracts/src/lib/replay-decision-harness-execution-envelope"
import {
  REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION,
  REPLAY_DECISION_HARNESS_TARGET_WORKER_REQUEST_SCHEMA_VERSION,
} from "../../../contracts/src/lib/replay-decision-harness-logical-request-identity-upgrade"
import {
  REPLAY_DECISION_HARNESS_TARGET_WORKER_RESPONSE_SCHEMA_VERSION,
} from "../../../contracts/src/lib/replay-decision-harness-worker-response-v10-contract"
import {
  assertReplayDecisionHarnessWorkerV10BuildCapability,
  type ReplayDecisionHarnessWorkerV10BuildCapability,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-build-capability"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_REQUEST_FRAME_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_RESPONSE_FRAME_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_TRANSPORT_CONTRACT_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_TRANSPORT_POLICY_VERSION,
  assertReplayDecisionHarnessWorkerV10TransportContract,
  createReplayDecisionHarnessWorkerV10TransportContract,
  replayDecisionHarnessWorkerV10TransportBlockers,
  replayDecisionHarnessWorkerV10TransportContractKey,
  type ReplayDecisionHarnessWorkerV10TransportContract,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-transport-contract"

export interface BuildReplayDecisionHarnessWorkerV10TransportContractInput {
  source_worker_v10_build_capability: ReplayDecisionHarnessWorkerV10BuildCapability
  source_execution_envelope: ReplayDecisionHarnessExecutionEnvelope
}

export function buildReplayDecisionHarnessWorkerV10TransportContract(
  input: BuildReplayDecisionHarnessWorkerV10TransportContractInput,
): ReplayDecisionHarnessWorkerV10TransportContract {
  assertReplayDecisionHarnessWorkerV10BuildCapability(input.source_worker_v10_build_capability)
  assertReplayDecisionHarnessExecutionEnvelope(input.source_execution_envelope)
  const capability = input.source_worker_v10_build_capability
  const envelope = input.source_execution_envelope
  const request = envelope.source_response_contract.source_request_materialization.requests
    .find((item) => item.logical_request_id === envelope.logical_request_id)
  if (!request) throw new Error("decision harness Worker v10 Transport target Request is missing")
  const contractKey = replayDecisionHarnessWorkerV10TransportContractKey({
    worker_v10_build_capability_hash: capability.capability_hash,
    execution_envelope_hash: envelope.envelope_hash,
    logical_request_id: envelope.logical_request_id,
    transport_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_TRANSPORT_POLICY_VERSION,
  })
  const resourceCapability = capability.source_code_admission.registry_capability
  return createReplayDecisionHarnessWorkerV10TransportContract({
    schema_version: REPLAY_DECISION_HARNESS_WORKER_V10_TRANSPORT_CONTRACT_SCHEMA_VERSION,
    contract_id: `decision-harness-worker-v10-transport-${contractKey.slice(0, 24)}`,
    contract_key: contractKey,
    transport_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_TRANSPORT_POLICY_VERSION,
    scope: "pre_process_zero_instance_single_request_transport_contract",
    owner: "replay_runner_worker_v10_transport_registry",
    purpose: "freeze_fresh_process_frame_semantics_and_artifact_roles_without_materializing_transport",
    status: "frozen_blocked_zero_instance",
    source_worker_v10_build_capability_id: capability.capability_id,
    source_worker_v10_build_capability_hash: capability.capability_hash,
    source_worker_v10_build_capability: structuredClone(capability),
    source_execution_envelope_id: envelope.envelope_id,
    source_execution_envelope_hash: envelope.envelope_hash,
    source_execution_envelope: structuredClone(envelope),
    source_response_contract_hash: envelope.source_response_contract_hash,
    target_logical_request_id: request.logical_request_id,
    target_worker_request_hash: request.request_hash,
    target_worker_request: structuredClone(request),
    worker_protocol_version: REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION,
    worker_request_schema_version: REPLAY_DECISION_HARNESS_TARGET_WORKER_REQUEST_SCHEMA_VERSION,
    worker_response_schema_version: REPLAY_DECISION_HARNESS_TARGET_WORKER_RESPONSE_SCHEMA_VERSION,
    logical_request_artifact_hash: request.artifact_hash,
    logical_request_artifact_role: "legacy_v9_code_admission_anchor_not_transport_executable",
    transport_process_artifact_hash: capability.artifact.sha256,
    transport_process_artifact_role: "r4_118_v10_decoder_module_candidate_not_stdio_process_artifact",
    artifact_bridge_policy: "v10_capability_must_embed_exact_code_admission_source_bundle_and_legacy_artifact",
    artifact_bridge_status: "exact_migration_lineage_verified",
    migration_scope: "v1_bridge_not_long_term_artifact_taxonomy",
    process_model: "fresh_single_request_process_no_pool_keepalive_or_multiplex",
    process_lifecycle: ["spawn_exact_artifact", "write_one_request_frame", "close_stdin",
      "read_one_response_frame", "await_process_exit"],
    reproducibility_model: "same_logical_frame_two_future_fresh_processes_distinct_process_receipts",
    request_frame_schema_version: REPLAY_DECISION_HARNESS_WORKER_V10_REQUEST_FRAME_SCHEMA_VERSION,
    response_frame_schema_version: REPLAY_DECISION_HARNESS_WORKER_V10_RESPONSE_FRAME_SCHEMA_VERSION,
    request_frame_encoding: "canonical_json_utf8_lf_then_eof",
    response_frame_encoding: "canonical_json_utf8_lf_then_process_exit",
    frame_identity_policy: "logical_frame_excludes_process_identity_write_receipt_must_bind_process",
    trailing_bytes_policy: "no_non_whitespace_bytes_after_single_frame",
    stderr_policy: "diagnostic_only_never_response_authority",
    timeout_ms: resourceCapability.timeout_ms,
    max_request_frame_bytes: resourceCapability.max_output_bytes,
    max_response_frame_bytes: resourceCapability.max_output_bytes,
    resource_policy_source: "r4_105_registry_capability",
    blockers: replayDecisionHarnessWorkerV10TransportBlockers(),
    blocker_set_policy: "complete_deterministic_ordered_blocker_set",
    r4_117_gate_relation: "successor_contract_does_not_rewrite_prior_blocked_gate",
    stdio_process_artifact: "not_materialized",
    process_instance: null,
    process_instance_count: 0,
    request_frame_instances: [],
    request_frame_instance_count: 0,
    request_write_receipts: [],
    request_write_receipt_count: 0,
    response_frame_instances: [],
    response_frame_instance_count: 0,
    response_read_receipts: [],
    response_read_receipt_count: 0,
    dispatch_occurrence: "not_materialized",
    harness_invocation: "forbidden",
    response_admission: "not_granted",
    decision_output_authority: "none",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
    trial_authority: "none",
  })
}

export function assertReplayDecisionHarnessWorkerV10TransportContractLineage(
  value: ReplayDecisionHarnessWorkerV10TransportContract,
  input: BuildReplayDecisionHarnessWorkerV10TransportContractInput,
): void {
  assertReplayDecisionHarnessWorkerV10TransportContract(value)
  const expected = buildReplayDecisionHarnessWorkerV10TransportContract(input)
  if (canonicalHash(value) !== canonicalHash(expected)) {
    throw new Error("decision harness Worker v10 Transport Contract parent lineage drift")
  }
}
