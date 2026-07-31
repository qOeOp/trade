import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_REQUEST_FRAME_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_RESPONSE_FRAME_SCHEMA_VERSION,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-transport-contract"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_TRANSPORT_CONTRACT_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_TRANSPORT_POLICY_VERSION,
  assertReplayDecisionHarnessWorkerV10SuccessorTransportContract,
  createReplayDecisionHarnessWorkerV10SuccessorTransportContract,
  replayDecisionHarnessWorkerV10SuccessorTransportBlockers,
  replayDecisionHarnessWorkerV10SuccessorTransportContractKey,
  type ReplayDecisionHarnessWorkerV10SuccessorTransportContract,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-transport-contract"
import {
  assertReplayDecisionHarnessWorkerV10NegativeProbeReceipt,
  type ReplayDecisionHarnessWorkerV10NegativeProbeReceipt,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-stdio-capability"

export interface BuildReplayDecisionHarnessWorkerV10SuccessorTransportContractInput {
  source_negative_probe_receipt: ReplayDecisionHarnessWorkerV10NegativeProbeReceipt
}

export function buildReplayDecisionHarnessWorkerV10SuccessorTransportContract(
  input: BuildReplayDecisionHarnessWorkerV10SuccessorTransportContractInput,
): ReplayDecisionHarnessWorkerV10SuccessorTransportContract {
  assertReplayDecisionHarnessWorkerV10NegativeProbeReceipt(input.source_negative_probe_receipt)
  const receipt = input.source_negative_probe_receipt
  const stdio = receipt.source_stdio_capability
  const predecessor = stdio.source_transport_contract
  const envelope = predecessor.source_execution_envelope
  const request = predecessor.target_worker_request
  const contractKey = replayDecisionHarnessWorkerV10SuccessorTransportContractKey({
    predecessor_transport_contract_hash: predecessor.contract_hash,
    stdio_capability_hash: stdio.capability_hash,
    negative_probe_receipt_hash: receipt.receipt_hash,
    execution_envelope_hash: envelope.envelope_hash,
    transport_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_TRANSPORT_POLICY_VERSION,
  })
  return createReplayDecisionHarnessWorkerV10SuccessorTransportContract({
    schema_version: REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_TRANSPORT_CONTRACT_SCHEMA_VERSION,
    contract_id: `decision-harness-worker-v10-successor-transport-${contractKey.slice(0, 24)}`,
    contract_key: contractKey,
    transport_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_TRANSPORT_POLICY_VERSION,
    scope: "successor_artifact_bound_zero_instance_transport_contract",
    owner: "replay_runner_worker_v10_successor_transport_registry",
    purpose: "bind_stdio_process_artifact_and_recompute_activation_blockers_without_dispatch",
    status: "artifact_bound_activation_blocked_zero_instance",
    source_predecessor_transport_contract_id: predecessor.contract_id,
    source_predecessor_transport_contract_hash: predecessor.contract_hash,
    source_stdio_capability_id: stdio.capability_id,
    source_stdio_capability_hash: stdio.capability_hash,
    source_negative_probe_receipt_id: receipt.receipt_id,
    source_negative_probe_receipt_hash: receipt.receipt_hash,
    source_negative_probe_receipt: structuredClone(receipt),
    source_execution_envelope_id: envelope.envelope_id,
    source_execution_envelope_hash: envelope.envelope_hash,
    target_logical_request_id: request.logical_request_id,
    target_worker_request_hash: request.request_hash,
    target_request_execution_admission: request.execution_admission,
    target_request_transport_status: request.transport_status,
    immutable_request_policy: "request_v10_markers_cannot_be_mutated_by_transport_contract",
    logical_request_artifact_hash: predecessor.logical_request_artifact_hash,
    logical_request_artifact_role: "legacy_v9_code_admission_anchor_not_transport_executable",
    predecessor_decoder_artifact_hash: predecessor.transport_process_artifact_hash,
    predecessor_decoder_artifact_role: "r4_118_decoder_bound_only_to_predecessor_r4_119",
    successor_process_artifact_hash: stdio.artifact.sha256,
    successor_process_artifact_role: "r4_120_build_attested_stdio_process_artifact",
    artifact_binding_policy: "outer_transport_process_hash_is_exact_stdio_capability_artifact",
    artifact_binding_status: "successor_stdio_process_artifact_bound",
    artifact_lineage_policy: "exact_legacy_anchor_decoder_predecessor_and_stdio_successor_chain",
    migration_scope: "successor_binding_v2_not_long_term_artifact_taxonomy",
    predecessor_contract_relation: "r4_119_immutable_not_rewritten",
    r4_117_gate_relation: "blocked_historical_gate_immutable_not_reopened",
    process_model: "fresh_single_request_process_no_pool_keepalive_or_multiplex",
    process_lifecycle: ["spawn_exact_successor_artifact", "write_one_request_frame", "close_stdin",
      "read_one_response_frame", "await_process_exit"],
    request_frame_schema_version: REPLAY_DECISION_HARNESS_WORKER_V10_REQUEST_FRAME_SCHEMA_VERSION,
    response_frame_schema_version: REPLAY_DECISION_HARNESS_WORKER_V10_RESPONSE_FRAME_SCHEMA_VERSION,
    request_frame_encoding: "canonical_json_utf8_lf_then_eof",
    response_frame_encoding: "canonical_json_utf8_lf_then_process_exit",
    trailing_bytes_policy: "no_non_whitespace_bytes_after_single_frame",
    max_request_frame_bytes: predecessor.max_request_frame_bytes,
    max_response_frame_bytes: predecessor.max_response_frame_bytes,
    timeout_ms: predecessor.timeout_ms,
    negative_probe_status: receipt.status,
    source_negative_probe_process_instance_count: receipt.process_instance_count,
    source_negative_probe_worker_request_frame_count: receipt.worker_request_frame_instance_count,
    blocker_set_policy: "complete_deterministic_ordered_successor_activation_blockers",
    blockers: replayDecisionHarnessWorkerV10SuccessorTransportBlockers(),
    admitted_process_instance: null,
    admitted_process_instance_count: 0,
    current_lease_revalidation_receipt: null,
    attempt_bound_process_launch_intent: null,
    attempt_bound_process_receipt: null,
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

export function assertReplayDecisionHarnessWorkerV10SuccessorTransportContractLineage(
  value: ReplayDecisionHarnessWorkerV10SuccessorTransportContract,
  input: BuildReplayDecisionHarnessWorkerV10SuccessorTransportContractInput,
): void {
  assertReplayDecisionHarnessWorkerV10SuccessorTransportContract(value)
  const expected = buildReplayDecisionHarnessWorkerV10SuccessorTransportContract(input)
  if (canonicalHash(value) !== canonicalHash(expected)) {
    throw new Error("decision harness Worker v10 successor Transport Contract lineage drift")
  }
}
