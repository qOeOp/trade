import {
  assertReplayAttemptLeaseSnapshot,
  hashReplayAttemptLeaseSnapshot,
  type ReplayAttemptLeaseSnapshot,
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import {
  REPLAY_DECISION_HARNESS_DISPATCH_LEASE_ADMISSION_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_DISPATCH_LEASE_ADMISSION_SCHEMA_VERSION,
  assertReplayDecisionHarnessDispatchLeaseAdmission,
  createReplayDecisionHarnessDispatchLeaseAdmission,
  type ReplayDecisionHarnessDispatchLeaseAdmission,
  type ReplayDecisionHarnessDispatchLeaseAdmissionBody,
} from "../../../contracts/src/lib/replay-decision-harness-dispatch-lease-admission"
import {
  assertReplayDecisionHarnessExecutionEnvelope,
  type ReplayDecisionHarnessExecutionEnvelope,
} from "../../../contracts/src/lib/replay-decision-harness-execution-envelope"

export interface ReplayDecisionHarnessDispatchLeaseAdmissionInput {
  source_execution_envelope: ReplayDecisionHarnessExecutionEnvelope
  current_attempt_lease: ReplayAttemptLeaseSnapshot
  observed_at: string
}

export function buildReplayDecisionHarnessDispatchLeaseAdmission(
  input: ReplayDecisionHarnessDispatchLeaseAdmissionInput,
): ReplayDecisionHarnessDispatchLeaseAdmission {
  const bodyWithoutId = buildBodyWithoutId(input)
  const value = createReplayDecisionHarnessDispatchLeaseAdmission({
    ...bodyWithoutId,
    admission_id: `decision-harness-dispatch-lease-admission-${canonicalHash(bodyWithoutId).slice(0, 24)}`,
  })
  assertReplayDecisionHarnessDispatchLeaseAdmissionLineage(value, input)
  return value
}

export function assertReplayDecisionHarnessDispatchLeaseAdmissionLineage(
  value: ReplayDecisionHarnessDispatchLeaseAdmission,
  input: ReplayDecisionHarnessDispatchLeaseAdmissionInput,
): void {
  assertReplayDecisionHarnessDispatchLeaseAdmission(value)
  const bodyWithoutId = buildBodyWithoutId(input)
  const expected = createReplayDecisionHarnessDispatchLeaseAdmission({
    ...bodyWithoutId,
    admission_id: `decision-harness-dispatch-lease-admission-${canonicalHash(bodyWithoutId).slice(0, 24)}`,
  })
  if (canonicalHash(value) !== canonicalHash(expected)) {
    throw new Error("decision harness Dispatch Lease Admission parent lineage drift")
  }
}

function buildBodyWithoutId(
  input: ReplayDecisionHarnessDispatchLeaseAdmissionInput,
): Omit<ReplayDecisionHarnessDispatchLeaseAdmissionBody, "admission_id"> {
  assertReplayDecisionHarnessExecutionEnvelope(input.source_execution_envelope)
  assertReplayAttemptLeaseSnapshot(input.current_attempt_lease)
  const envelope = input.source_execution_envelope
  const lease = input.current_attempt_lease
  const currentLeaseHash = hashReplayAttemptLeaseSnapshot(lease)
  if (lease.attempt_id !== envelope.attempt_id || lease.attempt_ordinal !== envelope.attempt_ordinal
      || lease.worker_id !== envelope.worker_id || lease.trial_id !== envelope.trial_id
      || lease.run_id !== envelope.run_id || lease.reservation_ref !== envelope.reservation_ref
      || lease.reservation_hash !== envelope.reservation_hash
      || lease.request_hash !== envelope.replay_execution_request_hash) {
    throw new Error("decision harness Dispatch Lease Admission current Attempt authority does not match Execution Envelope")
  }
  if (lease.lease_generation !== envelope.lease_generation
      || currentLeaseHash !== envelope.attempt_lease_hash
      || canonicalHash(lease) !== canonicalHash(envelope.attempt_lease)) {
    throw new Error("decision harness Dispatch Lease Admission requires the current Lease generation and a successor Envelope")
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(input.observed_at)
      || !Number.isFinite(Date.parse(input.observed_at))) {
    throw new Error("decision harness Dispatch Lease Admission observed_at must be RFC 3339 UTC")
  }
  const observed = Date.parse(input.observed_at)
  if (observed < Date.parse(lease.heartbeat_at)) {
    throw new Error("decision harness Dispatch Lease Admission observed_at precedes fencing heartbeat")
  }
  if (observed >= Date.parse(lease.lease_expires_at)) {
    throw new Error("decision harness Dispatch Lease Admission Lease is expired at observed_at")
  }
  return {
    schema_version: REPLAY_DECISION_HARNESS_DISPATCH_LEASE_ADMISSION_SCHEMA_VERSION,
    admission_policy_version: REPLAY_DECISION_HARNESS_DISPATCH_LEASE_ADMISSION_POLICY_VERSION,
    scope: "pre_transport_non_economic_dispatch_lease_freshness_admission",
    owner: "replay_runner_dispatch_admission",
    purpose: "prove_exact_execution_envelope_lease_generation_is_current_and_fresh_as_of_one_observation",
    parent_validation: "embedded_r4_110_execution_envelope_and_control_plane_current_attempt_lease",
    source_execution_envelope_id: envelope.envelope_id,
    source_execution_envelope_hash: envelope.envelope_hash,
    source_execution_envelope: structuredClone(envelope),
    authority_observation_source: "control_plane_current_attempt_lease_port",
    observed_at: input.observed_at,
    clock_evidence: "control_plane_observation_not_external_time_attestation",
    freshness_window_policy: "heartbeat_inclusive_lease_expiry_exclusive",
    current_lease_match_policy: "exact_attempt_worker_generation_and_hash",
    renewed_generation_policy: "successor_envelope_required_before_readmission",
    retry_attempt_policy: "new_root_envelope_required_before_readmission",
    current_attempt_lease_hash: currentLeaseHash,
    current_attempt_lease: structuredClone(lease),
    attempt_id: lease.attempt_id,
    attempt_ordinal: lease.attempt_ordinal,
    worker_id: lease.worker_id,
    lease_generation: lease.lease_generation,
    heartbeat_at: lease.heartbeat_at,
    lease_expires_at: lease.lease_expires_at,
    freshness_outcome: "fresh_at_control_plane_observed_at",
    dispatch_eligibility: "lease_freshness_admitted_only",
    dispatch_occurrence: "not_materialized",
    process_instance_identity: "not_materialized",
    transport_admission: "not_granted",
    transport: "forbidden",
    harness_invocation: "forbidden",
    response_instance: null,
    response_admission: "not_granted",
    decision_output_authority: "none",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
    trial_authority: "none",
  }
}
