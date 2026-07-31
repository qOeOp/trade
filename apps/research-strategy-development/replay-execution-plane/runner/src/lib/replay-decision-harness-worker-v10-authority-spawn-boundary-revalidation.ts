import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import {
  assertReplayDecisionHarnessWorkerV10AuthorityCapsuleRecord,
  type ReplayDecisionHarnessWorkerV10AuthorityCapsuleRecord,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-capsule"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_SPAWN_REVALIDATION_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_SPAWN_REVALIDATION_SCHEMA_VERSION,
  assertReplaySpawnBoundaryRevalidationReceiptView,
  assertReplaySpawnBoundaryRevalidationRequestView,
  createReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidation,
  replayDecisionHarnessWorkerV10AuthoritySpawnRevalidationBlockers,
  replayDecisionHarnessWorkerV10AuthoritySpawnRevalidationKey,
  type ReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidation,
  type ReplaySpawnBoundaryRevalidationReceiptView,
  type ReplaySpawnBoundaryRevalidationRequestView,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-spawn-boundary-revalidation"

export interface BuildReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidationInput {
  source_authority_capsule: ReplayDecisionHarnessWorkerV10AuthorityCapsuleRecord
  source_revalidation_request: ReplaySpawnBoundaryRevalidationRequestView
  control_plane_revalidation_receipt: ReplaySpawnBoundaryRevalidationReceiptView
}

export function buildReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidation(
  input: BuildReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidationInput,
): ReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidation {
  assertReplayDecisionHarnessWorkerV10AuthorityCapsuleRecord(input.source_authority_capsule)
  assertReplaySpawnBoundaryRevalidationRequestView(input.source_revalidation_request)
  assertReplaySpawnBoundaryRevalidationReceiptView(input.control_plane_revalidation_receipt)
  const capsule = input.source_authority_capsule
  const request = input.source_revalidation_request
  const receipt = input.control_plane_revalidation_receipt
  const key = replayDecisionHarnessWorkerV10AuthoritySpawnRevalidationKey({
    source_revalidation_request_hash: request.request_hash,
    binding_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_SPAWN_REVALIDATION_POLICY_VERSION,
  })
  return createReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidation({
    schema_version: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_SPAWN_REVALIDATION_SCHEMA_VERSION,
    binding_id: `decision-harness-worker-v10-authority-spawn-revalidation-${key.slice(0, 24)}`,
    binding_ref: `binding://replay-decision-harness-worker-v10-authority-spawn-revalidation/${key.slice(0, 24)}`,
    binding_key: key,
    binding_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_SPAWN_REVALIDATION_POLICY_VERSION,
    scope: "one_capsule_bound_control_plane_revalidation_before_process_start",
    owner: "replay_runner_worker_v10_authority_spawn_revalidation_registry",
    purpose: "bind_exact_durable_capsule_challenge_and_current_attempt_receipt_without_spawn",
    status: "spawn_boundary_revalidated_process_not_materialized",
    source_authority_capsule_id: capsule.capsule_id,
    source_authority_capsule_key: capsule.capsule_key,
    source_authority_capsule_record_hash: capsule.record_hash,
    authority_capsule_hash: capsule.capsule_hash,
    source_authority_capsule: structuredClone(capsule),
    source_revalidation_request_id: request.request_id,
    source_revalidation_request_hash: request.request_hash,
    source_revalidation_request: structuredClone(request),
    control_plane_revalidation_receipt_id: receipt.receipt_id,
    control_plane_revalidation_receipt_ref: receipt.receipt_ref,
    control_plane_revalidation_receipt_hash: receipt.receipt_hash,
    control_plane_revalidation_receipt: structuredClone(receipt),
    source_authority_process_launch_intent_hash: capsule.source_authority_process_launch_intent_hash,
    source_authority_execution_admission_command_hash:
      capsule.source_authority_execution_admission_command_hash,
    source_authority_transport_contract_hash: capsule.source_authority_transport_contract_hash,
    process_artifact_hash: capsule.process_artifact_hash,
    worker_request_hash: capsule.worker_request_hash,
    attempt_id: capsule.attempt_id,
    attempt_ordinal: capsule.attempt_ordinal,
    worker_id: capsule.worker_id,
    lease_generation: capsule.lease_generation,
    current_attempt_status: receipt.current_attempt_status,
    current_attempt_lease_hash: receipt.current_attempt_lease_hash,
    registry_read_started_at: receipt.registry_read_started_at,
    registry_read_completed_at: receipt.registry_read_completed_at,
    revalidated_at: receipt.revalidated_at,
    valid_before: receipt.valid_before,
    revalidation_order:
      "durable_capsule_then_durable_challenge_then_control_plane_clock_bracketed_current_attempt_read",
    freshness_semantics: "receipt_binds_capsule_challenge_and_does_not_reuse_pre_capsule_clock_evidence",
    race_limit: "cancellation_or_fencing_may_occur_after_receipt_before_kernel_process_start",
    consumption_policy: "single_immediate_attempt_bound_spawn_candidate_no_retry_or_reuse",
    spawn_transition_authority: "granted_for_one_immediate_attempt_bound_process_start_candidate",
    process_start_evidence: "none",
    authority_transport_contract_instance_count: 1,
    authority_execution_admission_command_instance_count: 1,
    authority_process_launch_intent_instance_count: 1,
    authority_capsule_instance_count: 1,
    spawn_boundary_revalidation_request_count: 1,
    spawn_boundary_revalidation_receipt_count: 1,
    blocker_set_policy: "complete_deterministic_ordered_post_revalidation_pre_dispatch_blockers",
    blockers: replayDecisionHarnessWorkerV10AuthoritySpawnRevalidationBlockers(),
    process_launch_receipt: null,
    process_launch_receipt_count: 0,
    admitted_process_instance: null,
    admitted_process_instance_count: 0,
    process_launch_occurrence: "not_materialized",
    request_frame_instance_count: 0,
    request_write_receipt_count: 0,
    request_decode_receipt_count: 0,
    response_frame_instance_count: 0,
    response_read_receipt_count: 0,
    dispatch_occurrence: "not_materialized",
    transport_activation: "spawn_revalidated_process_and_frames_blocked",
    harness_invocation: "forbidden",
    response_admission: "not_granted",
    decision_output_authority: "none",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
    trial_authority: "none",
  })
}

export function assertReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidationLineage(
  value: ReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidation,
  input: BuildReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidationInput,
): void {
  const expected = buildReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidation(input)
  if (canonicalHash(value) !== canonicalHash(expected)) {
    throw new Error("decision harness Worker v10 Authority Spawn Boundary Revalidation lineage drift")
  }
}
