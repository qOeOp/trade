import { canonicalHash } from "./replay-contracts"
import {
  assertReplayDecisionHarnessDispatchLeaseAdmission,
  type ReplayDecisionHarnessDispatchLeaseAdmission,
} from "./replay-decision-harness-dispatch-lease-admission"
import {
  REPLAY_ATTEMPT_LEASE_INPUT_SCHEMA_VERSION,
  assertReplayAttemptLeaseEnvelopeView,
  type ReplayAttemptLeaseEnvelopeView,
} from "./replay-decision-harness-execution-envelope"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
  requireReplayCrossSourceUtc as requireUtc,
} from "./replay-cross-source-ordering"

export const REPLAY_ATTEMPT_LEASE_OBSERVATION_INPUT_SCHEMA_VERSION = "trade.rd-replay-attempt-lease-observation.v1" as const
export const REPLAY_ATTEMPT_LEASE_OBSERVATION_INPUT_POLICY_VERSION = "rd-replay-attempt-lease-observation-v1" as const
export const REPLAY_DECISION_HARNESS_DISPATCH_LEASE_AUTHORITY_BINDING_SCHEMA_VERSION = "trade.rd-replay-decision-harness-dispatch-lease-authority-binding.v1" as const
export const REPLAY_DECISION_HARNESS_DISPATCH_LEASE_AUTHORITY_BINDING_POLICY_VERSION = "rd-replay-decision-harness-dispatch-lease-authority-binding-v1" as const

export interface ReplayAttemptLeaseObservationEnvelopeView {
  schema_version: typeof REPLAY_ATTEMPT_LEASE_OBSERVATION_INPUT_SCHEMA_VERSION
  observation_id: string
  observation_ref: string
  observation_hash: string
  observation_policy_version: typeof REPLAY_ATTEMPT_LEASE_OBSERVATION_INPUT_POLICY_VERSION
  status: "active_lease_observed"
  observed_at: string
  authority_owner: "research_control_plane"
  authority_source: "research_control_plane_state_store"
  read_consistency: "single_control_plane_transaction"
  clock_evidence: "caller_supplied_utc_not_external_time_attestation"
  trial_id: string
  run_id: string
  attempt_id: string
  attempt_ordinal: number
  worker_id: string
  lease_generation: number
  attempt_lease_hash: string
  attempt_lease: ReplayAttemptLeaseEnvelopeView
}

export interface ReplayDecisionHarnessDispatchLeaseAuthorityBinding {
  schema_version: typeof REPLAY_DECISION_HARNESS_DISPATCH_LEASE_AUTHORITY_BINDING_SCHEMA_VERSION
  binding_id: string
  binding_hash: string
  binding_policy_version: typeof REPLAY_DECISION_HARNESS_DISPATCH_LEASE_AUTHORITY_BINDING_POLICY_VERSION
  scope: "pre_transport_non_economic_control_plane_lease_observation_binding"
  owner: "replay_runner_dispatch_admission"
  purpose: "bind_dispatch_lease_freshness_to_one_control_plane_current_attempt_observation_receipt"
  parent_validation: "embedded_r4_111_admission_and_control_plane_observation_receipt"
  source_dispatch_lease_admission_id: string
  source_dispatch_lease_admission_hash: string
  source_dispatch_lease_admission: ReplayDecisionHarnessDispatchLeaseAdmission
  control_plane_observation_id: string
  control_plane_observation_ref: string
  control_plane_observation_hash: string
  control_plane_observation: ReplayAttemptLeaseObservationEnvelopeView
  receipt_binding_policy: "exact_observation_time_lease_hash_attempt_worker_and_generation"
  authority_observation_status: "control_plane_receipt_verified"
  clock_evidence: "caller_supplied_utc_not_external_time_attestation"
  dispatch_eligibility: "authority_receipt_and_lease_freshness_admitted_only"
  dispatch_occurrence: "not_materialized"
  process_instance_identity: "not_materialized"
  transport_admission: "not_granted"
  transport: "forbidden"
  harness_invocation: "forbidden"
  response_instance: null
  response_admission: "not_granted"
  decision_output_authority: "none"
  signal_authority: "none"
  order_authority: "none"
  economic_authority: "none"
  trial_authority: "none"
}

export type ReplayDecisionHarnessDispatchLeaseAuthorityBindingBody = Omit<
  ReplayDecisionHarnessDispatchLeaseAuthorityBinding,
  "binding_hash"
>

export function createReplayDecisionHarnessDispatchLeaseAuthorityBinding(
  body: ReplayDecisionHarnessDispatchLeaseAuthorityBindingBody,
): ReplayDecisionHarnessDispatchLeaseAuthorityBinding {
  const value = { ...structuredClone(body), binding_hash: canonicalHash(body) }
  assertReplayDecisionHarnessDispatchLeaseAuthorityBinding(value)
  return value
}

export function assertReplayDecisionHarnessDispatchLeaseAuthorityBinding(
  value: ReplayDecisionHarnessDispatchLeaseAuthorityBinding,
): void {
  assertFields(value)
  if (value.schema_version !== REPLAY_DECISION_HARNESS_DISPATCH_LEASE_AUTHORITY_BINDING_SCHEMA_VERSION
      || value.binding_policy_version !== REPLAY_DECISION_HARNESS_DISPATCH_LEASE_AUTHORITY_BINDING_POLICY_VERSION
      || value.scope !== "pre_transport_non_economic_control_plane_lease_observation_binding"
      || value.owner !== "replay_runner_dispatch_admission"
      || value.purpose !== "bind_dispatch_lease_freshness_to_one_control_plane_current_attempt_observation_receipt"
      || value.parent_validation !== "embedded_r4_111_admission_and_control_plane_observation_receipt"
      || value.receipt_binding_policy !== "exact_observation_time_lease_hash_attempt_worker_and_generation"
      || value.authority_observation_status !== "control_plane_receipt_verified"
      || value.clock_evidence !== "caller_supplied_utc_not_external_time_attestation"
      || value.dispatch_eligibility !== "authority_receipt_and_lease_freshness_admitted_only"
      || value.dispatch_occurrence !== "not_materialized"
      || value.process_instance_identity !== "not_materialized"
      || value.transport_admission !== "not_granted" || value.transport !== "forbidden"
      || value.harness_invocation !== "forbidden" || value.response_instance !== null
      || value.response_admission !== "not_granted" || value.decision_output_authority !== "none"
      || value.signal_authority !== "none" || value.order_authority !== "none"
      || value.economic_authority !== "none" || value.trial_authority !== "none") {
    throw new Error("unsupported decision harness Dispatch Lease Authority Binding authority")
  }
  for (const item of [value.binding_id, value.source_dispatch_lease_admission_id,
    value.control_plane_observation_id, value.control_plane_observation_ref]) {
    requireText(item, "decision harness Dispatch Lease Authority Binding identity")
  }
  for (const item of [value.binding_hash, value.source_dispatch_lease_admission_hash,
    value.control_plane_observation_hash]) {
    requireHash(item, "decision harness Dispatch Lease Authority Binding hash")
  }
  assertReplayDecisionHarnessDispatchLeaseAdmission(value.source_dispatch_lease_admission)
  assertReplayAttemptLeaseObservationEnvelopeView(value.control_plane_observation)
  const admission = value.source_dispatch_lease_admission
  const observation = value.control_plane_observation
  if (value.source_dispatch_lease_admission_id !== admission.admission_id
      || value.source_dispatch_lease_admission_hash !== admission.admission_hash
      || value.control_plane_observation_id !== observation.observation_id
      || value.control_plane_observation_ref !== observation.observation_ref
      || value.control_plane_observation_hash !== observation.observation_hash
      || observation.observed_at !== admission.observed_at
      || observation.attempt_lease_hash !== admission.current_attempt_lease_hash
      || canonicalHash(observation.attempt_lease) !== canonicalHash(admission.current_attempt_lease)
      || observation.attempt_id !== admission.attempt_id
      || observation.attempt_ordinal !== admission.attempt_ordinal
      || observation.worker_id !== admission.worker_id
      || observation.lease_generation !== admission.lease_generation) {
    throw new Error("decision harness Dispatch Lease Authority Binding receipt or Admission drift")
  }
  const { binding_hash: bindingHash, ...body } = value
  const { binding_id: bindingId, ...bodyWithoutId } = body
  if (bindingId !== `decision-harness-dispatch-lease-authority-${canonicalHash(bodyWithoutId).slice(0, 24)}`
      || bindingHash !== canonicalHash(body)) {
    throw new Error("decision harness Dispatch Lease Authority Binding identity or hash mismatch")
  }
}

export function assertReplayAttemptLeaseObservationEnvelopeView(
  value: ReplayAttemptLeaseObservationEnvelopeView,
): void {
  const fields = ["attempt_id", "attempt_lease", "attempt_lease_hash", "attempt_ordinal", "authority_owner",
    "authority_source", "clock_evidence", "lease_generation", "observation_hash", "observation_id",
    "observation_policy_version", "observation_ref", "observed_at", "read_consistency", "run_id",
    "schema_version", "status", "trial_id", "worker_id"].sort()
  if (canonicalHash(Object.keys(value).sort()) !== canonicalHash(fields)
      || value.schema_version !== REPLAY_ATTEMPT_LEASE_OBSERVATION_INPUT_SCHEMA_VERSION
      || value.observation_policy_version !== REPLAY_ATTEMPT_LEASE_OBSERVATION_INPUT_POLICY_VERSION
      || value.status !== "active_lease_observed" || value.authority_owner !== "research_control_plane"
      || value.authority_source !== "research_control_plane_state_store"
      || value.read_consistency !== "single_control_plane_transaction"
      || value.clock_evidence !== "caller_supplied_utc_not_external_time_attestation") {
    throw new Error("decision harness Control Plane Lease Observation wire view is invalid")
  }
  for (const item of [value.observation_id, value.observation_ref, value.trial_id, value.run_id,
    value.attempt_id, value.worker_id]) {
    requireText(item, "decision harness Control Plane Lease Observation identity")
  }
  requireHash(value.observation_hash, "decision harness Control Plane Lease Observation hash")
  requireHash(value.attempt_lease_hash, "decision harness Control Plane Lease hash")
  requireUtc(value.observed_at, "decision harness Control Plane Lease Observation time")
  if (!Number.isSafeInteger(value.attempt_ordinal) || value.attempt_ordinal < 1
      || !Number.isSafeInteger(value.lease_generation) || value.lease_generation < 1) {
    throw new Error("decision harness Control Plane Lease Observation ordinal or generation is invalid")
  }
  assertReplayAttemptLeaseEnvelopeView(value.attempt_lease)
  const lease = value.attempt_lease
  if (lease.schema_version !== REPLAY_ATTEMPT_LEASE_INPUT_SCHEMA_VERSION
      || value.trial_id !== lease.trial_id || value.run_id !== lease.run_id
      || value.attempt_id !== lease.attempt_id || value.attempt_ordinal !== lease.attempt_ordinal
      || value.worker_id !== lease.worker_id || value.lease_generation !== lease.lease_generation
      || Date.parse(value.observed_at) < Date.parse(lease.heartbeat_at)
      || Date.parse(value.observed_at) >= Date.parse(lease.lease_expires_at)) {
    throw new Error("decision harness Control Plane Lease Observation does not bind a fresh Lease")
  }
}

const FIELDS = ["authority_observation_status", "binding_hash", "binding_id", "binding_policy_version",
  "clock_evidence", "control_plane_observation", "control_plane_observation_hash",
  "control_plane_observation_id", "control_plane_observation_ref", "decision_output_authority",
  "dispatch_eligibility", "dispatch_occurrence", "economic_authority", "harness_invocation", "order_authority",
  "owner", "parent_validation", "process_instance_identity", "purpose", "receipt_binding_policy",
  "response_admission", "response_instance", "schema_version", "scope", "signal_authority",
  "source_dispatch_lease_admission", "source_dispatch_lease_admission_hash",
  "source_dispatch_lease_admission_id", "transport", "transport_admission", "trial_authority"].sort()

function assertFields(value: object): void {
  if (canonicalHash(Object.keys(value).sort()) !== canonicalHash(FIELDS)) {
    throw new Error("decision harness Dispatch Lease Authority Binding field whitelist drift")
  }
}
