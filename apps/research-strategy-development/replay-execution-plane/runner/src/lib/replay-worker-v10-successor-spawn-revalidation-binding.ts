import { createHash } from "node:crypto"
import type {
  ReplaySpawnBoundaryRevalidationReceipt,
  ReplaySpawnBoundaryRevalidationRequest,
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_SPAWN_REVALIDATION_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_SPAWN_REVALIDATION_SCHEMA_VERSION,
  createReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation,
  replayDecisionHarnessWorkerV10SuccessorSpawnRevalidationKey,
  type ReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-spawn-boundary-revalidation"
import { canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import type { ReplayWorkerV10SuccessorSpawnDurableParents } from "./replay-worker-v10-successor-spawn-revalidation-types"

export function buildReplayWorkerV10SuccessorSpawnRevalidationBinding(
  parents: ReplayWorkerV10SuccessorSpawnDurableParents,
  request: ReplaySpawnBoundaryRevalidationRequest,
  receipt: ReplaySpawnBoundaryRevalidationReceipt,
): ReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation {
  const capsule = parents.capsule
  const intent = parents.intent
  const key = replayDecisionHarnessWorkerV10SuccessorSpawnRevalidationKey({
    source_revalidation_request_hash: request.request_hash,
    binding_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_SPAWN_REVALIDATION_POLICY_VERSION,
  })
  return createReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation({
    schema_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_SPAWN_REVALIDATION_SCHEMA_VERSION,
    binding_id: `decision-harness-worker-v10-successor-spawn-revalidation-${key.slice(0, 24)}`,
    binding_ref:
      `binding://replay-decision-harness-worker-v10-successor-spawn-revalidation/${key.slice(0, 24)}`,
    binding_key: key,
    binding_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_SPAWN_REVALIDATION_POLICY_VERSION,
    scope: "one_successor_capsule_bound_control_plane_revalidation_before_process_start",
    owner: "replay_runner_worker_v10_successor_spawn_revalidation_registry",
    purpose: "bind_exact_successor_capsule_challenge_and_control_plane_receipt_without_spawn",
    status: "successor_spawn_boundary_revalidated_process_not_materialized",
    source_successor_authority_capsule_id: capsule.capsule_id,
    source_successor_authority_capsule_key: capsule.capsule_key,
    source_successor_authority_capsule_record_hash: capsule.record_hash,
    source_capsule_parent_canonical_file_sha256: parents.capsule_file_sha256,
    authority_capsule_hash: capsule.capsule_hash,
    source_successor_process_launch_intent_hash: intent.intent_hash,
    source_intent_parent_canonical_file_sha256: parents.intent_file_sha256,
    source_intent_issued_at: intent.intent_issued_at,
    source_revalidation_request_id: request.request_id,
    source_revalidation_request_key: request.request_key,
    source_revalidation_request_hash: request.request_hash,
    source_request_canonical_file_sha256: canonicalFileSha256(request),
    source_revalidation_request: structuredClone(request),
    control_plane_revalidation_receipt_id: receipt.receipt_id,
    control_plane_revalidation_receipt_ref: receipt.receipt_ref,
    control_plane_revalidation_receipt_hash: receipt.receipt_hash,
    source_receipt_canonical_file_sha256: canonicalFileSha256(receipt),
    control_plane_revalidation_receipt: structuredClone(receipt),
    source_execution_admission_command_hash: capsule.source_execution_admission_command_hash,
    source_artifact_bound_transport_contract_hash:
      capsule.source_artifact_bound_transport_contract_hash,
    source_execution_envelope_hash: capsule.source_execution_envelope_hash,
    process_artifact_hash: capsule.process_artifact_hash,
    target_logical_request_id: capsule.target_logical_request_id,
    target_worker_request_hash: capsule.target_worker_request_hash,
    attempt_id: capsule.attempt_id,
    attempt_ordinal: capsule.attempt_ordinal,
    worker_id: capsule.worker_id,
    lease_generation: capsule.lease_generation,
    current_attempt_status: "running",
    current_attempt_lease_hash: receipt.current_attempt_lease_hash,
    registry_read_started_at: receipt.registry_read_started_at,
    registry_read_completed_at: receipt.registry_read_completed_at,
    revalidated_at: receipt.revalidated_at,
    valid_before: receipt.valid_before,
    revalidation_order:
      "durable_successor_capsule_then_durable_challenge_then_control_plane_clock_bracketed_read",
    freshness_semantics:
      "receipt_read_starts_strictly_after_successor_intent_and_does_not_reuse_pre_capsule_clock",
    parent_closure_policy:
      "exact_capsule_intent_request_receipt_hash_and_file_sha256_no_recursive_lineage_embedding",
    race_limit: "cancellation_or_fencing_may_occur_after_receipt_before_kernel_process_start",
    consumption_policy: "single_immediate_attempt_bound_spawn_candidate_no_retry_or_reuse",
    spawn_transition_authority: "granted_for_one_immediate_attempt_bound_process_start_candidate",
    process_start_evidence: "none",
    successor_execution_admission_command_count: 1,
    successor_process_launch_intent_count: 1,
    successor_authority_capsule_count: 1,
    successor_spawn_revalidation_request_count: 1,
    successor_spawn_revalidation_receipt_count: 1,
    successor_spawn_revalidation_count: 1,
    successor_worker_process_count: 0,
    successor_worker_request_frame_count: 0,
    successor_worker_request_decode_count: 0,
    second_response_count: 0,
    second_schedule_admission_count: 0,
    reproducibility_pair_count: 0,
    harness_receipt_count: 0,
    blocker_set_policy: "complete_deterministic_ordered_post_successor_revalidation_blockers",
    blockers: ["successor_worker_process_and_request_dispatch_not_materialized",
      "second_response_schedule_pair_and_harness_receipt_not_materialized"],
    process_launch_occurrence: "not_materialized",
    dispatch_occurrence: "not_materialized",
    transport_activation: "successor_spawn_revalidated_process_and_frames_blocked",
    harness_invocation: "forbidden",
    response_admission: "not_granted",
    decision_output_authority: "first_schedule_matched_claim_only_successor_spawn_candidate_committed",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
    trial_authority: "none",
  })
}

function canonicalFileSha256(value: unknown): string {
  return createHash("sha256").update(`${canonicalJson(value)}\n`, "utf8").digest("hex")
}
