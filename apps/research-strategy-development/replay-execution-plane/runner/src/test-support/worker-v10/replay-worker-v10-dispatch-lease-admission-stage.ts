import { expect } from "bun:test"
import type {
  ReplayAttemptLeaseSnapshot,
} from "../../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import {
  assertReplayDecisionHarnessDispatchLeaseAdmission,
  type ReplayDecisionHarnessDispatchLeaseAdmission,
} from "../../../../contracts/src/lib/replay-decision-harness-dispatch-lease-admission"
import type {
  ReplayDecisionHarnessExecutionEnvelope,
} from "../../../../contracts/src/lib/replay-decision-harness-execution-envelope"
import {
  assertReplayDecisionHarnessDispatchLeaseAdmissionLineage,
  buildReplayDecisionHarnessDispatchLeaseAdmission,
} from "../../lib/replay-decision-harness-dispatch-lease-admission"

export interface ReplayWorkerV10DispatchLeaseAdmissionStageInput {
  attempt_lease: ReplayAttemptLeaseSnapshot
  execution_envelope: ReplayDecisionHarnessExecutionEnvelope
  renewed_lease: ReplayAttemptLeaseSnapshot
  successor_envelope: ReplayDecisionHarnessExecutionEnvelope
  retry_lease: ReplayAttemptLeaseSnapshot
  retry_envelope: ReplayDecisionHarnessExecutionEnvelope
}

export interface ReplayWorkerV10DispatchLeaseAdmissionStageOutput {
  dispatch_admission: ReplayDecisionHarnessDispatchLeaseAdmission
}

export function runReplayWorkerV10DispatchLeaseAdmissionStage(
  input: ReplayWorkerV10DispatchLeaseAdmissionStageInput,
): ReplayWorkerV10DispatchLeaseAdmissionStageOutput {
  const attemptLease = input.attempt_lease
  const executionEnvelope = input.execution_envelope
  const renewedLease = input.renewed_lease
  const successorEnvelope = input.successor_envelope
  const retryLease = input.retry_lease
  const retryEnvelope = input.retry_envelope

  const dispatchAdmissionInput = {
    source_execution_envelope: executionEnvelope,
    current_attempt_lease: attemptLease,
    observed_at: attemptLease.heartbeat_at,
  }
  const dispatchAdmission = buildReplayDecisionHarnessDispatchLeaseAdmission(dispatchAdmissionInput)
  expect(dispatchAdmission.owner).toBe("replay_runner_dispatch_admission")
  expect(dispatchAdmission.source_execution_envelope_hash).toBe(executionEnvelope.envelope_hash)
  expect(dispatchAdmission.current_attempt_lease_hash).toBe(executionEnvelope.attempt_lease_hash)
  expect(dispatchAdmission.freshness_window_policy).toBe("heartbeat_inclusive_lease_expiry_exclusive")
  expect(dispatchAdmission.current_lease_match_policy).toBe("exact_attempt_worker_generation_and_hash")
  expect(dispatchAdmission.freshness_outcome).toBe("fresh_at_control_plane_observed_at")
  expect(dispatchAdmission.dispatch_eligibility).toBe("lease_freshness_admitted_only")
  expect(dispatchAdmission.dispatch_occurrence).toBe("not_materialized")
  expect(dispatchAdmission.clock_evidence).toBe("control_plane_observation_not_external_time_attestation")
  expect(dispatchAdmission.process_instance_identity).toBe("not_materialized")
  expect(dispatchAdmission.transport_admission).toBe("not_granted")
  expect(dispatchAdmission.transport).toBe("forbidden")
  expect(dispatchAdmission.harness_invocation).toBe("forbidden")
  expect(dispatchAdmission.response_instance).toBeNull()
  expect(dispatchAdmission.economic_authority).toBe("none")
  expect(() => assertReplayDecisionHarnessDispatchLeaseAdmission(dispatchAdmission)).not.toThrow()
  expect(() => assertReplayDecisionHarnessDispatchLeaseAdmissionLineage(
    dispatchAdmission,
    dispatchAdmissionInput,
  )).not.toThrow()
  expect(buildReplayDecisionHarnessDispatchLeaseAdmission({
    source_execution_envelope: structuredClone(executionEnvelope),
    current_attempt_lease: structuredClone(attemptLease),
    observed_at: attemptLease.heartbeat_at,
  })).toEqual(dispatchAdmission)
  expect(() => buildReplayDecisionHarnessDispatchLeaseAdmission({
    ...dispatchAdmissionInput,
    observed_at: "2026-07-14T00:00:29Z",
  })).toThrow("precedes fencing heartbeat")
  expect(() => buildReplayDecisionHarnessDispatchLeaseAdmission({
    ...dispatchAdmissionInput,
    observed_at: attemptLease.lease_expires_at,
  })).toThrow("expired at observed_at")
  expect(() => buildReplayDecisionHarnessDispatchLeaseAdmission({
    ...dispatchAdmissionInput,
    current_attempt_lease: renewedLease,
    observed_at: renewedLease.heartbeat_at,
  })).toThrow("current Lease generation and a successor Envelope")
  const successorDispatchAdmission = buildReplayDecisionHarnessDispatchLeaseAdmission({
    source_execution_envelope: successorEnvelope,
    current_attempt_lease: renewedLease,
    observed_at: renewedLease.heartbeat_at,
  })
  expect(successorDispatchAdmission.lease_generation).toBe(3)
  expect(successorDispatchAdmission.source_execution_envelope_hash).toBe(successorEnvelope.envelope_hash)
  expect(successorDispatchAdmission.admission_hash).not.toBe(dispatchAdmission.admission_hash)
  expect(() => buildReplayDecisionHarnessDispatchLeaseAdmission({
    source_execution_envelope: executionEnvelope,
    current_attempt_lease: retryLease,
    observed_at: retryLease.heartbeat_at,
  })).toThrow("current Attempt authority does not match Execution Envelope")
  const retryDispatchAdmission = buildReplayDecisionHarnessDispatchLeaseAdmission({
    source_execution_envelope: retryEnvelope,
    current_attempt_lease: retryLease,
    observed_at: retryLease.heartbeat_at,
  })
  expect(retryDispatchAdmission.attempt_id).toBe(retryLease.attempt_id)
  expect(retryDispatchAdmission.attempt_ordinal).toBe(2)
  expect(retryDispatchAdmission.retry_attempt_policy).toBe("new_root_envelope_required_before_readmission")
  expect(() => assertReplayDecisionHarnessDispatchLeaseAdmission({
    ...dispatchAdmission,
    process_id: 1234,
  } as never)).toThrow("field whitelist drift")
  expect(() => assertReplayDecisionHarnessDispatchLeaseAdmission({
    ...dispatchAdmission,
    transport_admission: "granted" as never,
  })).toThrow("unsupported decision harness Dispatch Lease Admission authority")
  return {
    dispatch_admission: dispatchAdmission,
  }
}
