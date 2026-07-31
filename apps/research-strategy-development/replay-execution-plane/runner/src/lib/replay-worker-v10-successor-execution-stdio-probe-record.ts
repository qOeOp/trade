import {
  REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_STDIO_PROBE_ADMISSION_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_STDIO_PROBE_ADMISSION_SCHEMA_VERSION,
  createReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission,
  replayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmissionKey,
  type ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-stdio-probe-admission"
import type { ReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-transport-admission"
import type {
  ReplayDecisionHarnessWorkerV10NegativeProbeReceipt,
  ReplayDecisionHarnessWorkerV10StdioCapability,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-stdio-capability"
import type { ReplayWorkerV10SuccessorExecutionPredecessorEvidence } from "./replay-worker-v10-successor-execution-stdio-probe-types"

export function buildReplayWorkerV10SuccessorExecutionStdioProbeAdmission(
  transportAdmission: ReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission,
  predecessor: ReplayWorkerV10SuccessorExecutionPredecessorEvidence,
  successor: ReplayDecisionHarnessWorkerV10StdioCapability,
  probe: ReplayDecisionHarnessWorkerV10NegativeProbeReceipt,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission {
  const key = replayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmissionKey({
    source_successor_execution_transport_admission_hash: transportAdmission.admission_hash,
    successor_stdio_capability_hash: successor.capability_hash,
    successor_negative_probe_receipt_hash: probe.receipt_hash,
    admission_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_STDIO_PROBE_ADMISSION_POLICY_VERSION,
  })
  return createReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission({
    schema_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_STDIO_PROBE_ADMISSION_SCHEMA_VERSION,
    admission_id: `decision-harness-worker-v10-successor-stdio-probe-${key.slice(0, 24)}`,
    admission_ref:
      `admission://replay-decision-harness-worker-v10-successor-stdio-probe/${key.slice(0, 24)}`,
    admission_key: key,
    admission_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_STDIO_PROBE_ADMISSION_POLICY_VERSION,
    scope: "one_successor_base_transport_bound_stdio_capability_and_negative_probe_receipt",
    owner: "replay_runner_worker_v10_successor_execution_stdio_probe_registry",
    purpose: "rebuild_transport_bound_stdio_identity_and_certify_non_request_rejections",
    status: "successor_stdio_and_negative_probe_admitted_execution_contract_not_materialized",
    source_successor_execution_transport_admission_hash: transportAdmission.admission_hash,
    source_successor_base_transport_contract_hash:
      transportAdmission.successor_base_transport_contract_hash,
    source_successor_execution_envelope_hash:
      transportAdmission.successor_base_transport_contract.source_execution_envelope_hash,
    source_predecessor_artifact_bound_transport_contract_hash: predecessor.transport_contract_hash,
    source_predecessor_execution_admission_contract_hash: predecessor.execution_contract_hash,
    source_predecessor_stdio_capability_hash: predecessor.stdio_capability_hash,
    successor_stdio_capability_hash: successor.capability_hash,
    successor_stdio_artifact_evidence: {
      capability_id: successor.capability_id,
      capability_hash: successor.capability_hash,
      source_transport_contract_hash: successor.source_transport_contract_hash,
      runtime: structuredClone(successor.runtime),
      artifact: structuredClone(successor.artifact),
    },
    successor_negative_probe_receipt_hash: probe.receipt_hash,
    successor_process_artifact_hash: successor.artifact.sha256,
    target_logical_request_id: successor.source_transport_contract.target_logical_request_id,
    target_worker_request_hash: successor.source_transport_contract.target_worker_request_hash,
    target_worker_request_execution_admission:
      successor.source_transport_contract.target_worker_request.execution_admission,
    target_worker_request_transport_status:
      successor.source_transport_contract.target_worker_request.transport_status,
    request_frame_schema_version: successor.source_transport_contract.request_frame_schema_version,
    response_frame_schema_version: successor.source_transport_contract.response_frame_schema_version,
    request_frame_encoding: successor.source_transport_contract.request_frame_encoding,
    response_frame_encoding: successor.source_transport_contract.response_frame_encoding,
    trailing_bytes_policy: successor.source_transport_contract.trailing_bytes_policy,
    max_request_frame_bytes: successor.source_transport_contract.max_request_frame_bytes,
    max_response_frame_bytes: successor.source_transport_contract.max_response_frame_bytes,
    timeout_ms: successor.source_transport_contract.timeout_ms,
    attempt_id: transportAdmission.attempt_id,
    attempt_ordinal: transportAdmission.attempt_ordinal,
    worker_id: transportAdmission.worker_id,
    predecessor_lease_generation: transportAdmission.predecessor_lease_generation,
    successor_lease_generation: transportAdmission.successor_lease_generation,
    capability_identity_policy: "fresh_capability_identity_per_exact_base_transport_contract",
    artifact_parity_policy: "identical_bytes_allowed_only_as_rebuild_evidence_not_identity_reuse",
    artifact_parity_status: "successor_rebuild_byte_identical_to_predecessor_stdio_artifact",
    probe_identity_policy: "fresh_receipt_bound_to_successor_capability_hash",
    probe_execution_class: "non_worker_request_malformed_input_processes_only",
    evidence_binding_policy: "content_addressed_parent_hashes_without_recursive_reembedding",
    registry_durability: "replay_local_immutable_cas_regular_file_canonical_json",
    successor_base_transport_contract_count: 1,
    successor_stdio_capability_count: 1,
    successor_negative_probe_receipt_count: 1,
    successor_negative_probe_process_count: 5,
    successor_worker_request_frame_count: 0,
    successor_worker_request_decode_count: 0,
    successor_artifact_bound_transport_contract_count: 0,
    successor_execution_admission_contract_count: 0,
    successor_execution_admission_command_count: 0,
    successor_process_launch_intent_count: 0,
    successor_authority_capsule_count: 0,
    successor_spawn_revalidation_count: 0,
    successor_worker_process_count: 0,
    second_response_count: 0,
    second_schedule_admission_count: 0,
    reproducibility_pair_count: 0,
    harness_receipt_count: 0,
    transport_authority: "stdio_artifact_certified_activation_not_granted",
    command_authority: "none",
    worker_process_authority: "none",
    blockers: [
      "successor_artifact_bound_transport_and_execution_admission_contract_not_materialized",
      "successor_command_intent_capsule_revalidation_and_worker_process_not_materialized",
      "second_distinct_fresh_worker_process_schedule_admission_not_materialized",
      "response_reproducibility_pair_and_harness_receipt_not_materialized",
    ],
    decision_output_authority: "first_schedule_matched_claim_only_successor_stdio_probe_admitted",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
    trial_authority: "none",
  })
}
