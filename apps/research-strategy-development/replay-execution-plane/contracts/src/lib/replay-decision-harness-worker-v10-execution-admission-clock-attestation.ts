import { canonicalHash, canonicalJson } from "./replay-contracts"
import {
  assertReplayAttemptLeaseObservationRegistryReadReceiptView,
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenance,
  type ReplayAttemptLeaseObservationRegistryReadReceiptView,
  type ReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenance,
} from "./replay-decision-harness-worker-v10-execution-admission-registry-provenance"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
  requireReplayCrossSourceUtc as requireUtc,
} from "./replay-cross-source-ordering"

export const REPLAY_DISPATCH_CLOCK_ATTESTATION_VIEW_SCHEMA_VERSION =
  "trade.rd-replay-dispatch-clock-attestation.v1" as const
export const REPLAY_DISPATCH_CLOCK_ATTESTATION_VIEW_POLICY_VERSION =
  "rd-replay-dispatch-clock-attestation-v1" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_CLOCK_ATTESTATION_SCHEMA_VERSION =
  "trade.rd-replay-decision-harness-worker-v10-execution-admission-clock-attestation.v1" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_CLOCK_ATTESTATION_POLICY_VERSION =
  "rd-replay-harness-worker-v10-execution-admission-clock-attestation-v1" as const

export interface ReplayDispatchClockAttestationView {
  schema_version: typeof REPLAY_DISPATCH_CLOCK_ATTESTATION_VIEW_SCHEMA_VERSION
  attestation_id: string
  attestation_ref: string
  attestation_hash: string
  attestation_policy_version: typeof REPLAY_DISPATCH_CLOCK_ATTESTATION_VIEW_POLICY_VERSION
  status: "authority_clock_bracketed_registry_read"
  authority_owner: "research_control_plane"
  authority_source: "research_control_plane_state_store"
  clock_source: "control_plane_authority_process_clock_port"
  clock_independence: "authority_internal_sampling_without_caller_timestamp_input"
  caller_time_input: "forbidden"
  wall_clock_source: "javascript_date_now_utc"
  monotonic_clock_source: "process_hrtime_bigint"
  external_time_attestation: "not_provided"
  registry_read_bracketing: "wall_and_monotonic_samples_before_and_after_single_transaction_read"
  registry_read_started_at: string
  registry_read_completed_at: string
  registry_read_started_monotonic_ns: string
  registry_read_completed_monotonic_ns: string
  source_registry_read_receipt_id: string
  source_registry_read_receipt_ref: string
  source_registry_read_receipt_hash: string
  source_registry_read_receipt: ReplayAttemptLeaseObservationRegistryReadReceiptView
  attempt_id: string
  worker_id: string
  lease_generation: number
  current_attempt_lease_hash: string
}

export type ReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestationBlocker =
  | "execution_admission_command_instance_not_issued"
  | "attempt_bound_stdio_process_launch_intent_not_materialized"
  | "attempt_bound_stdio_process_receipt_not_materialized"
  | "worker_request_frame_write_and_decode_not_materialized"
  | "worker_response_frame_read_and_admission_not_materialized"

export interface ReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation {
  schema_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_CLOCK_ATTESTATION_SCHEMA_VERSION
  binding_id: string
  binding_hash: string
  binding_key: string
  binding_policy_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_CLOCK_ATTESTATION_POLICY_VERSION
  scope: "attempt_bound_execution_admission_clock_attestation_only"
  owner: "replay_runner_worker_v10_execution_admission_clock_attestation_registry"
  status: "authority_clock_attested_command_issue_blocked"
  source_registry_provenance_id: string
  source_registry_provenance_hash: string
  source_registry_provenance: ReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenance
  control_plane_clock_attestation_id: string
  control_plane_clock_attestation_ref: string
  control_plane_clock_attestation_hash: string
  control_plane_clock_attestation: ReplayDispatchClockAttestationView
  target_logical_request_id: string
  target_worker_request_hash: string
  attempt_id: string
  attempt_ordinal: number
  worker_id: string
  lease_generation: number
  current_attempt_lease_hash: string
  independent_dispatch_clock_attestation: "authority_internal_dual_sample_bound"
  external_time_attestation: "not_provided_not_required_for_local_authority_clock_independence"
  clock_authority_limit: "local_control_plane_process_clock_not_signed_remote_or_tsa_time"
  predecessor_blocker_closure: "independent_dispatch_clock_attestation_closed_only"
  execution_admission_command: null
  execution_admission_command_instance_count: 0
  command_issue_status: "blocked"
  blocker_set_policy: "complete_deterministic_ordered_post_clock_attestation_blockers"
  blockers: ReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestationBlocker[]
  attempt_bound_process_launch_intent: null
  attempt_bound_process_receipt: null
  request_frame_instance_count: 0
  request_write_receipt_count: 0
  request_decode_receipt_count: 0
  response_frame_instance_count: 0
  response_read_receipt_count: 0
  dispatch_occurrence: "not_materialized"
  transport_activation: "blocked"
  harness_invocation: "forbidden"
  response_admission: "not_granted"
  decision_output_authority: "none"
  signal_authority: "none"
  order_authority: "none"
  economic_authority: "none"
  trial_authority: "none"
}

export type ReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestationBody = Omit<
  ReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation,
  "binding_hash"
>

export function replayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestationBlockers():
ReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestationBlocker[] {
  return [
    "execution_admission_command_instance_not_issued",
    "attempt_bound_stdio_process_launch_intent_not_materialized",
    "attempt_bound_stdio_process_receipt_not_materialized",
    "worker_request_frame_write_and_decode_not_materialized",
    "worker_response_frame_read_and_admission_not_materialized",
  ]
}

export function replayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestationKey(input: {
  registry_provenance_hash: string
  clock_attestation_hash: string
  binding_policy_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_CLOCK_ATTESTATION_POLICY_VERSION
}): string {
  requireHash(input.registry_provenance_hash, "Execution Admission clock registry provenance hash")
  requireHash(input.clock_attestation_hash, "Execution Admission clock attestation hash")
  if (input.binding_policy_version !== REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_CLOCK_ATTESTATION_POLICY_VERSION) {
    throw new Error("unsupported Execution Admission clock attestation policy")
  }
  return canonicalHash(input)
}

export function createReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation(
  body: ReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestationBody,
): ReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation {
  const value = { ...structuredClone(body), binding_hash: canonicalHash(body) }
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation(value)
  return value
}

export function assertReplayDispatchClockAttestationView(value: ReplayDispatchClockAttestationView): void {
  const fields = ["attestation_hash", "attestation_id", "attestation_policy_version", "attestation_ref",
    "attempt_id", "authority_owner", "authority_source", "caller_time_input", "clock_independence", "clock_source",
    "current_attempt_lease_hash", "external_time_attestation", "lease_generation", "monotonic_clock_source",
    "registry_read_bracketing", "registry_read_completed_at", "registry_read_completed_monotonic_ns",
    "registry_read_started_at", "registry_read_started_monotonic_ns", "schema_version",
    "source_registry_read_receipt", "source_registry_read_receipt_hash", "source_registry_read_receipt_id",
    "source_registry_read_receipt_ref", "status", "wall_clock_source", "worker_id"].sort()
  if (canonicalHash(Object.keys(value).sort()) !== canonicalHash(fields)) throw new Error("dispatch clock attestation field whitelist drift")
  if (value.schema_version !== REPLAY_DISPATCH_CLOCK_ATTESTATION_VIEW_SCHEMA_VERSION
      || value.attestation_policy_version !== REPLAY_DISPATCH_CLOCK_ATTESTATION_VIEW_POLICY_VERSION
      || value.status !== "authority_clock_bracketed_registry_read" || value.authority_owner !== "research_control_plane"
      || value.authority_source !== "research_control_plane_state_store"
      || value.clock_source !== "control_plane_authority_process_clock_port"
      || value.clock_independence !== "authority_internal_sampling_without_caller_timestamp_input"
      || value.caller_time_input !== "forbidden" || value.wall_clock_source !== "javascript_date_now_utc"
      || value.monotonic_clock_source !== "process_hrtime_bigint" || value.external_time_attestation !== "not_provided"
      || value.registry_read_bracketing !== "wall_and_monotonic_samples_before_and_after_single_transaction_read") {
    throw new Error("unsupported dispatch clock attestation authority")
  }
  for (const item of [value.attestation_id, value.attestation_ref, value.source_registry_read_receipt_id,
    value.source_registry_read_receipt_ref, value.attempt_id, value.worker_id]) requireText(item, "dispatch clock attestation identity")
  for (const item of [value.attestation_hash, value.source_registry_read_receipt_hash,
    value.current_attempt_lease_hash]) requireHash(item, "dispatch clock attestation hash")
  requireUtc(value.registry_read_started_at, "dispatch clock attestation started_at")
  requireUtc(value.registry_read_completed_at, "dispatch clock attestation completed_at")
  if (!/^\d+$/.test(value.registry_read_started_monotonic_ns)
      || !/^\d+$/.test(value.registry_read_completed_monotonic_ns)
      || BigInt(value.registry_read_completed_monotonic_ns) <= BigInt(value.registry_read_started_monotonic_ns)
      || !Number.isSafeInteger(value.lease_generation) || value.lease_generation < 1) {
    throw new Error("dispatch clock attestation monotonic or Lease binding")
  }
  assertReplayAttemptLeaseObservationRegistryReadReceiptView(value.source_registry_read_receipt)
  const receipt = value.source_registry_read_receipt
  const lease = receipt.current_attempt_lease
  const identityHash = canonicalHash({
    source_registry_read_receipt_hash: receipt.receipt_hash,
    registry_read_started_at: value.registry_read_started_at,
    registry_read_completed_at: value.registry_read_completed_at,
    registry_read_started_monotonic_ns: value.registry_read_started_monotonic_ns,
    registry_read_completed_monotonic_ns: value.registry_read_completed_monotonic_ns,
    attestation_policy_version: value.attestation_policy_version,
  })
  if (value.source_registry_read_receipt_id !== receipt.receipt_id
      || value.source_registry_read_receipt_ref !== receipt.receipt_ref
      || value.source_registry_read_receipt_hash !== receipt.receipt_hash
      || value.attempt_id !== lease.attempt_id || value.worker_id !== lease.worker_id
      || value.lease_generation !== lease.lease_generation
      || value.current_attempt_lease_hash !== receipt.current_attempt_lease_hash
      || value.registry_read_started_at !== receipt.read_at
      || Date.parse(value.registry_read_completed_at) < Date.parse(value.registry_read_started_at)
      || Date.parse(value.registry_read_completed_at) >= Date.parse(lease.lease_expires_at)
      || value.attestation_id !== `replay-dispatch-clock-attestation-${identityHash.slice(0, 24)}`
      || value.attestation_ref !== `attestation://replay-dispatch-clock/${identityHash.slice(0, 24)}`) {
    throw new Error("dispatch clock attestation receipt, chronology, or identity mismatch")
  }
  const { attestation_hash: attestationHash, ...body } = value
  if (attestationHash !== canonicalHash(body)) throw new Error("dispatch clock attestation hash mismatch")
}

export function assertReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation(
  value: ReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation,
): void {
  assertBindingFields(value)
  if (value.schema_version !== REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_CLOCK_ATTESTATION_SCHEMA_VERSION
      || value.binding_policy_version !== REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_CLOCK_ATTESTATION_POLICY_VERSION
      || value.scope !== "attempt_bound_execution_admission_clock_attestation_only"
      || value.owner !== "replay_runner_worker_v10_execution_admission_clock_attestation_registry"
      || value.status !== "authority_clock_attested_command_issue_blocked"
      || value.independent_dispatch_clock_attestation !== "authority_internal_dual_sample_bound"
      || value.external_time_attestation !== "not_provided_not_required_for_local_authority_clock_independence"
      || value.clock_authority_limit !== "local_control_plane_process_clock_not_signed_remote_or_tsa_time"
      || value.predecessor_blocker_closure !== "independent_dispatch_clock_attestation_closed_only"
      || value.execution_admission_command !== null || value.execution_admission_command_instance_count !== 0
      || value.command_issue_status !== "blocked"
      || value.blocker_set_policy !== "complete_deterministic_ordered_post_clock_attestation_blockers"
      || canonicalJson(value.blockers) !== canonicalJson(replayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestationBlockers())
      || value.attempt_bound_process_launch_intent !== null || value.attempt_bound_process_receipt !== null
      || value.request_frame_instance_count !== 0 || value.request_write_receipt_count !== 0
      || value.request_decode_receipt_count !== 0 || value.response_frame_instance_count !== 0
      || value.response_read_receipt_count !== 0 || value.dispatch_occurrence !== "not_materialized"
      || value.transport_activation !== "blocked" || value.harness_invocation !== "forbidden"
      || value.response_admission !== "not_granted" || value.decision_output_authority !== "none"
      || value.signal_authority !== "none" || value.order_authority !== "none"
      || value.economic_authority !== "none" || value.trial_authority !== "none") {
    throw new Error("unsupported Execution Admission clock attestation authority")
  }
  for (const item of [value.binding_id, value.source_registry_provenance_id,
    value.control_plane_clock_attestation_id, value.control_plane_clock_attestation_ref,
    value.attempt_id, value.worker_id]) requireText(item, "Execution Admission clock binding identity")
  for (const item of [value.binding_hash, value.binding_key, value.source_registry_provenance_hash,
    value.control_plane_clock_attestation_hash, value.target_logical_request_id,
    value.target_worker_request_hash, value.current_attempt_lease_hash]) requireHash(item, "Execution Admission clock binding hash")
  if (!Number.isSafeInteger(value.attempt_ordinal) || value.attempt_ordinal < 1
      || !Number.isSafeInteger(value.lease_generation) || value.lease_generation < 1) throw new Error("Execution Admission clock Attempt binding")
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenance(value.source_registry_provenance)
  assertReplayDispatchClockAttestationView(value.control_plane_clock_attestation)
  const provenance = value.source_registry_provenance
  const clock = value.control_plane_clock_attestation
  const expectedKey = replayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestationKey({
    registry_provenance_hash: provenance.provenance_hash,
    clock_attestation_hash: clock.attestation_hash,
    binding_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_CLOCK_ATTESTATION_POLICY_VERSION,
  })
  if (value.binding_key !== expectedKey || value.source_registry_provenance_id !== provenance.provenance_id
      || value.source_registry_provenance_hash !== provenance.provenance_hash
      || value.control_plane_clock_attestation_id !== clock.attestation_id
      || value.control_plane_clock_attestation_ref !== clock.attestation_ref
      || value.control_plane_clock_attestation_hash !== clock.attestation_hash
      || clock.source_registry_read_receipt_hash !== provenance.control_plane_registry_read_receipt_hash
      || canonicalJson(clock.source_registry_read_receipt) !== canonicalJson(provenance.control_plane_registry_read_receipt)
      || value.target_logical_request_id !== provenance.target_logical_request_id
      || value.target_worker_request_hash !== provenance.target_worker_request_hash
      || value.attempt_id !== provenance.attempt_id || value.attempt_id !== clock.attempt_id
      || value.attempt_ordinal !== provenance.attempt_ordinal || value.worker_id !== provenance.worker_id
      || value.worker_id !== clock.worker_id || value.lease_generation !== provenance.lease_generation
      || value.lease_generation !== clock.lease_generation
      || value.current_attempt_lease_hash !== provenance.current_attempt_lease_hash
      || value.current_attempt_lease_hash !== clock.current_attempt_lease_hash
      || value.binding_id !== `decision-harness-worker-v10-execution-clock-attestation-${expectedKey.slice(0, 24)}`) {
    throw new Error("Execution Admission clock attestation parent binding drift")
  }
  const { binding_hash: bindingHash, ...body } = value
  if (bindingHash !== canonicalHash(body)) throw new Error("Execution Admission clock attestation hash mismatch")
}

const BINDING_FIELDS = ["attempt_bound_process_launch_intent", "attempt_bound_process_receipt", "attempt_id",
  "attempt_ordinal", "binding_hash", "binding_id", "binding_key", "binding_policy_version", "blocker_set_policy",
  "blockers", "clock_authority_limit", "command_issue_status", "control_plane_clock_attestation",
  "control_plane_clock_attestation_hash", "control_plane_clock_attestation_id", "control_plane_clock_attestation_ref",
  "current_attempt_lease_hash", "decision_output_authority", "dispatch_occurrence", "economic_authority",
  "execution_admission_command", "execution_admission_command_instance_count", "external_time_attestation",
  "harness_invocation", "independent_dispatch_clock_attestation", "lease_generation", "order_authority", "owner",
  "predecessor_blocker_closure", "request_decode_receipt_count", "request_frame_instance_count",
  "request_write_receipt_count", "response_admission", "response_frame_instance_count", "response_read_receipt_count",
  "schema_version", "scope", "signal_authority", "source_registry_provenance", "source_registry_provenance_hash",
  "source_registry_provenance_id", "status", "target_logical_request_id", "target_worker_request_hash",
  "transport_activation", "trial_authority", "worker_id"].sort()

function assertBindingFields(value: object): void {
  if (canonicalHash(Object.keys(value).sort()) !== canonicalHash(BINDING_FIELDS)) {
    throw new Error("Execution Admission clock attestation field whitelist drift")
  }
}
