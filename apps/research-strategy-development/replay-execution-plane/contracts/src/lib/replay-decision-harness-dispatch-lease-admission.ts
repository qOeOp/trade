import { canonicalHash } from "./replay-contracts"
import {
  assertReplayAttemptLeaseEnvelopeView,
  assertReplayDecisionHarnessExecutionEnvelope,
  type ReplayAttemptLeaseEnvelopeView,
  type ReplayDecisionHarnessExecutionEnvelope,
} from "./replay-decision-harness-execution-envelope"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
  requireReplayCrossSourceUtc as requireUtc,
} from "./replay-cross-source-ordering"

export const REPLAY_DECISION_HARNESS_DISPATCH_LEASE_ADMISSION_SCHEMA_VERSION = "trade.rd-replay-decision-harness-dispatch-lease-admission.v1" as const
export const REPLAY_DECISION_HARNESS_DISPATCH_LEASE_ADMISSION_POLICY_VERSION = "rd-replay-decision-harness-dispatch-lease-admission-v1" as const

export interface ReplayDecisionHarnessDispatchLeaseAdmission {
  schema_version: typeof REPLAY_DECISION_HARNESS_DISPATCH_LEASE_ADMISSION_SCHEMA_VERSION
  admission_id: string
  admission_hash: string
  admission_policy_version: typeof REPLAY_DECISION_HARNESS_DISPATCH_LEASE_ADMISSION_POLICY_VERSION
  scope: "pre_transport_non_economic_dispatch_lease_freshness_admission"
  owner: "replay_runner_dispatch_admission"
  purpose: "prove_exact_execution_envelope_lease_generation_is_current_and_fresh_as_of_one_observation"
  parent_validation: "embedded_r4_110_execution_envelope_and_control_plane_current_attempt_lease"
  source_execution_envelope_id: string
  source_execution_envelope_hash: string
  source_execution_envelope: ReplayDecisionHarnessExecutionEnvelope
  authority_observation_source: "control_plane_current_attempt_lease_port"
  observed_at: string
  clock_evidence: "control_plane_observation_not_external_time_attestation"
  freshness_window_policy: "heartbeat_inclusive_lease_expiry_exclusive"
  current_lease_match_policy: "exact_attempt_worker_generation_and_hash"
  renewed_generation_policy: "successor_envelope_required_before_readmission"
  retry_attempt_policy: "new_root_envelope_required_before_readmission"
  current_attempt_lease_hash: string
  current_attempt_lease: ReplayAttemptLeaseEnvelopeView
  attempt_id: string
  attempt_ordinal: number
  worker_id: string
  lease_generation: number
  heartbeat_at: string
  lease_expires_at: string
  freshness_outcome: "fresh_at_control_plane_observed_at"
  dispatch_eligibility: "lease_freshness_admitted_only"
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

export type ReplayDecisionHarnessDispatchLeaseAdmissionBody = Omit<
  ReplayDecisionHarnessDispatchLeaseAdmission,
  "admission_hash"
>

export function createReplayDecisionHarnessDispatchLeaseAdmission(
  body: ReplayDecisionHarnessDispatchLeaseAdmissionBody,
): ReplayDecisionHarnessDispatchLeaseAdmission {
  const value = { ...structuredClone(body), admission_hash: canonicalHash(body) }
  assertReplayDecisionHarnessDispatchLeaseAdmission(value)
  return value
}

export function assertReplayDecisionHarnessDispatchLeaseAdmission(
  value: ReplayDecisionHarnessDispatchLeaseAdmission,
): void {
  assertFields(value)
  if (value.schema_version !== REPLAY_DECISION_HARNESS_DISPATCH_LEASE_ADMISSION_SCHEMA_VERSION
      || value.admission_policy_version !== REPLAY_DECISION_HARNESS_DISPATCH_LEASE_ADMISSION_POLICY_VERSION
      || value.scope !== "pre_transport_non_economic_dispatch_lease_freshness_admission"
      || value.owner !== "replay_runner_dispatch_admission"
      || value.purpose !== "prove_exact_execution_envelope_lease_generation_is_current_and_fresh_as_of_one_observation"
      || value.parent_validation !== "embedded_r4_110_execution_envelope_and_control_plane_current_attempt_lease"
      || value.authority_observation_source !== "control_plane_current_attempt_lease_port"
      || value.clock_evidence !== "control_plane_observation_not_external_time_attestation"
      || value.freshness_window_policy !== "heartbeat_inclusive_lease_expiry_exclusive"
      || value.current_lease_match_policy !== "exact_attempt_worker_generation_and_hash"
      || value.renewed_generation_policy !== "successor_envelope_required_before_readmission"
      || value.retry_attempt_policy !== "new_root_envelope_required_before_readmission"
      || value.freshness_outcome !== "fresh_at_control_plane_observed_at"
      || value.dispatch_eligibility !== "lease_freshness_admitted_only"
      || value.dispatch_occurrence !== "not_materialized"
      || value.process_instance_identity !== "not_materialized"
      || value.transport_admission !== "not_granted" || value.transport !== "forbidden"
      || value.harness_invocation !== "forbidden" || value.response_instance !== null
      || value.response_admission !== "not_granted" || value.decision_output_authority !== "none"
      || value.signal_authority !== "none" || value.order_authority !== "none"
      || value.economic_authority !== "none" || value.trial_authority !== "none") {
    throw new Error("unsupported decision harness Dispatch Lease Admission authority")
  }
  requireText(value.admission_id, "decision harness Dispatch Lease Admission identity")
  requireText(value.attempt_id, "decision harness Dispatch Lease Admission Attempt identity")
  requireText(value.worker_id, "decision harness Dispatch Lease Admission worker identity")
  for (const item of [value.admission_hash, value.source_execution_envelope_hash,
    value.current_attempt_lease_hash]) {
    requireHash(item, "decision harness Dispatch Lease Admission hash")
  }
  requireUtc(value.observed_at, "decision harness Dispatch Lease Admission observation time")
  requireUtc(value.heartbeat_at, "decision harness Dispatch Lease Admission heartbeat time")
  requireUtc(value.lease_expires_at, "decision harness Dispatch Lease Admission expiry time")
  if (!Number.isSafeInteger(value.attempt_ordinal) || value.attempt_ordinal < 1
      || !Number.isSafeInteger(value.lease_generation) || value.lease_generation < 1) {
    throw new Error("decision harness Dispatch Lease Admission Attempt ordinal or generation is invalid")
  }
  assertReplayDecisionHarnessExecutionEnvelope(value.source_execution_envelope)
  assertReplayAttemptLeaseEnvelopeView(value.current_attempt_lease)
  const envelope = value.source_execution_envelope
  const lease = value.current_attempt_lease
  if (value.source_execution_envelope_id !== envelope.envelope_id
      || value.source_execution_envelope_hash !== envelope.envelope_hash
      || value.current_attempt_lease_hash !== envelope.attempt_lease_hash
      || canonicalHash(lease) !== canonicalHash(envelope.attempt_lease)
      || value.attempt_id !== lease.attempt_id || value.attempt_id !== envelope.attempt_id
      || value.attempt_ordinal !== lease.attempt_ordinal || value.attempt_ordinal !== envelope.attempt_ordinal
      || value.worker_id !== lease.worker_id || value.worker_id !== envelope.worker_id
      || value.lease_generation !== lease.lease_generation || value.lease_generation !== envelope.lease_generation
      || value.heartbeat_at !== lease.heartbeat_at || value.heartbeat_at !== envelope.heartbeat_at
      || value.lease_expires_at !== lease.lease_expires_at || value.lease_expires_at !== envelope.lease_expires_at) {
    throw new Error("decision harness Dispatch Lease Admission current Lease or Envelope binding drift")
  }
  const observed = Date.parse(value.observed_at)
  if (observed < Date.parse(value.heartbeat_at)) {
    throw new Error("decision harness Dispatch Lease Admission observed_at precedes fencing heartbeat")
  }
  if (observed >= Date.parse(value.lease_expires_at)) {
    throw new Error("decision harness Dispatch Lease Admission Lease is expired at observed_at")
  }
  const { admission_hash: admissionHash, ...body } = value
  const { admission_id: admissionId, ...bodyWithoutId } = body
  if (admissionId !== `decision-harness-dispatch-lease-admission-${canonicalHash(bodyWithoutId).slice(0, 24)}`
      || admissionHash !== canonicalHash(body)) {
    throw new Error("decision harness Dispatch Lease Admission identity or hash mismatch")
  }
}

const FIELDS = ["admission_hash", "admission_id", "admission_policy_version", "attempt_id", "attempt_ordinal",
  "authority_observation_source", "clock_evidence", "current_attempt_lease", "current_attempt_lease_hash",
  "current_lease_match_policy", "decision_output_authority", "dispatch_eligibility", "dispatch_occurrence",
  "economic_authority", "freshness_outcome", "freshness_window_policy", "harness_invocation", "heartbeat_at",
  "lease_expires_at", "lease_generation", "observed_at", "order_authority", "owner", "parent_validation",
  "process_instance_identity", "purpose", "renewed_generation_policy", "response_admission", "response_instance",
  "retry_attempt_policy", "schema_version", "scope", "signal_authority", "source_execution_envelope",
  "source_execution_envelope_hash", "source_execution_envelope_id", "transport", "transport_admission",
  "trial_authority", "worker_id"].sort()

function assertFields(value: object): void {
  if (canonicalHash(Object.keys(value).sort()) !== canonicalHash(FIELDS)) {
    throw new Error("decision harness Dispatch Lease Admission field whitelist drift")
  }
}
