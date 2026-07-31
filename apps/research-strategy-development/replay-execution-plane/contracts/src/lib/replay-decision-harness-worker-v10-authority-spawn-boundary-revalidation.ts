import { canonicalHash, canonicalJson } from "./replay-contracts"
import {
  assertReplayAttemptLeaseEnvelopeView,
  type ReplayAttemptLeaseEnvelopeView,
} from "./replay-decision-harness-execution-envelope"
import {
  assertReplayDecisionHarnessWorkerV10AuthorityCapsuleRecord,
  type ReplayDecisionHarnessWorkerV10AuthorityCapsuleRecord,
} from "./replay-decision-harness-worker-v10-authority-capsule"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
  requireReplayCrossSourceUtc as requireUtc,
} from "./replay-cross-source-ordering"

export const REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_SPAWN_REVALIDATION_SCHEMA_VERSION =
  "trade.rd-replay-decision-harness-worker-v10-authority-spawn-boundary-revalidation.v1" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_SPAWN_REVALIDATION_POLICY_VERSION =
  "rd-replay-harness-worker-v10-authority-spawn-boundary-revalidation-v1" as const
export const REPLAY_SPAWN_BOUNDARY_REVALIDATION_REQUEST_VIEW_SCHEMA_VERSION =
  "trade.rd-replay-spawn-boundary-revalidation-request.v1" as const
export const REPLAY_SPAWN_BOUNDARY_REVALIDATION_REQUEST_VIEW_POLICY_VERSION =
  "rd-replay-spawn-boundary-revalidation-request-v1" as const
export const REPLAY_SPAWN_BOUNDARY_REVALIDATION_RECEIPT_VIEW_SCHEMA_VERSION =
  "trade.rd-replay-spawn-boundary-revalidation-receipt.v1" as const
export const REPLAY_SPAWN_BOUNDARY_REVALIDATION_RECEIPT_VIEW_POLICY_VERSION =
  "rd-replay-spawn-boundary-revalidation-receipt-v1" as const

// Replay owns these immutable inbound wire views. The Control Plane remains the
// producer and authority owner; Replay validates the serialized boundary value
// without importing the Control Plane implementation package.
export interface ReplaySpawnBoundaryRevalidationRequestView {
  schema_version: typeof REPLAY_SPAWN_BOUNDARY_REVALIDATION_REQUEST_VIEW_SCHEMA_VERSION
  request_id: string
  request_ref: string
  request_key: string
  request_hash: string
  request_policy_version: typeof REPLAY_SPAWN_BOUNDARY_REVALIDATION_REQUEST_VIEW_POLICY_VERSION
  status: "capsule_bound_current_attempt_revalidation_requested"
  requester_owner: "replay_runner"
  authority_target: "research_control_plane"
  purpose: "revalidate_exact_current_attempt_after_capsule_commit_before_spawn"
  source_authority_capsule_record_hash: string
  authority_capsule_hash: string
  source_authority_process_launch_intent_hash: string
  source_authority_execution_admission_command_hash: string
  source_authority_transport_contract_hash: string
  process_artifact_hash: string
  worker_request_hash: string
  attempt_id: string
  attempt_ordinal: number
  worker_id: string
  lease_generation: number
  expected_current_attempt_lease_hash: string
  expected_valid_before: string
  challenge_policy: "one_capsule_bound_challenge_no_caller_time_or_state_substitution"
  retry_policy: "fresh_command_intent_capsule_authority_lineage_required_after_failed_or_stale_challenge"
  process_authority: "none"
}

export interface ReplaySpawnBoundaryRevalidationReceiptView {
  schema_version: typeof REPLAY_SPAWN_BOUNDARY_REVALIDATION_RECEIPT_VIEW_SCHEMA_VERSION
  receipt_id: string
  receipt_ref: string
  receipt_hash: string
  receipt_policy_version: typeof REPLAY_SPAWN_BOUNDARY_REVALIDATION_RECEIPT_VIEW_POLICY_VERSION
  status: "capsule_bound_current_attempt_revalidated"
  authority_owner: "research_control_plane"
  authority_source: "research_control_plane_state_store"
  source_request_id: string
  source_request_ref: string
  source_request_hash: string
  source_request: ReplaySpawnBoundaryRevalidationRequestView
  clock_source: "control_plane_authority_process_clock_port"
  clock_independence: "authority_internal_sampling_without_caller_timestamp_input"
  caller_time_input: "forbidden"
  wall_clock_source: "javascript_date_now_utc"
  monotonic_clock_source: "process_hrtime_bigint"
  external_time_attestation: "not_provided"
  current_attempt_read: "single_control_plane_transaction_exact_attempt_worker_generation_and_lease_hash"
  registry_read_started_at: string
  registry_read_completed_at: string
  registry_read_started_monotonic_ns: string
  registry_read_completed_monotonic_ns: string
  current_attempt_status: "claimed" | "running"
  current_attempt_lease_hash: string
  current_attempt_lease: ReplayAttemptLeaseEnvelopeView
  revalidated_at: string
  valid_before: string
  spawn_candidate_authority: "single_immediate_spawn_candidate_not_process_start_evidence"
  race_limit: "receipt_cannot_prove_absence_of_cancellation_or_fencing_after_completed_read"
  process_authority: "none"
}

export type ReplayDecisionHarnessWorkerV10AuthoritySpawnRevalidationBlocker =
  | "attempt_bound_process_launch_receipt_not_materialized"
  | "authority_frame_write_decode_read_and_admission_not_materialized"

export interface ReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidation {
  schema_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_SPAWN_REVALIDATION_SCHEMA_VERSION
  binding_id: string
  binding_ref: string
  binding_key: string
  binding_hash: string
  binding_policy_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_SPAWN_REVALIDATION_POLICY_VERSION
  scope: "one_capsule_bound_control_plane_revalidation_before_process_start"
  owner: "replay_runner_worker_v10_authority_spawn_revalidation_registry"
  purpose: "bind_exact_durable_capsule_challenge_and_current_attempt_receipt_without_spawn"
  status: "spawn_boundary_revalidated_process_not_materialized"
  source_authority_capsule_id: string
  source_authority_capsule_key: string
  source_authority_capsule_record_hash: string
  authority_capsule_hash: string
  source_authority_capsule: ReplayDecisionHarnessWorkerV10AuthorityCapsuleRecord
  source_revalidation_request_id: string
  source_revalidation_request_hash: string
  source_revalidation_request: ReplaySpawnBoundaryRevalidationRequestView
  control_plane_revalidation_receipt_id: string
  control_plane_revalidation_receipt_ref: string
  control_plane_revalidation_receipt_hash: string
  control_plane_revalidation_receipt: ReplaySpawnBoundaryRevalidationReceiptView
  source_authority_process_launch_intent_hash: string
  source_authority_execution_admission_command_hash: string
  source_authority_transport_contract_hash: string
  process_artifact_hash: string
  worker_request_hash: string
  attempt_id: string
  attempt_ordinal: number
  worker_id: string
  lease_generation: number
  current_attempt_status: "claimed" | "running"
  current_attempt_lease_hash: string
  registry_read_started_at: string
  registry_read_completed_at: string
  revalidated_at: string
  valid_before: string
  revalidation_order:
    "durable_capsule_then_durable_challenge_then_control_plane_clock_bracketed_current_attempt_read"
  freshness_semantics: "receipt_binds_capsule_challenge_and_does_not_reuse_pre_capsule_clock_evidence"
  race_limit: "cancellation_or_fencing_may_occur_after_receipt_before_kernel_process_start"
  consumption_policy: "single_immediate_attempt_bound_spawn_candidate_no_retry_or_reuse"
  spawn_transition_authority: "granted_for_one_immediate_attempt_bound_process_start_candidate"
  process_start_evidence: "none"
  authority_transport_contract_instance_count: 1
  authority_execution_admission_command_instance_count: 1
  authority_process_launch_intent_instance_count: 1
  authority_capsule_instance_count: 1
  spawn_boundary_revalidation_request_count: 1
  spawn_boundary_revalidation_receipt_count: 1
  blocker_set_policy: "complete_deterministic_ordered_post_revalidation_pre_dispatch_blockers"
  blockers: ReplayDecisionHarnessWorkerV10AuthoritySpawnRevalidationBlocker[]
  process_launch_receipt: null
  process_launch_receipt_count: 0
  admitted_process_instance: null
  admitted_process_instance_count: 0
  process_launch_occurrence: "not_materialized"
  request_frame_instance_count: 0
  request_write_receipt_count: 0
  request_decode_receipt_count: 0
  response_frame_instance_count: 0
  response_read_receipt_count: 0
  dispatch_occurrence: "not_materialized"
  transport_activation: "spawn_revalidated_process_and_frames_blocked"
  harness_invocation: "forbidden"
  response_admission: "not_granted"
  decision_output_authority: "none"
  signal_authority: "none"
  order_authority: "none"
  economic_authority: "none"
  trial_authority: "none"
}

export type ReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidationBody = Omit<
  ReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidation,
  "binding_hash"
>

export function replayDecisionHarnessWorkerV10AuthoritySpawnRevalidationBlockers():
ReplayDecisionHarnessWorkerV10AuthoritySpawnRevalidationBlocker[] {
  return [
    "attempt_bound_process_launch_receipt_not_materialized",
    "authority_frame_write_decode_read_and_admission_not_materialized",
  ]
}

export function replayDecisionHarnessWorkerV10AuthoritySpawnRevalidationKey(input: {
  source_revalidation_request_hash: string
  binding_policy_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_SPAWN_REVALIDATION_POLICY_VERSION
}): string {
  requireHash(input.source_revalidation_request_hash, "Authority Spawn Revalidation Request hash")
  if (input.binding_policy_version
      !== REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_SPAWN_REVALIDATION_POLICY_VERSION) {
    throw new Error("unsupported Authority Spawn Revalidation natural key")
  }
  return canonicalHash(input)
}

export function createReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidation(
  body: ReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidationBody,
): ReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidation {
  const value = { ...structuredClone(body), binding_hash: canonicalHash(body) }
  assertReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidation(value)
  return value
}

export function assertReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidation(
  value: ReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidation,
): void {
  assertFields(value)
  if (value.schema_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_SPAWN_REVALIDATION_SCHEMA_VERSION
      || value.binding_policy_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_SPAWN_REVALIDATION_POLICY_VERSION
      || value.scope !== "one_capsule_bound_control_plane_revalidation_before_process_start"
      || value.owner !== "replay_runner_worker_v10_authority_spawn_revalidation_registry"
      || value.purpose
        !== "bind_exact_durable_capsule_challenge_and_current_attempt_receipt_without_spawn"
      || value.status !== "spawn_boundary_revalidated_process_not_materialized"
      || value.revalidation_order
        !== "durable_capsule_then_durable_challenge_then_control_plane_clock_bracketed_current_attempt_read"
      || value.freshness_semantics
        !== "receipt_binds_capsule_challenge_and_does_not_reuse_pre_capsule_clock_evidence"
      || value.race_limit
        !== "cancellation_or_fencing_may_occur_after_receipt_before_kernel_process_start"
      || value.consumption_policy !== "single_immediate_attempt_bound_spawn_candidate_no_retry_or_reuse"
      || value.spawn_transition_authority
        !== "granted_for_one_immediate_attempt_bound_process_start_candidate"
      || value.process_start_evidence !== "none"
      || value.authority_transport_contract_instance_count !== 1
      || value.authority_execution_admission_command_instance_count !== 1
      || value.authority_process_launch_intent_instance_count !== 1
      || value.authority_capsule_instance_count !== 1
      || value.spawn_boundary_revalidation_request_count !== 1
      || value.spawn_boundary_revalidation_receipt_count !== 1
      || value.blocker_set_policy !== "complete_deterministic_ordered_post_revalidation_pre_dispatch_blockers"
      || canonicalJson(value.blockers)
        !== canonicalJson(replayDecisionHarnessWorkerV10AuthoritySpawnRevalidationBlockers())
      || value.process_launch_receipt !== null || value.process_launch_receipt_count !== 0
      || value.admitted_process_instance !== null || value.admitted_process_instance_count !== 0
      || value.process_launch_occurrence !== "not_materialized"
      || value.request_frame_instance_count !== 0 || value.request_write_receipt_count !== 0
      || value.request_decode_receipt_count !== 0 || value.response_frame_instance_count !== 0
      || value.response_read_receipt_count !== 0 || value.dispatch_occurrence !== "not_materialized"
      || value.transport_activation !== "spawn_revalidated_process_and_frames_blocked"
      || value.harness_invocation !== "forbidden" || value.response_admission !== "not_granted"
      || value.decision_output_authority !== "none" || value.signal_authority !== "none"
      || value.order_authority !== "none" || value.economic_authority !== "none"
      || value.trial_authority !== "none") {
    throw new Error("unsupported Authority Spawn Boundary Revalidation authority")
  }
  for (const item of [value.binding_id, value.binding_ref, value.source_authority_capsule_id,
    value.source_revalidation_request_id, value.control_plane_revalidation_receipt_id,
    value.control_plane_revalidation_receipt_ref, value.attempt_id, value.worker_id]) {
    requireText(item, "Authority Spawn Boundary Revalidation identity")
  }
  for (const item of [value.binding_key, value.binding_hash, value.source_authority_capsule_key,
    value.source_authority_capsule_record_hash, value.authority_capsule_hash,
    value.source_revalidation_request_hash, value.control_plane_revalidation_receipt_hash,
    value.source_authority_process_launch_intent_hash,
    value.source_authority_execution_admission_command_hash,
    value.source_authority_transport_contract_hash, value.process_artifact_hash,
    value.worker_request_hash, value.current_attempt_lease_hash]) {
    requireHash(item, "Authority Spawn Boundary Revalidation hash")
  }
  for (const item of [value.registry_read_started_at, value.registry_read_completed_at,
    value.revalidated_at, value.valid_before]) requireUtc(item, "Authority Spawn Boundary Revalidation time")
  if (!Number.isSafeInteger(value.attempt_ordinal) || value.attempt_ordinal < 1
      || !Number.isSafeInteger(value.lease_generation) || value.lease_generation < 1) {
    throw new Error("Authority Spawn Boundary Revalidation Attempt binding")
  }
  assertReplayDecisionHarnessWorkerV10AuthorityCapsuleRecord(value.source_authority_capsule)
  assertReplaySpawnBoundaryRevalidationRequestView(value.source_revalidation_request)
  assertReplaySpawnBoundaryRevalidationReceiptView(value.control_plane_revalidation_receipt)
  const capsule = value.source_authority_capsule
  const request = value.source_revalidation_request
  const receipt = value.control_plane_revalidation_receipt
  const expectedKey = replayDecisionHarnessWorkerV10AuthoritySpawnRevalidationKey({
    source_revalidation_request_hash: request.request_hash,
    binding_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_SPAWN_REVALIDATION_POLICY_VERSION,
  })
  if (value.binding_key !== expectedKey
      || value.binding_id !== `decision-harness-worker-v10-authority-spawn-revalidation-${expectedKey.slice(0, 24)}`
      || value.binding_ref !== `binding://replay-decision-harness-worker-v10-authority-spawn-revalidation/${expectedKey.slice(0, 24)}`
      || value.source_authority_capsule_id !== capsule.capsule_id
      || value.source_authority_capsule_key !== capsule.capsule_key
      || value.source_authority_capsule_record_hash !== capsule.record_hash
      || value.authority_capsule_hash !== capsule.capsule_hash
      || value.source_revalidation_request_id !== request.request_id
      || value.source_revalidation_request_hash !== request.request_hash
      || value.control_plane_revalidation_receipt_id !== receipt.receipt_id
      || value.control_plane_revalidation_receipt_ref !== receipt.receipt_ref
      || value.control_plane_revalidation_receipt_hash !== receipt.receipt_hash
      || canonicalJson(receipt.source_request) !== canonicalJson(request)
      || request.source_authority_capsule_record_hash !== capsule.record_hash
      || request.authority_capsule_hash !== capsule.capsule_hash
      || value.source_authority_process_launch_intent_hash
        !== capsule.source_authority_process_launch_intent_hash
      || value.source_authority_execution_admission_command_hash
        !== capsule.source_authority_execution_admission_command_hash
      || value.source_authority_transport_contract_hash !== capsule.source_authority_transport_contract_hash
      || value.process_artifact_hash !== capsule.process_artifact_hash
      || value.worker_request_hash !== capsule.worker_request_hash
      || value.attempt_id !== capsule.attempt_id || value.attempt_id !== request.attempt_id
      || value.attempt_ordinal !== capsule.attempt_ordinal || value.attempt_ordinal !== request.attempt_ordinal
      || value.worker_id !== capsule.worker_id || value.worker_id !== request.worker_id
      || value.lease_generation !== capsule.lease_generation
      || value.lease_generation !== request.lease_generation
      || value.current_attempt_status !== receipt.current_attempt_status
      || value.current_attempt_lease_hash !== capsule.current_attempt_lease_hash
      || value.current_attempt_lease_hash !== receipt.current_attempt_lease_hash
      || value.registry_read_started_at !== receipt.registry_read_started_at
      || value.registry_read_completed_at !== receipt.registry_read_completed_at
      || value.revalidated_at !== receipt.revalidated_at || value.valid_before !== receipt.valid_before
      || value.valid_before !== capsule.valid_before) {
    throw new Error("Authority Spawn Boundary Revalidation parent, Request, Receipt, or Lease drift")
  }
  const { binding_hash: bindingHash, ...body } = value
  if (bindingHash !== canonicalHash(body)) throw new Error("Authority Spawn Boundary Revalidation hash mismatch")
}

export function assertReplaySpawnBoundaryRevalidationRequestView(
  value: ReplaySpawnBoundaryRevalidationRequestView,
): void {
  assertWireFields(value, REQUEST_VIEW_FIELDS, "spawn boundary revalidation Request view")
  if (value.schema_version !== REPLAY_SPAWN_BOUNDARY_REVALIDATION_REQUEST_VIEW_SCHEMA_VERSION
      || value.request_policy_version !== REPLAY_SPAWN_BOUNDARY_REVALIDATION_REQUEST_VIEW_POLICY_VERSION
      || value.status !== "capsule_bound_current_attempt_revalidation_requested"
      || value.requester_owner !== "replay_runner" || value.authority_target !== "research_control_plane"
      || value.purpose !== "revalidate_exact_current_attempt_after_capsule_commit_before_spawn"
      || value.challenge_policy !== "one_capsule_bound_challenge_no_caller_time_or_state_substitution"
      || value.retry_policy
        !== "fresh_command_intent_capsule_authority_lineage_required_after_failed_or_stale_challenge"
      || value.process_authority !== "none") {
    throw new Error("unsupported spawn boundary revalidation Request wire authority")
  }
  for (const item of [value.request_id, value.request_ref, value.attempt_id, value.worker_id]) {
    requireText(item, "spawn boundary revalidation Request identity")
  }
  for (const item of [value.request_key, value.request_hash, value.source_authority_capsule_record_hash,
    value.authority_capsule_hash, value.source_authority_process_launch_intent_hash,
    value.source_authority_execution_admission_command_hash, value.source_authority_transport_contract_hash,
    value.process_artifact_hash, value.worker_request_hash, value.expected_current_attempt_lease_hash]) {
    requireHash(item, "spawn boundary revalidation Request hash")
  }
  requireUtc(value.expected_valid_before, "spawn boundary revalidation Request valid_before")
  if (!Number.isSafeInteger(value.attempt_ordinal) || value.attempt_ordinal < 1
      || !Number.isSafeInteger(value.lease_generation) || value.lease_generation < 1) {
    throw new Error("spawn boundary revalidation Request Attempt binding")
  }
  const expectedKey = canonicalHash({
    source_authority_capsule_record_hash: value.source_authority_capsule_record_hash,
    attempt_id: value.attempt_id,
    worker_id: value.worker_id,
    lease_generation: value.lease_generation,
    request_policy_version: value.request_policy_version,
  })
  if (value.request_key !== expectedKey
      || value.request_id !== `replay-spawn-boundary-revalidation-request-${expectedKey.slice(0, 24)}`
      || value.request_ref !== `request://replay-spawn-boundary-revalidation/${expectedKey.slice(0, 24)}`) {
    throw new Error("spawn boundary revalidation Request wire identity mismatch")
  }
  const { request_hash: requestHash, ...body } = value
  if (requestHash !== canonicalHash(body)) throw new Error("spawn boundary revalidation Request wire hash mismatch")
}

export function assertReplaySpawnBoundaryRevalidationReceiptView(
  value: ReplaySpawnBoundaryRevalidationReceiptView,
): void {
  assertWireFields(value, RECEIPT_VIEW_FIELDS, "spawn boundary revalidation Receipt view")
  if (value.schema_version !== REPLAY_SPAWN_BOUNDARY_REVALIDATION_RECEIPT_VIEW_SCHEMA_VERSION
      || value.receipt_policy_version !== REPLAY_SPAWN_BOUNDARY_REVALIDATION_RECEIPT_VIEW_POLICY_VERSION
      || value.status !== "capsule_bound_current_attempt_revalidated"
      || value.authority_owner !== "research_control_plane"
      || value.authority_source !== "research_control_plane_state_store"
      || value.clock_source !== "control_plane_authority_process_clock_port"
      || value.clock_independence !== "authority_internal_sampling_without_caller_timestamp_input"
      || value.caller_time_input !== "forbidden" || value.wall_clock_source !== "javascript_date_now_utc"
      || value.monotonic_clock_source !== "process_hrtime_bigint"
      || value.external_time_attestation !== "not_provided"
      || value.current_attempt_read
        !== "single_control_plane_transaction_exact_attempt_worker_generation_and_lease_hash"
      || value.spawn_candidate_authority !== "single_immediate_spawn_candidate_not_process_start_evidence"
      || value.race_limit
        !== "receipt_cannot_prove_absence_of_cancellation_or_fencing_after_completed_read"
      || value.process_authority !== "none") {
    throw new Error("unsupported spawn boundary revalidation Receipt wire authority")
  }
  for (const item of [value.receipt_id, value.receipt_ref, value.source_request_id,
    value.source_request_ref]) requireText(item, "spawn boundary revalidation Receipt identity")
  for (const item of [value.receipt_hash, value.source_request_hash,
    value.current_attempt_lease_hash]) requireHash(item, "spawn boundary revalidation Receipt hash")
  for (const item of [value.registry_read_started_at, value.registry_read_completed_at,
    value.revalidated_at, value.valid_before]) requireUtc(item, "spawn boundary revalidation Receipt time")
  if (!/^\d+$/.test(value.registry_read_started_monotonic_ns)
      || !/^\d+$/.test(value.registry_read_completed_monotonic_ns)
      || BigInt(value.registry_read_completed_monotonic_ns)
        <= BigInt(value.registry_read_started_monotonic_ns)) {
    throw new Error("spawn boundary revalidation Receipt monotonic bracket")
  }
  assertReplaySpawnBoundaryRevalidationRequestView(value.source_request)
  assertReplayAttemptLeaseEnvelopeView(value.current_attempt_lease)
  const request = value.source_request
  const lease = value.current_attempt_lease
  if (value.source_request_id !== request.request_id || value.source_request_ref !== request.request_ref
      || value.source_request_hash !== request.request_hash || value.current_attempt_status !== lease.status
      || value.current_attempt_lease_hash !== canonicalHash(lease)
      || value.current_attempt_lease_hash !== request.expected_current_attempt_lease_hash
      || lease.attempt_id !== request.attempt_id || lease.attempt_ordinal !== request.attempt_ordinal
      || lease.worker_id !== request.worker_id || lease.lease_generation !== request.lease_generation
      || Date.parse(value.registry_read_completed_at) < Date.parse(value.registry_read_started_at)
      || value.revalidated_at !== value.registry_read_completed_at
      || value.valid_before !== lease.lease_expires_at || value.valid_before !== request.expected_valid_before
      || Date.parse(value.registry_read_completed_at) >= Date.parse(value.valid_before)) {
    throw new Error("spawn boundary revalidation Receipt Request, Lease, or chronology mismatch")
  }
  const identityHash = canonicalHash({
    source_request_hash: request.request_hash,
    registry_read_started_at: value.registry_read_started_at,
    registry_read_completed_at: value.registry_read_completed_at,
    registry_read_started_monotonic_ns: value.registry_read_started_monotonic_ns,
    registry_read_completed_monotonic_ns: value.registry_read_completed_monotonic_ns,
    receipt_policy_version: value.receipt_policy_version,
  })
  if (value.receipt_id !== `replay-spawn-boundary-revalidation-receipt-${identityHash.slice(0, 24)}`
      || value.receipt_ref !== `receipt://replay-spawn-boundary-revalidation/${identityHash.slice(0, 24)}`) {
    throw new Error("spawn boundary revalidation Receipt wire identity mismatch")
  }
  const { receipt_hash: receiptHash, ...body } = value
  if (receiptHash !== canonicalHash(body)) throw new Error("spawn boundary revalidation Receipt wire hash mismatch")
}

const FIELDS = ["admitted_process_instance", "admitted_process_instance_count", "attempt_id",
  "attempt_ordinal", "authority_capsule_hash", "authority_capsule_instance_count",
  "authority_execution_admission_command_instance_count", "authority_process_launch_intent_instance_count",
  "authority_transport_contract_instance_count", "binding_hash", "binding_id", "binding_key",
  "binding_policy_version", "binding_ref", "blocker_set_policy", "blockers", "consumption_policy",
  "control_plane_revalidation_receipt", "control_plane_revalidation_receipt_hash",
  "control_plane_revalidation_receipt_id", "control_plane_revalidation_receipt_ref",
  "current_attempt_lease_hash", "current_attempt_status", "decision_output_authority", "dispatch_occurrence",
  "economic_authority", "freshness_semantics", "harness_invocation", "lease_generation", "order_authority",
  "owner", "process_artifact_hash", "process_launch_occurrence", "process_launch_receipt",
  "process_launch_receipt_count", "process_start_evidence", "purpose", "race_limit", "registry_read_completed_at",
  "registry_read_started_at", "request_decode_receipt_count", "request_frame_instance_count",
  "request_write_receipt_count", "response_admission", "response_frame_instance_count",
  "response_read_receipt_count", "revalidated_at", "revalidation_order", "schema_version", "scope",
  "signal_authority", "source_authority_capsule", "source_authority_capsule_id",
  "source_authority_capsule_key", "source_authority_capsule_record_hash",
  "source_authority_execution_admission_command_hash", "source_authority_process_launch_intent_hash",
  "source_authority_transport_contract_hash", "source_revalidation_request", "source_revalidation_request_hash",
  "source_revalidation_request_id", "spawn_boundary_revalidation_receipt_count",
  "spawn_boundary_revalidation_request_count", "spawn_transition_authority", "status", "transport_activation",
  "trial_authority", "valid_before", "worker_id", "worker_request_hash"].sort()

function assertFields(value: object): void {
  if (canonicalHash(Object.keys(value).sort()) !== canonicalHash(FIELDS)) {
    throw new Error("Authority Spawn Boundary Revalidation field whitelist drift")
  }
}

const REQUEST_VIEW_FIELDS = ["attempt_id", "attempt_ordinal", "authority_capsule_hash", "authority_target",
  "challenge_policy", "expected_current_attempt_lease_hash", "expected_valid_before", "lease_generation",
  "process_artifact_hash", "process_authority", "purpose", "request_hash", "request_id", "request_key",
  "request_policy_version", "request_ref", "requester_owner", "retry_policy", "schema_version",
  "source_authority_capsule_record_hash", "source_authority_execution_admission_command_hash",
  "source_authority_process_launch_intent_hash", "source_authority_transport_contract_hash", "status",
  "worker_id", "worker_request_hash"].sort()

const RECEIPT_VIEW_FIELDS = ["authority_owner", "authority_source", "caller_time_input", "clock_independence",
  "clock_source", "current_attempt_lease", "current_attempt_lease_hash", "current_attempt_read",
  "current_attempt_status", "external_time_attestation", "monotonic_clock_source", "process_authority",
  "race_limit", "receipt_hash", "receipt_id", "receipt_policy_version", "receipt_ref",
  "registry_read_completed_at", "registry_read_completed_monotonic_ns", "registry_read_started_at",
  "registry_read_started_monotonic_ns", "revalidated_at", "schema_version", "source_request",
  "source_request_hash", "source_request_id", "source_request_ref", "spawn_candidate_authority", "status",
  "valid_before", "wall_clock_source"].sort()

function assertWireFields(value: object, expected: string[], label: string): void {
  if (canonicalHash(Object.keys(value).sort()) !== canonicalHash(expected)) {
    throw new Error(`${label} field whitelist drift`)
  }
}
