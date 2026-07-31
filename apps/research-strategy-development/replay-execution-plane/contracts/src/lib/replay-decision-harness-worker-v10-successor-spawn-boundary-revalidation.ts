import { canonicalHash, canonicalJson } from "./replay-contracts"
import {
  assertReplaySpawnBoundaryRevalidationReceiptView,
  assertReplaySpawnBoundaryRevalidationRequestView,
  type ReplaySpawnBoundaryRevalidationReceiptView,
  type ReplaySpawnBoundaryRevalidationRequestView,
} from "./replay-decision-harness-worker-v10-authority-spawn-boundary-revalidation"
import {
  assertReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleLineage,
  assertReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord,
  type ReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord,
} from "./replay-decision-harness-worker-v10-successor-authority-capsule"
import {
  type ReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent,
} from "./replay-decision-harness-worker-v10-successor-process-launch-intent"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
  requireReplayCrossSourceUtc as requireUtc,
} from "./replay-cross-source-ordering"

export const REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_SPAWN_REVALIDATION_SCHEMA_VERSION =
  "trade.rd-replay-decision-harness-worker-v10-successor-spawn-boundary-revalidation.v1" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_SPAWN_REVALIDATION_POLICY_VERSION =
  "rd-replay-harness-worker-v10-successor-spawn-boundary-revalidation-v1" as const

const BLOCKERS = [
  "successor_worker_process_and_request_dispatch_not_materialized",
  "second_response_schedule_pair_and_harness_receipt_not_materialized",
] as const

export interface ReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation {
  schema_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_SPAWN_REVALIDATION_SCHEMA_VERSION
  binding_id: string
  binding_ref: string
  binding_key: string
  binding_hash: string
  binding_policy_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_SPAWN_REVALIDATION_POLICY_VERSION
  scope: "one_successor_capsule_bound_control_plane_revalidation_before_process_start"
  owner: "replay_runner_worker_v10_successor_spawn_revalidation_registry"
  purpose: "bind_exact_successor_capsule_challenge_and_control_plane_receipt_without_spawn"
  status: "successor_spawn_boundary_revalidated_process_not_materialized"
  source_successor_authority_capsule_id: string
  source_successor_authority_capsule_key: string
  source_successor_authority_capsule_record_hash: string
  source_capsule_parent_canonical_file_sha256: string
  authority_capsule_hash: string
  source_successor_process_launch_intent_hash: string
  source_intent_parent_canonical_file_sha256: string
  source_intent_issued_at: string
  source_revalidation_request_id: string
  source_revalidation_request_key: string
  source_revalidation_request_hash: string
  source_request_canonical_file_sha256: string
  source_revalidation_request: ReplaySpawnBoundaryRevalidationRequestView
  control_plane_revalidation_receipt_id: string
  control_plane_revalidation_receipt_ref: string
  control_plane_revalidation_receipt_hash: string
  source_receipt_canonical_file_sha256: string
  control_plane_revalidation_receipt: ReplaySpawnBoundaryRevalidationReceiptView
  source_execution_admission_command_hash: string
  source_artifact_bound_transport_contract_hash: string
  source_execution_envelope_hash: string
  process_artifact_hash: string
  target_logical_request_id: string
  target_worker_request_hash: string
  attempt_id: string
  attempt_ordinal: number
  worker_id: string
  lease_generation: number
  current_attempt_status: "running"
  current_attempt_lease_hash: string
  registry_read_started_at: string
  registry_read_completed_at: string
  revalidated_at: string
  valid_before: string
  revalidation_order:
    "durable_successor_capsule_then_durable_challenge_then_control_plane_clock_bracketed_read"
  freshness_semantics:
    "receipt_read_starts_strictly_after_successor_intent_and_does_not_reuse_pre_capsule_clock"
  parent_closure_policy:
    "exact_capsule_intent_request_receipt_hash_and_file_sha256_no_recursive_lineage_embedding"
  race_limit: "cancellation_or_fencing_may_occur_after_receipt_before_kernel_process_start"
  consumption_policy: "single_immediate_attempt_bound_spawn_candidate_no_retry_or_reuse"
  spawn_transition_authority: "granted_for_one_immediate_attempt_bound_process_start_candidate"
  process_start_evidence: "none"
  successor_execution_admission_command_count: 1
  successor_process_launch_intent_count: 1
  successor_authority_capsule_count: 1
  successor_spawn_revalidation_request_count: 1
  successor_spawn_revalidation_receipt_count: 1
  successor_spawn_revalidation_count: 1
  successor_worker_process_count: 0
  successor_worker_request_frame_count: 0
  successor_worker_request_decode_count: 0
  second_response_count: 0
  second_schedule_admission_count: 0
  reproducibility_pair_count: 0
  harness_receipt_count: 0
  blocker_set_policy: "complete_deterministic_ordered_post_successor_revalidation_blockers"
  blockers: typeof BLOCKERS
  process_launch_occurrence: "not_materialized"
  dispatch_occurrence: "not_materialized"
  transport_activation: "successor_spawn_revalidated_process_and_frames_blocked"
  harness_invocation: "forbidden"
  response_admission: "not_granted"
  decision_output_authority: "first_schedule_matched_claim_only_successor_spawn_candidate_committed"
  signal_authority: "none"
  order_authority: "none"
  economic_authority: "none"
  trial_authority: "none"
}

export type ReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidationBody = Omit<
  ReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation,
  "binding_hash"
>

export function replayDecisionHarnessWorkerV10SuccessorSpawnRevalidationKey(input: {
  source_revalidation_request_hash: string
  binding_policy_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_SPAWN_REVALIDATION_POLICY_VERSION
}): string {
  requireHash(input.source_revalidation_request_hash, "successor Spawn Revalidation Request hash")
  if (input.binding_policy_version
      !== REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_SPAWN_REVALIDATION_POLICY_VERSION) {
    throw new Error("unsupported successor Spawn Revalidation natural key")
  }
  return canonicalHash(input)
}

export function createReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation(
  body: ReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidationBody,
): ReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation {
  const value = { ...structuredClone(body), binding_hash: canonicalHash(body) }
  assertReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation(value)
  return value
}

export function assertReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation(
  value: ReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation,
): void {
  assertFields(value)
  if (value.schema_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_SPAWN_REVALIDATION_SCHEMA_VERSION
      || value.binding_policy_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_SPAWN_REVALIDATION_POLICY_VERSION
      || value.scope
        !== "one_successor_capsule_bound_control_plane_revalidation_before_process_start"
      || value.owner !== "replay_runner_worker_v10_successor_spawn_revalidation_registry"
      || value.purpose
        !== "bind_exact_successor_capsule_challenge_and_control_plane_receipt_without_spawn"
      || value.status !== "successor_spawn_boundary_revalidated_process_not_materialized"
      || value.current_attempt_status !== "running"
      || value.revalidation_order
        !== "durable_successor_capsule_then_durable_challenge_then_control_plane_clock_bracketed_read"
      || value.freshness_semantics
        !== "receipt_read_starts_strictly_after_successor_intent_and_does_not_reuse_pre_capsule_clock"
      || value.parent_closure_policy
        !== "exact_capsule_intent_request_receipt_hash_and_file_sha256_no_recursive_lineage_embedding"
      || value.race_limit
        !== "cancellation_or_fencing_may_occur_after_receipt_before_kernel_process_start"
      || value.consumption_policy !== "single_immediate_attempt_bound_spawn_candidate_no_retry_or_reuse"
      || value.spawn_transition_authority
        !== "granted_for_one_immediate_attempt_bound_process_start_candidate"
      || value.process_start_evidence !== "none"
      || value.successor_execution_admission_command_count !== 1
      || value.successor_process_launch_intent_count !== 1
      || value.successor_authority_capsule_count !== 1
      || value.successor_spawn_revalidation_request_count !== 1
      || value.successor_spawn_revalidation_receipt_count !== 1
      || value.successor_spawn_revalidation_count !== 1
      || value.successor_worker_process_count !== 0
      || value.successor_worker_request_frame_count !== 0
      || value.successor_worker_request_decode_count !== 0
      || value.second_response_count !== 0 || value.second_schedule_admission_count !== 0
      || value.reproducibility_pair_count !== 0 || value.harness_receipt_count !== 0
      || value.blocker_set_policy
        !== "complete_deterministic_ordered_post_successor_revalidation_blockers"
      || canonicalJson(value.blockers) !== canonicalJson(BLOCKERS)
      || value.process_launch_occurrence !== "not_materialized"
      || value.dispatch_occurrence !== "not_materialized"
      || value.transport_activation !== "successor_spawn_revalidated_process_and_frames_blocked"
      || value.harness_invocation !== "forbidden" || value.response_admission !== "not_granted"
      || value.decision_output_authority
        !== "first_schedule_matched_claim_only_successor_spawn_candidate_committed"
      || value.signal_authority !== "none" || value.order_authority !== "none"
      || value.economic_authority !== "none" || value.trial_authority !== "none") {
    throw new Error("unsupported successor Spawn Boundary Revalidation authority")
  }
  for (const item of [value.binding_id, value.binding_ref,
    value.source_successor_authority_capsule_id, value.source_revalidation_request_id,
    value.control_plane_revalidation_receipt_id, value.control_plane_revalidation_receipt_ref,
    value.attempt_id, value.worker_id]) requireText(item, "successor Spawn Revalidation identity")
  for (const item of [value.binding_key, value.binding_hash,
    value.source_successor_authority_capsule_key,
    value.source_successor_authority_capsule_record_hash,
    value.source_capsule_parent_canonical_file_sha256, value.authority_capsule_hash,
    value.source_successor_process_launch_intent_hash,
    value.source_intent_parent_canonical_file_sha256, value.source_revalidation_request_key,
    value.source_revalidation_request_hash, value.source_request_canonical_file_sha256,
    value.control_plane_revalidation_receipt_hash, value.source_receipt_canonical_file_sha256,
    value.source_execution_admission_command_hash,
    value.source_artifact_bound_transport_contract_hash, value.source_execution_envelope_hash,
    value.process_artifact_hash, value.target_logical_request_id, value.target_worker_request_hash,
    value.current_attempt_lease_hash]) requireHash(item, "successor Spawn Revalidation hash")
  for (const item of [value.source_intent_issued_at, value.registry_read_started_at,
    value.registry_read_completed_at, value.revalidated_at, value.valid_before]) {
    requireUtc(item, "successor Spawn Revalidation time")
  }
  if (!Number.isSafeInteger(value.attempt_ordinal) || value.attempt_ordinal < 1
      || !Number.isSafeInteger(value.lease_generation) || value.lease_generation < 1) {
    throw new Error("successor Spawn Revalidation Attempt binding")
  }
  assertReplaySpawnBoundaryRevalidationRequestView(value.source_revalidation_request)
  assertReplaySpawnBoundaryRevalidationReceiptView(value.control_plane_revalidation_receipt)
  const request = value.source_revalidation_request
  const receipt = value.control_plane_revalidation_receipt
  const key = replayDecisionHarnessWorkerV10SuccessorSpawnRevalidationKey({
    source_revalidation_request_hash: request.request_hash,
    binding_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_SPAWN_REVALIDATION_POLICY_VERSION,
  })
  const { binding_hash: bindingHash, ...body } = value
  if (value.binding_key !== key
      || value.binding_id
        !== `decision-harness-worker-v10-successor-spawn-revalidation-${key.slice(0, 24)}`
      || value.binding_ref
        !== `binding://replay-decision-harness-worker-v10-successor-spawn-revalidation/${key.slice(0, 24)}`
      || value.source_revalidation_request_id !== request.request_id
      || value.source_revalidation_request_key !== request.request_key
      || value.source_revalidation_request_hash !== request.request_hash
      || value.control_plane_revalidation_receipt_id !== receipt.receipt_id
      || value.control_plane_revalidation_receipt_ref !== receipt.receipt_ref
      || value.control_plane_revalidation_receipt_hash !== receipt.receipt_hash
      || canonicalJson(receipt.source_request) !== canonicalJson(request)
      || request.source_authority_capsule_record_hash
        !== value.source_successor_authority_capsule_record_hash
      || request.authority_capsule_hash !== value.authority_capsule_hash
      || request.source_authority_process_launch_intent_hash
        !== value.source_successor_process_launch_intent_hash
      || request.source_authority_execution_admission_command_hash
        !== value.source_execution_admission_command_hash
      || request.source_authority_transport_contract_hash
        !== value.source_artifact_bound_transport_contract_hash
      || request.process_artifact_hash !== value.process_artifact_hash
      || request.worker_request_hash !== value.target_worker_request_hash
      || value.attempt_id !== request.attempt_id || value.attempt_id !== receipt.current_attempt_lease.attempt_id
      || value.attempt_ordinal !== request.attempt_ordinal
      || value.attempt_ordinal !== receipt.current_attempt_lease.attempt_ordinal
      || value.worker_id !== request.worker_id || value.worker_id !== receipt.current_attempt_lease.worker_id
      || value.lease_generation !== request.lease_generation
      || value.lease_generation !== receipt.current_attempt_lease.lease_generation
      || value.current_attempt_status !== receipt.current_attempt_status
      || value.current_attempt_lease_hash !== request.expected_current_attempt_lease_hash
      || value.current_attempt_lease_hash !== receipt.current_attempt_lease_hash
      || value.registry_read_started_at !== receipt.registry_read_started_at
      || value.registry_read_completed_at !== receipt.registry_read_completed_at
      || value.revalidated_at !== receipt.revalidated_at || value.valid_before !== receipt.valid_before
      || value.valid_before !== request.expected_valid_before
      || Date.parse(value.registry_read_started_at) <= Date.parse(value.source_intent_issued_at)
      || bindingHash !== canonicalHash(body)) {
    throw new Error("successor Spawn Revalidation Request, Receipt, chronology, or hash drift")
  }
}

export function assertReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidationLineage(
  value: ReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation,
  capsule: ReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord,
  intent: ReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent,
): void {
  assertReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation(value)
  assertReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord(capsule)
  assertReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleLineage(capsule, intent)
  if (value.source_successor_authority_capsule_id !== capsule.capsule_id
      || value.source_successor_authority_capsule_key !== capsule.capsule_key
      || value.source_successor_authority_capsule_record_hash !== capsule.record_hash
      || value.authority_capsule_hash !== capsule.capsule_hash
      || value.source_successor_process_launch_intent_hash !== intent.intent_hash
      || value.source_intent_issued_at !== intent.intent_issued_at
      || value.source_execution_admission_command_hash
        !== capsule.source_execution_admission_command_hash
      || value.source_artifact_bound_transport_contract_hash
        !== capsule.source_artifact_bound_transport_contract_hash
      || value.source_execution_envelope_hash !== capsule.source_execution_envelope_hash
      || value.process_artifact_hash !== capsule.process_artifact_hash
      || value.target_logical_request_id !== capsule.target_logical_request_id
      || value.target_worker_request_hash !== capsule.target_worker_request_hash
      || value.attempt_id !== capsule.attempt_id || value.attempt_ordinal !== capsule.attempt_ordinal
      || value.worker_id !== capsule.worker_id || value.lease_generation !== capsule.lease_generation
      || value.current_attempt_lease_hash !== capsule.current_attempt_lease_hash
      || value.valid_before !== capsule.valid_before) {
    throw new Error("successor Spawn Revalidation direct parent binding drift")
  }
}

const FIELDS = ["attempt_id", "attempt_ordinal", "authority_capsule_hash", "binding_hash",
  "binding_id", "binding_key", "binding_policy_version", "binding_ref", "blocker_set_policy",
  "blockers", "consumption_policy", "control_plane_revalidation_receipt",
  "control_plane_revalidation_receipt_hash", "control_plane_revalidation_receipt_id",
  "control_plane_revalidation_receipt_ref", "current_attempt_lease_hash", "current_attempt_status",
  "decision_output_authority", "dispatch_occurrence", "economic_authority", "freshness_semantics",
  "harness_invocation", "harness_receipt_count", "lease_generation", "order_authority", "owner",
  "parent_closure_policy", "process_artifact_hash", "process_launch_occurrence",
  "process_start_evidence", "purpose", "race_limit", "registry_read_completed_at",
  "registry_read_started_at", "reproducibility_pair_count", "response_admission", "revalidated_at",
  "revalidation_order", "schema_version", "scope", "second_response_count",
  "second_schedule_admission_count", "signal_authority", "source_artifact_bound_transport_contract_hash",
  "source_capsule_parent_canonical_file_sha256", "source_execution_admission_command_hash",
  "source_execution_envelope_hash", "source_intent_issued_at",
  "source_intent_parent_canonical_file_sha256", "source_receipt_canonical_file_sha256",
  "source_request_canonical_file_sha256", "source_revalidation_request",
  "source_revalidation_request_hash", "source_revalidation_request_id", "source_revalidation_request_key",
  "source_successor_authority_capsule_id", "source_successor_authority_capsule_key",
  "source_successor_authority_capsule_record_hash", "source_successor_process_launch_intent_hash",
  "spawn_transition_authority", "status", "successor_authority_capsule_count",
  "successor_execution_admission_command_count", "successor_process_launch_intent_count",
  "successor_spawn_revalidation_count", "successor_spawn_revalidation_receipt_count",
  "successor_spawn_revalidation_request_count", "successor_worker_process_count",
  "successor_worker_request_decode_count", "successor_worker_request_frame_count",
  "target_logical_request_id", "target_worker_request_hash", "transport_activation", "trial_authority",
  "valid_before", "worker_id"].sort()

function assertFields(value: object): void {
  if (canonicalHash(Object.keys(value).sort()) !== canonicalHash(FIELDS)) {
    throw new Error("successor Spawn Boundary Revalidation field whitelist drift")
  }
}
