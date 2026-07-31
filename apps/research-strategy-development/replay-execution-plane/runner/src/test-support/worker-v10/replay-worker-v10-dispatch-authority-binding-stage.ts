import { expect } from "bun:test"
import {
  REPLAY_ATTEMPT_LEASE_OBSERVATION_POLICY_VERSION,
  REPLAY_ATTEMPT_LEASE_OBSERVATION_SCHEMA_VERSION,
  createReplayAttemptLeaseObservationSnapshot,
  hashReplayAttemptLeaseSnapshot,
  type ReplayAttemptLeaseObservationBody,
  type ReplayAttemptLeaseObservationSnapshot,
  type ReplayAttemptLeaseSnapshot,
} from "../../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import type {
  ReplayDecisionHarnessDispatchLeaseAdmission,
} from "../../../../contracts/src/lib/replay-decision-harness-dispatch-lease-admission"
import {
  assertReplayDecisionHarnessDispatchLeaseAuthorityBinding,
  type ReplayDecisionHarnessDispatchLeaseAuthorityBinding,
} from "../../../../contracts/src/lib/replay-decision-harness-dispatch-lease-authority-binding"
import type {
  ReplayDecisionHarnessExecutionEnvelope,
} from "../../../../contracts/src/lib/replay-decision-harness-execution-envelope"
import {
  assertReplayDecisionHarnessDispatchLeaseAuthorityBindingLineage,
  buildReplayDecisionHarnessDispatchLeaseAuthorityBinding,
  type ReplayDecisionHarnessDispatchLeaseAuthorityBindingInput,
} from "../../lib/replay-decision-harness-dispatch-lease-authority-binding"

export interface ReplayWorkerV10DispatchAuthorityBindingStageInput {
  attempt_lease: ReplayAttemptLeaseSnapshot
  execution_envelope: ReplayDecisionHarnessExecutionEnvelope
  dispatch_admission: ReplayDecisionHarnessDispatchLeaseAdmission
}

export interface ReplayWorkerV10DispatchAuthorityBindingStageOutput {
  lease_observation_body: ReplayAttemptLeaseObservationBody
  lease_observation: ReplayAttemptLeaseObservationSnapshot
  authority_binding_input: ReplayDecisionHarnessDispatchLeaseAuthorityBindingInput
  dispatch_authority_binding: ReplayDecisionHarnessDispatchLeaseAuthorityBinding
}

export function runReplayWorkerV10DispatchAuthorityBindingStage(
  input: ReplayWorkerV10DispatchAuthorityBindingStageInput,
): ReplayWorkerV10DispatchAuthorityBindingStageOutput {
  const attemptLease = input.attempt_lease
  const executionEnvelope = input.execution_envelope
  const dispatchAdmission = input.dispatch_admission

  const leaseObservationBody = {
    schema_version: REPLAY_ATTEMPT_LEASE_OBSERVATION_SCHEMA_VERSION,
    observation_id: "lease-observation-envelope-1",
    observation_ref: "observation://replay-attempt-lease/envelope-1",
    observation_policy_version: REPLAY_ATTEMPT_LEASE_OBSERVATION_POLICY_VERSION,
    status: "active_lease_observed" as const,
    observed_at: attemptLease.heartbeat_at,
    authority_owner: "research_control_plane" as const,
    authority_source: "research_control_plane_state_store" as const,
    read_consistency: "single_control_plane_transaction" as const,
    clock_evidence: "caller_supplied_utc_not_external_time_attestation" as const,
    trial_id: attemptLease.trial_id,
    run_id: attemptLease.run_id,
    attempt_id: attemptLease.attempt_id,
    attempt_ordinal: attemptLease.attempt_ordinal,
    worker_id: attemptLease.worker_id,
    lease_generation: attemptLease.lease_generation,
    attempt_lease_hash: hashReplayAttemptLeaseSnapshot(attemptLease),
    attempt_lease: attemptLease,
  }
  const leaseObservation = createReplayAttemptLeaseObservationSnapshot(leaseObservationBody)
  const authorityBindingInput = {
    source_execution_envelope: executionEnvelope,
    control_plane_lease_observation: leaseObservation,
  }
  const dispatchAuthorityBinding = buildReplayDecisionHarnessDispatchLeaseAuthorityBinding(authorityBindingInput)
  expect(dispatchAuthorityBinding.authority_observation_status).toBe("control_plane_receipt_verified")
  expect(dispatchAuthorityBinding.control_plane_observation_hash).toBe(leaseObservation.observation_hash)
  expect(dispatchAuthorityBinding.source_dispatch_lease_admission_hash).toBe(dispatchAdmission.admission_hash)
  expect(dispatchAuthorityBinding.receipt_binding_policy)
    .toBe("exact_observation_time_lease_hash_attempt_worker_and_generation")
  expect(dispatchAuthorityBinding.dispatch_eligibility)
    .toBe("authority_receipt_and_lease_freshness_admitted_only")
  expect(dispatchAuthorityBinding.dispatch_occurrence).toBe("not_materialized")
  expect(dispatchAuthorityBinding.clock_evidence).toBe("caller_supplied_utc_not_external_time_attestation")
  expect(dispatchAuthorityBinding.transport_admission).toBe("not_granted")
  expect(dispatchAuthorityBinding.response_instance).toBeNull()
  expect(dispatchAuthorityBinding.economic_authority).toBe("none")
  expect(() => assertReplayDecisionHarnessDispatchLeaseAuthorityBinding(dispatchAuthorityBinding)).not.toThrow()
  expect(() => assertReplayDecisionHarnessDispatchLeaseAuthorityBindingLineage(
    dispatchAuthorityBinding,
    authorityBindingInput,
  )).not.toThrow()
  expect(buildReplayDecisionHarnessDispatchLeaseAuthorityBinding({
    source_execution_envelope: structuredClone(executionEnvelope),
    control_plane_lease_observation: structuredClone(leaseObservation),
  })).toEqual(dispatchAuthorityBinding)
  return {
    lease_observation_body: leaseObservationBody,
    lease_observation: leaseObservation,
    authority_binding_input: authorityBindingInput,
    dispatch_authority_binding: dispatchAuthorityBinding,
  }
}
