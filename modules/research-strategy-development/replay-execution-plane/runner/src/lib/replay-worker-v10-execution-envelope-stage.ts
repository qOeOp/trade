import { expect } from "bun:test"
import {
  REPLAY_ATTEMPT_LEASE_SCHEMA_VERSION,
  hashReplayAttemptLeaseSnapshot,
  type ReplayAttemptLeaseSnapshot,
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import type {
  ReplaySourceEventDecisionObservationHarnessContextBinding,
} from "../../../contracts/src/lib/replay-source-event-decision-observation-harness-context-binding"
import {
  assertReplayDecisionHarnessExecutionEnvelope,
  type ReplayDecisionHarnessExecutionEnvelope,
} from "../../../contracts/src/lib/replay-decision-harness-execution-envelope"
import type {
  ReplayDecisionHarnessWorkerRequestV10,
} from "../../../contracts/src/lib/replay-decision-harness-worker-request-v10"
import type {
  ReplayDecisionHarnessWorkerResponseV10Contract,
} from "../../../contracts/src/lib/replay-decision-harness-worker-response-v10-contract"
import {
  assertReplayDecisionHarnessExecutionEnvelopeLineage,
  buildReplayDecisionHarnessExecutionEnvelope,
} from "./replay-decision-harness-execution-envelope"

export interface ReplayWorkerV10ExecutionEnvelopeStageInput {
  authority_binding: ReplaySourceEventDecisionObservationHarnessContextBinding
  response_contract: ReplayDecisionHarnessWorkerResponseV10Contract
  worker_request: ReplayDecisionHarnessWorkerRequestV10
}

export interface ReplayWorkerV10ExecutionEnvelopeStageOutput {
  attempt_lease: ReplayAttemptLeaseSnapshot
  execution_envelope: ReplayDecisionHarnessExecutionEnvelope
  renewed_lease: ReplayAttemptLeaseSnapshot
  successor_envelope: ReplayDecisionHarnessExecutionEnvelope
  retry_lease: ReplayAttemptLeaseSnapshot
  retry_envelope: ReplayDecisionHarnessExecutionEnvelope
}

export function runReplayWorkerV10ExecutionEnvelopeStage(
  input: ReplayWorkerV10ExecutionEnvelopeStageInput,
): ReplayWorkerV10ExecutionEnvelopeStageOutput {
  const authorityBinding = input.authority_binding
  const responseV10Contract = input.response_contract
  const firstRequestV10 = input.worker_request

  const attemptLease: ReplayAttemptLeaseSnapshot = {
    schema_version: REPLAY_ATTEMPT_LEASE_SCHEMA_VERSION,
    attempt_id: "attempt-envelope-1",
    attempt_ordinal: 1,
    worker_id: "worker-authority-1",
    trial_id: authorityBinding.trial_id,
    run_id: authorityBinding.run_id,
    reservation_ref: authorityBinding.reservation_ref,
    reservation_hash: authorityBinding.reservation_hash,
    request_hash: authorityBinding.request_hash,
    status: "running",
    lease_generation: 2,
    claimed_at: "2026-07-14T00:00:00Z",
    heartbeat_at: "2026-07-14T00:00:30Z",
    lease_expires_at: "2026-07-14T00:05:00Z",
  }
  const envelopeInput = {
    source_response_contract: responseV10Contract,
    logical_request_id: firstRequestV10.logical_request_id,
    attempt_lease: attemptLease,
  }
  const executionEnvelope = buildReplayDecisionHarnessExecutionEnvelope(envelopeInput)
  expect(executionEnvelope.owner).toBe("replay_runner_execution_admission")
  expect(executionEnvelope.worker_request_hash).toBe(firstRequestV10.request_hash)
  expect(executionEnvelope.replay_execution_request_hash).toBe(authorityBinding.request_hash)
  expect(executionEnvelope.worker_request_hash).not.toBe(executionEnvelope.replay_execution_request_hash)
  expect(executionEnvelope.attempt_lease_hash).toBe(hashReplayAttemptLeaseSnapshot(attemptLease))
  expect(executionEnvelope.worker_identity_semantics)
    .toBe("control_plane_worker_authority_not_os_process_identity")
  expect(executionEnvelope.succession_kind).toBe("root_binding")
  expect(executionEnvelope.predecessor_execution_envelope_hash).toBeNull()
  expect(executionEnvelope.lease_generation_policy).toBe("one_envelope_one_exact_generation")
  expect(executionEnvelope.cross_attempt_retry_policy)
    .toBe("new_attempt_requires_new_root_envelope_logical_request_stable")
  expect(executionEnvelope.reproducibility_pair_policy)
    .toBe("shared_envelope_distinct_future_process_receipts")
  expect(executionEnvelope.lease_freshness_at_dispatch)
    .toBe("not_evaluated_requires_future_transport_admission")
  expect(executionEnvelope.process_instance_identity).toBe("not_materialized")
  expect(executionEnvelope.transport_admission).toBe("not_granted")
  expect(executionEnvelope.transport).toBe("forbidden")
  expect(executionEnvelope.harness_invocation).toBe("forbidden")
  expect(executionEnvelope.response_instance).toBeNull()
  expect(executionEnvelope.decision_output_authority).toBe("none")
  expect(() => assertReplayDecisionHarnessExecutionEnvelope(executionEnvelope)).not.toThrow()
  expect(() => assertReplayDecisionHarnessExecutionEnvelopeLineage(executionEnvelope, envelopeInput)).not.toThrow()
  expect(buildReplayDecisionHarnessExecutionEnvelope({
    ...envelopeInput,
    source_response_contract: structuredClone(responseV10Contract),
    attempt_lease: structuredClone(attemptLease),
  })).toEqual(executionEnvelope)
  const renewedLease: ReplayAttemptLeaseSnapshot = {
    ...attemptLease,
    lease_generation: 3,
    heartbeat_at: "2026-07-14T00:02:00Z",
    lease_expires_at: "2026-07-14T00:07:00Z",
  }
  const successorInput = {
    ...envelopeInput,
    attempt_lease: renewedLease,
    predecessor_execution_envelope: executionEnvelope,
  }
  const successorEnvelope = buildReplayDecisionHarnessExecutionEnvelope(successorInput)
  expect(successorEnvelope.succession_kind).toBe("same_attempt_lease_generation_successor")
  expect(successorEnvelope.predecessor_execution_envelope_hash).toBe(executionEnvelope.envelope_hash)
  expect(successorEnvelope.logical_request_id).toBe(executionEnvelope.logical_request_id)
  expect(successorEnvelope.worker_request_hash).toBe(executionEnvelope.worker_request_hash)
  expect(successorEnvelope.lease_generation).toBe(3)
  expect(successorEnvelope.envelope_hash).not.toBe(executionEnvelope.envelope_hash)
  expect(() => assertReplayDecisionHarnessExecutionEnvelopeLineage(successorEnvelope, successorInput)).not.toThrow()
  expect(() => buildReplayDecisionHarnessExecutionEnvelope({
    ...envelopeInput,
    predecessor_execution_envelope: executionEnvelope,
  })).toThrow("generation or heartbeat did not advance")
  expect(() => buildReplayDecisionHarnessExecutionEnvelope({
    ...successorInput,
    attempt_lease: { ...renewedLease, worker_id: "forged-worker" },
  })).toThrow("changed immutable authority")
  const retryLease: ReplayAttemptLeaseSnapshot = {
    ...attemptLease,
    attempt_id: "attempt-envelope-2",
    attempt_ordinal: 2,
    worker_id: "worker-authority-2",
    lease_generation: 1,
    claimed_at: "2026-07-14T00:10:00Z",
    heartbeat_at: "2026-07-14T00:10:30Z",
    lease_expires_at: "2026-07-14T00:15:00Z",
  }
  const retryEnvelope = buildReplayDecisionHarnessExecutionEnvelope({
    ...envelopeInput,
    attempt_lease: retryLease,
  })
  expect(retryEnvelope.succession_kind).toBe("root_binding")
  expect(retryEnvelope.predecessor_execution_envelope_hash).toBeNull()
  expect(retryEnvelope.logical_request_id).toBe(executionEnvelope.logical_request_id)
  expect(retryEnvelope.attempt_id).not.toBe(executionEnvelope.attempt_id)
  expect(retryEnvelope.envelope_hash).not.toBe(executionEnvelope.envelope_hash)
  expect(() => buildReplayDecisionHarnessExecutionEnvelope({
    ...envelopeInput,
    attempt_lease: { ...attemptLease, request_hash: "b".repeat(64) },
  })).toThrow("does not match Replay authority")
  expect(() => assertReplayDecisionHarnessExecutionEnvelope({
    ...executionEnvelope,
    process_id: 1234,
  } as never)).toThrow("field whitelist drift")
  expect(() => assertReplayDecisionHarnessExecutionEnvelope({
    ...executionEnvelope,
    transport_admission: "granted" as never,
  })).toThrow("unsupported decision harness Execution Envelope authority")
  return {
    attempt_lease: attemptLease,
    execution_envelope: executionEnvelope,
    renewed_lease: renewedLease,
    successor_envelope: successorEnvelope,
    retry_lease: retryLease,
    retry_envelope: retryEnvelope,
  }
}

