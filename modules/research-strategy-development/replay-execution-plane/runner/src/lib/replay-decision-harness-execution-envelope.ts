import {
  assertReplayAttemptLeaseSnapshot,
  hashReplayAttemptLeaseSnapshot,
  type ReplayAttemptLeaseSnapshot,
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import {
  REPLAY_DECISION_HARNESS_EXECUTION_ENVELOPE_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_EXECUTION_ENVELOPE_SCHEMA_VERSION,
  assertReplayDecisionHarnessExecutionEnvelope,
  createReplayDecisionHarnessExecutionEnvelope,
  type ReplayDecisionHarnessExecutionEnvelope,
  type ReplayDecisionHarnessExecutionEnvelopeBody,
} from "../../../contracts/src/lib/replay-decision-harness-execution-envelope"
import {
  assertReplayDecisionHarnessWorkerResponseV10Contract,
  type ReplayDecisionHarnessWorkerResponseV10Contract,
} from "../../../contracts/src/lib/replay-decision-harness-worker-response-v10-contract"

export interface ReplayDecisionHarnessExecutionEnvelopeInput {
  source_response_contract: ReplayDecisionHarnessWorkerResponseV10Contract
  logical_request_id: string
  attempt_lease: ReplayAttemptLeaseSnapshot
  predecessor_execution_envelope?: ReplayDecisionHarnessExecutionEnvelope
}

export function buildReplayDecisionHarnessExecutionEnvelope(
  input: ReplayDecisionHarnessExecutionEnvelopeInput,
): ReplayDecisionHarnessExecutionEnvelope {
  const bodyWithoutId = buildBodyWithoutId(input)
  const value = createReplayDecisionHarnessExecutionEnvelope({
    ...bodyWithoutId,
    envelope_id: `decision-harness-execution-envelope-${canonicalHash(bodyWithoutId).slice(0, 24)}`,
  })
  assertReplayDecisionHarnessExecutionEnvelopeLineage(value, input)
  return value
}

export function assertReplayDecisionHarnessExecutionEnvelopeLineage(
  value: ReplayDecisionHarnessExecutionEnvelope,
  input: ReplayDecisionHarnessExecutionEnvelopeInput,
): void {
  assertReplayDecisionHarnessExecutionEnvelope(value)
  const bodyWithoutId = buildBodyWithoutId(input)
  const expected = createReplayDecisionHarnessExecutionEnvelope({
    ...bodyWithoutId,
    envelope_id: `decision-harness-execution-envelope-${canonicalHash(bodyWithoutId).slice(0, 24)}`,
  })
  if (canonicalHash(value) !== canonicalHash(expected)) {
    throw new Error("decision harness Execution Envelope parent lineage drift")
  }
}

function buildBodyWithoutId(
  input: ReplayDecisionHarnessExecutionEnvelopeInput,
): Omit<ReplayDecisionHarnessExecutionEnvelopeBody, "envelope_id"> {
  assertReplayDecisionHarnessWorkerResponseV10Contract(input.source_response_contract)
  assertReplayAttemptLeaseSnapshot(input.attempt_lease)
  const source = input.source_response_contract
  const requestMaterialization = source.source_request_materialization
  const request = requestMaterialization.requests.find((item) => item.logical_request_id === input.logical_request_id)
  if (!request) throw new Error("decision harness Execution Envelope logical Request is not materialized")
  const contextBinding = requestMaterialization.source_identity_upgrade.source_invocation_identity_set
    .code_admission.source_assembly_v4.harness_context_binding
  const lease = input.attempt_lease
  if (lease.run_id !== request.run_id || lease.run_id !== contextBinding.run_id
      || lease.trial_id !== request.request_context.trial_id || lease.trial_id !== contextBinding.trial_id
      || lease.reservation_ref !== contextBinding.reservation_ref
      || lease.reservation_hash !== contextBinding.reservation_hash
      || lease.request_hash !== contextBinding.request_hash) {
    throw new Error("decision harness Execution Envelope Attempt lease does not match Replay authority")
  }
  const predecessor = input.predecessor_execution_envelope
  if (predecessor) assertSuccessor(predecessor, request.logical_request_id, request.request_hash, lease)
  return {
    schema_version: REPLAY_DECISION_HARNESS_EXECUTION_ENVELOPE_SCHEMA_VERSION,
    envelope_policy_version: REPLAY_DECISION_HARNESS_EXECUTION_ENVELOPE_POLICY_VERSION,
    scope: "pre_transport_non_economic_attempt_bound_worker_request_envelope",
    owner: "replay_runner_execution_admission",
    purpose: "bind_one_logical_worker_request_to_one_exact_control_plane_attempt_lease_generation",
    parent_validation: "embedded_r4_109_contract_request_selection_and_control_plane_lease",
    source_response_contract_id: source.contract_id,
    source_response_contract_hash: source.contract_hash,
    source_response_contract: structuredClone(source),
    worker_protocol_version: source.worker_protocol_version,
    worker_request_schema_version: source.worker_request_schema_version,
    worker_response_schema_version: source.worker_response_schema_version,
    logical_request_id: request.logical_request_id,
    worker_request_hash: request.request_hash,
    request_context_hash: request.request_context_hash,
    replay_execution_request_hash: contextBinding.request_hash,
    run_id: request.run_id,
    trial_id: request.request_context.trial_id,
    reservation_ref: contextBinding.reservation_ref,
    reservation_hash: contextBinding.reservation_hash,
    attempt_lease_schema_version: lease.schema_version,
    attempt_id: lease.attempt_id,
    attempt_ordinal: lease.attempt_ordinal,
    worker_id: lease.worker_id,
    worker_identity_semantics: "control_plane_worker_authority_not_os_process_identity",
    attempt_status: lease.status,
    lease_generation: lease.lease_generation,
    claimed_at: lease.claimed_at,
    heartbeat_at: lease.heartbeat_at,
    lease_expires_at: lease.lease_expires_at,
    attempt_lease_hash: hashReplayAttemptLeaseSnapshot(lease),
    attempt_lease: structuredClone(lease),
    succession_kind: predecessor ? "same_attempt_lease_generation_successor" : "root_binding",
    predecessor_execution_envelope_hash: predecessor?.envelope_hash ?? null,
    lease_generation_policy: "one_envelope_one_exact_generation",
    lease_renewal_policy: "new_generation_requires_new_envelope_same_logical_request",
    same_generation_policy: "same_inputs_create_identical_envelope",
    cross_attempt_retry_policy: "new_attempt_requires_new_root_envelope_logical_request_stable",
    reproducibility_pair_policy: "shared_envelope_distinct_future_process_receipts",
    lease_freshness_at_dispatch: "not_evaluated_requires_future_transport_admission",
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

function assertSuccessor(
  previous: ReplayDecisionHarnessExecutionEnvelope,
  logicalRequestId: string,
  workerRequestHash: string,
  nextLease: ReplayAttemptLeaseSnapshot,
): void {
  assertReplayDecisionHarnessExecutionEnvelope(previous)
  const priorLease = previous.attempt_lease
  if (previous.logical_request_id !== logicalRequestId || previous.worker_request_hash !== workerRequestHash
      || nextLease.attempt_id !== priorLease.attempt_id || nextLease.attempt_ordinal !== priorLease.attempt_ordinal
      || nextLease.worker_id !== priorLease.worker_id || nextLease.trial_id !== priorLease.trial_id
      || nextLease.run_id !== priorLease.run_id || nextLease.reservation_ref !== priorLease.reservation_ref
      || nextLease.reservation_hash !== priorLease.reservation_hash || nextLease.request_hash !== priorLease.request_hash
      || nextLease.claimed_at !== priorLease.claimed_at) {
    throw new Error("decision harness Execution Envelope renewal changed immutable authority")
  }
  if (nextLease.lease_generation <= priorLease.lease_generation
      || Date.parse(nextLease.heartbeat_at) < Date.parse(priorLease.heartbeat_at)) {
    throw new Error("decision harness Execution Envelope renewal generation or heartbeat did not advance")
  }
}
