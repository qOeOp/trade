import {
  REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ARTIFACT_TRANSPORT_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ARTIFACT_TRANSPORT_SCHEMA_VERSION,
  createReplayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContract,
  replayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContractKey,
  type ReplayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContract,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-contract-admission"
import type { ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-stdio-probe-admission"

export function buildReplayWorkerV10SuccessorArtifactTransport(
  source: ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission,
  parentFileSha256: string,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContract {
  const stdio = source.successor_stdio_artifact_evidence
  const key = replayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContractKey({
    source_successor_execution_stdio_probe_admission_hash: source.admission_hash,
    source_successor_base_transport_contract_hash:
      source.source_successor_base_transport_contract_hash,
    source_successor_stdio_capability_hash: stdio.capability_hash,
    source_successor_negative_probe_receipt_hash: source.successor_negative_probe_receipt_hash,
    successor_process_artifact_hash: stdio.artifact.sha256,
    transport_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ARTIFACT_TRANSPORT_POLICY_VERSION,
  })
  return createReplayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContract({
    schema_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ARTIFACT_TRANSPORT_SCHEMA_VERSION,
    contract_id:
      `decision-harness-worker-v10-successor-execution-artifact-transport-${key.slice(0, 24)}`,
    contract_key: key,
    transport_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ARTIFACT_TRANSPORT_POLICY_VERSION,
    scope: "successor_generation_artifact_bound_zero_instance_transport_contract",
    owner: "replay_runner_worker_v10_successor_execution_contract_registry",
    purpose:
      "bind_exact_successor_stdio_artifact_without_recursive_parent_reembedding_or_activation",
    status: "successor_artifact_bound_transport_frozen_activation_blocked",
    source_successor_execution_stdio_probe_admission_hash: source.admission_hash,
    source_parent_canonical_file_sha256: parentFileSha256,
    source_successor_base_transport_contract_hash:
      source.source_successor_base_transport_contract_hash,
    source_successor_stdio_capability_hash: stdio.capability_hash,
    source_successor_negative_probe_receipt_hash: source.successor_negative_probe_receipt_hash,
    source_successor_execution_envelope_hash: source.source_successor_execution_envelope_hash,
    target_logical_request_id: source.target_logical_request_id,
    target_worker_request_hash: source.target_worker_request_hash,
    target_worker_request_execution_admission: source.target_worker_request_execution_admission,
    target_worker_request_transport_status: source.target_worker_request_transport_status,
    successor_process_artifact_hash: stdio.artifact.sha256,
    artifact_binding_policy: "exact_successor_stdio_capability_artifact_hash",
    evidence_binding_policy:
      "exact_durable_local_cas_hash_references_without_recursive_lineage_reembedding",
    process_model: "fresh_single_request_process_no_pool_keepalive_or_multiplex",
    process_lifecycle: [
      "spawn_exact_successor_artifact",
      "write_one_request_frame",
      "close_stdin",
      "read_one_response_frame",
      "await_process_exit",
    ],
    request_frame_schema_version: source.request_frame_schema_version,
    response_frame_schema_version: source.response_frame_schema_version,
    request_frame_encoding: source.request_frame_encoding,
    response_frame_encoding: source.response_frame_encoding,
    trailing_bytes_policy: source.trailing_bytes_policy,
    max_request_frame_bytes: source.max_request_frame_bytes,
    max_response_frame_bytes: source.max_response_frame_bytes,
    timeout_ms: source.timeout_ms,
    attempt_id: source.attempt_id,
    attempt_ordinal: source.attempt_ordinal,
    worker_id: source.worker_id,
    lease_generation: source.successor_lease_generation,
    source_negative_probe_process_count: source.successor_negative_probe_process_count,
    worker_request_frame_count: 0,
    worker_request_decode_count: 0,
    worker_process_count: 0,
    blocker_set_policy:
      "complete_deterministic_ordered_successor_artifact_transport_blockers",
    blockers: [
      "successor_execution_admission_command_not_issued",
      "successor_current_lease_revalidation_not_materialized",
      "successor_worker_process_not_materialized",
      "successor_worker_request_frame_write_and_decode_not_materialized",
      "successor_worker_response_frame_read_and_admission_not_materialized",
    ],
    dispatch_occurrence: "not_materialized",
    transport_activation: "blocked",
    harness_invocation: "forbidden",
    response_admission: "not_granted",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
    trial_authority: "none",
  })
}
