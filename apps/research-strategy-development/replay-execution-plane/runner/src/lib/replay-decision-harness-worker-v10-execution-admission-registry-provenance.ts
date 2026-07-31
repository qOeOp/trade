import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_REGISTRY_PROVENANCE_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_REGISTRY_PROVENANCE_SCHEMA_VERSION,
  assertReplayAttemptLeaseObservationRegistryReadReceiptView,
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenance,
  createReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenance,
  replayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenanceBlockers,
  replayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenanceKey,
  type ReplayAttemptLeaseObservationRegistryReadReceiptView,
  type ReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenance,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-registry-provenance"
import {
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle,
  type ReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-pre-issue-bundle"

export interface BuildReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenanceInput {
  source_pre_issue_bundle: ReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle
  control_plane_registry_read_receipt: ReplayAttemptLeaseObservationRegistryReadReceiptView
}

export function buildReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenance(
  input: BuildReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenanceInput,
): ReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenance {
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle(input.source_pre_issue_bundle)
  assertReplayAttemptLeaseObservationRegistryReadReceiptView(input.control_plane_registry_read_receipt)
  const bundle = input.source_pre_issue_bundle
  const receipt = input.control_plane_registry_read_receipt
  const key = replayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenanceKey({
    pre_issue_bundle_hash: bundle.bundle_hash,
    registry_read_receipt_hash: receipt.receipt_hash,
    provenance_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_REGISTRY_PROVENANCE_POLICY_VERSION,
  })
  return createReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenance({
    schema_version: REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_REGISTRY_PROVENANCE_SCHEMA_VERSION,
    provenance_id: `decision-harness-worker-v10-execution-registry-provenance-${key.slice(0, 24)}`,
    provenance_key: key,
    provenance_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_REGISTRY_PROVENANCE_POLICY_VERSION,
    scope: "attempt_bound_execution_admission_registry_provenance_only",
    owner: "replay_runner_worker_v10_execution_admission_registry_provenance_registry",
    status: "registry_provenance_bound_independent_clock_blocked",
    source_pre_issue_bundle_id: bundle.bundle_id,
    source_pre_issue_bundle_hash: bundle.bundle_hash,
    source_pre_issue_bundle: structuredClone(bundle),
    control_plane_registry_read_receipt_id: receipt.receipt_id,
    control_plane_registry_read_receipt_hash: receipt.receipt_hash,
    control_plane_registry_read_receipt: structuredClone(receipt),
    target_logical_request_id: bundle.target_logical_request_id,
    target_worker_request_hash: bundle.target_worker_request_hash,
    attempt_id: bundle.attempt_id,
    attempt_ordinal: bundle.attempt_ordinal,
    worker_id: bundle.worker_id,
    lease_generation: bundle.lease_generation,
    current_attempt_lease_hash: bundle.current_attempt_lease_hash,
    control_plane_registry_read_provenance: "registered_row_and_current_attempt_exact_match_bound",
    clock_evidence: "caller_supplied_utc_not_external_time_attestation",
    external_time_attestation: "not_provided",
    predecessor_blocker_closure: "control_plane_registry_read_provenance_closed_only",
    execution_admission_command: null,
    execution_admission_command_instance_count: 0,
    command_issue_status: "blocked",
    blocker_set_policy: "complete_deterministic_ordered_post_registry_provenance_blockers",
    blockers: replayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenanceBlockers(),
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

export function assertReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenanceLineage(
  value: ReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenance,
  input: BuildReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenanceInput,
): void {
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenance(value)
  if (canonicalHash(value) !== canonicalHash(buildReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenance(input))) {
    throw new Error("Execution Admission registry provenance lineage drift")
  }
}
