import {
  assertReplayAttemptLeaseObservationSnapshot,
  type ReplayAttemptLeaseObservationSnapshot,
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import {
  REPLAY_DECISION_HARNESS_DISPATCH_LEASE_AUTHORITY_BINDING_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_DISPATCH_LEASE_AUTHORITY_BINDING_SCHEMA_VERSION,
  assertReplayDecisionHarnessDispatchLeaseAuthorityBinding,
  createReplayDecisionHarnessDispatchLeaseAuthorityBinding,
  type ReplayDecisionHarnessDispatchLeaseAuthorityBinding,
  type ReplayDecisionHarnessDispatchLeaseAuthorityBindingBody,
} from "../../../contracts/src/lib/replay-decision-harness-dispatch-lease-authority-binding"
import type { ReplayDecisionHarnessExecutionEnvelope } from "../../../contracts/src/lib/replay-decision-harness-execution-envelope"
import {
  buildReplayDecisionHarnessDispatchLeaseAdmission,
} from "./replay-decision-harness-dispatch-lease-admission"

export interface ReplayDecisionHarnessDispatchLeaseAuthorityBindingInput {
  source_execution_envelope: ReplayDecisionHarnessExecutionEnvelope
  control_plane_lease_observation: ReplayAttemptLeaseObservationSnapshot
}

export function buildReplayDecisionHarnessDispatchLeaseAuthorityBinding(
  input: ReplayDecisionHarnessDispatchLeaseAuthorityBindingInput,
): ReplayDecisionHarnessDispatchLeaseAuthorityBinding {
  const bodyWithoutId = buildBodyWithoutId(input)
  const value = createReplayDecisionHarnessDispatchLeaseAuthorityBinding({
    ...bodyWithoutId,
    binding_id: `decision-harness-dispatch-lease-authority-${canonicalHash(bodyWithoutId).slice(0, 24)}`,
  })
  assertReplayDecisionHarnessDispatchLeaseAuthorityBindingLineage(value, input)
  return value
}

export function assertReplayDecisionHarnessDispatchLeaseAuthorityBindingLineage(
  value: ReplayDecisionHarnessDispatchLeaseAuthorityBinding,
  input: ReplayDecisionHarnessDispatchLeaseAuthorityBindingInput,
): void {
  assertReplayDecisionHarnessDispatchLeaseAuthorityBinding(value)
  const bodyWithoutId = buildBodyWithoutId(input)
  const expected = createReplayDecisionHarnessDispatchLeaseAuthorityBinding({
    ...bodyWithoutId,
    binding_id: `decision-harness-dispatch-lease-authority-${canonicalHash(bodyWithoutId).slice(0, 24)}`,
  })
  if (canonicalHash(value) !== canonicalHash(expected)) {
    throw new Error("decision harness Dispatch Lease Authority Binding parent lineage drift")
  }
}

function buildBodyWithoutId(
  input: ReplayDecisionHarnessDispatchLeaseAuthorityBindingInput,
): Omit<ReplayDecisionHarnessDispatchLeaseAuthorityBindingBody, "binding_id"> {
  assertReplayAttemptLeaseObservationSnapshot(input.control_plane_lease_observation)
  const observation = input.control_plane_lease_observation
  const admission = buildReplayDecisionHarnessDispatchLeaseAdmission({
    source_execution_envelope: input.source_execution_envelope,
    current_attempt_lease: observation.attempt_lease,
    observed_at: observation.observed_at,
  })
  return {
    schema_version: REPLAY_DECISION_HARNESS_DISPATCH_LEASE_AUTHORITY_BINDING_SCHEMA_VERSION,
    binding_policy_version: REPLAY_DECISION_HARNESS_DISPATCH_LEASE_AUTHORITY_BINDING_POLICY_VERSION,
    scope: "pre_transport_non_economic_control_plane_lease_observation_binding",
    owner: "replay_runner_dispatch_admission",
    purpose: "bind_dispatch_lease_freshness_to_one_control_plane_current_attempt_observation_receipt",
    parent_validation: "embedded_r4_111_admission_and_control_plane_observation_receipt",
    source_dispatch_lease_admission_id: admission.admission_id,
    source_dispatch_lease_admission_hash: admission.admission_hash,
    source_dispatch_lease_admission: admission,
    control_plane_observation_id: observation.observation_id,
    control_plane_observation_ref: observation.observation_ref,
    control_plane_observation_hash: observation.observation_hash,
    control_plane_observation: structuredClone(observation),
    receipt_binding_policy: "exact_observation_time_lease_hash_attempt_worker_and_generation",
    authority_observation_status: "control_plane_receipt_verified",
    clock_evidence: "caller_supplied_utc_not_external_time_attestation",
    dispatch_eligibility: "authority_receipt_and_lease_freshness_admitted_only",
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
