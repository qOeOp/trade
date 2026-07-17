import { canonicalHash } from "./replay-contracts"
import {
  REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION,
  REPLAY_DECISION_HARNESS_TARGET_WORKER_REQUEST_SCHEMA_VERSION,
} from "./replay-decision-harness-logical-request-identity-upgrade"
import {
  REPLAY_DECISION_HARNESS_TARGET_WORKER_RESPONSE_SCHEMA_VERSION,
  assertReplayDecisionHarnessWorkerResponseV10Contract,
  type ReplayDecisionHarnessWorkerResponseV10Contract,
} from "./replay-decision-harness-worker-response-v10-contract"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
  requireReplayCrossSourceUtc as requireUtc,
} from "./replay-cross-source-ordering"

export const REPLAY_DECISION_HARNESS_EXECUTION_ENVELOPE_SCHEMA_VERSION = "trade.rd-replay-decision-harness-execution-envelope.v1" as const
export const REPLAY_DECISION_HARNESS_EXECUTION_ENVELOPE_POLICY_VERSION = "rd-replay-decision-harness-execution-envelope-v1" as const
export const REPLAY_ATTEMPT_LEASE_INPUT_SCHEMA_VERSION = "trade.rd-replay-attempt-lease.v1" as const

// Replay owns this immutable inbound wire view, not the Control Plane source type.
// The Runner adapter validates the value and computes its hash with the Control Plane authority.
export interface ReplayAttemptLeaseEnvelopeView {
  schema_version: typeof REPLAY_ATTEMPT_LEASE_INPUT_SCHEMA_VERSION
  attempt_id: string
  attempt_ordinal: number
  worker_id: string
  trial_id: string
  run_id: string
  reservation_ref: string
  reservation_hash: string
  request_hash: string
  status: "claimed" | "running"
  lease_generation: number
  claimed_at: string
  heartbeat_at: string
  lease_expires_at: string
}

export interface ReplayDecisionHarnessExecutionEnvelope {
  schema_version: typeof REPLAY_DECISION_HARNESS_EXECUTION_ENVELOPE_SCHEMA_VERSION
  envelope_id: string
  envelope_hash: string
  envelope_policy_version: typeof REPLAY_DECISION_HARNESS_EXECUTION_ENVELOPE_POLICY_VERSION
  scope: "pre_transport_non_economic_attempt_bound_worker_request_envelope"
  owner: "replay_runner_execution_admission"
  purpose: "bind_one_logical_worker_request_to_one_exact_control_plane_attempt_lease_generation"
  parent_validation: "embedded_r4_109_contract_request_selection_and_control_plane_lease"
  source_response_contract_id: string
  source_response_contract_hash: string
  source_response_contract: ReplayDecisionHarnessWorkerResponseV10Contract
  worker_protocol_version: typeof REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION
  worker_request_schema_version: typeof REPLAY_DECISION_HARNESS_TARGET_WORKER_REQUEST_SCHEMA_VERSION
  worker_response_schema_version: typeof REPLAY_DECISION_HARNESS_TARGET_WORKER_RESPONSE_SCHEMA_VERSION
  logical_request_id: string
  worker_request_hash: string
  request_context_hash: string
  replay_execution_request_hash: string
  run_id: string
  trial_id: string
  reservation_ref: string
  reservation_hash: string
  attempt_lease_schema_version: typeof REPLAY_ATTEMPT_LEASE_INPUT_SCHEMA_VERSION
  attempt_id: string
  attempt_ordinal: number
  worker_id: string
  worker_identity_semantics: "control_plane_worker_authority_not_os_process_identity"
  attempt_status: "claimed" | "running"
  lease_generation: number
  claimed_at: string
  heartbeat_at: string
  lease_expires_at: string
  attempt_lease_hash: string
  attempt_lease: ReplayAttemptLeaseEnvelopeView
  succession_kind: "root_binding" | "same_attempt_lease_generation_successor"
  predecessor_execution_envelope_hash: string | null
  lease_generation_policy: "one_envelope_one_exact_generation"
  lease_renewal_policy: "new_generation_requires_new_envelope_same_logical_request"
  same_generation_policy: "same_inputs_create_identical_envelope"
  cross_attempt_retry_policy: "new_attempt_requires_new_root_envelope_logical_request_stable"
  reproducibility_pair_policy: "shared_envelope_distinct_future_process_receipts"
  lease_freshness_at_dispatch: "not_evaluated_requires_future_transport_admission"
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

export type ReplayDecisionHarnessExecutionEnvelopeBody = Omit<ReplayDecisionHarnessExecutionEnvelope, "envelope_hash">

export function createReplayDecisionHarnessExecutionEnvelope(
  body: ReplayDecisionHarnessExecutionEnvelopeBody,
): ReplayDecisionHarnessExecutionEnvelope {
  const value = { ...structuredClone(body), envelope_hash: canonicalHash(body) }
  assertReplayDecisionHarnessExecutionEnvelope(value)
  return value
}

export function assertReplayDecisionHarnessExecutionEnvelope(
  value: ReplayDecisionHarnessExecutionEnvelope,
): void {
  assertFields(value)
  if (value.schema_version !== REPLAY_DECISION_HARNESS_EXECUTION_ENVELOPE_SCHEMA_VERSION
      || value.envelope_policy_version !== REPLAY_DECISION_HARNESS_EXECUTION_ENVELOPE_POLICY_VERSION
      || value.scope !== "pre_transport_non_economic_attempt_bound_worker_request_envelope"
      || value.owner !== "replay_runner_execution_admission"
      || value.purpose !== "bind_one_logical_worker_request_to_one_exact_control_plane_attempt_lease_generation"
      || value.parent_validation !== "embedded_r4_109_contract_request_selection_and_control_plane_lease"
      || value.worker_protocol_version !== REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION
      || value.worker_request_schema_version !== REPLAY_DECISION_HARNESS_TARGET_WORKER_REQUEST_SCHEMA_VERSION
      || value.worker_response_schema_version !== REPLAY_DECISION_HARNESS_TARGET_WORKER_RESPONSE_SCHEMA_VERSION
      || value.attempt_lease_schema_version !== REPLAY_ATTEMPT_LEASE_INPUT_SCHEMA_VERSION
      || value.worker_identity_semantics !== "control_plane_worker_authority_not_os_process_identity"
      || value.lease_generation_policy !== "one_envelope_one_exact_generation"
      || value.lease_renewal_policy !== "new_generation_requires_new_envelope_same_logical_request"
      || value.same_generation_policy !== "same_inputs_create_identical_envelope"
      || value.cross_attempt_retry_policy !== "new_attempt_requires_new_root_envelope_logical_request_stable"
      || value.reproducibility_pair_policy !== "shared_envelope_distinct_future_process_receipts"
      || value.lease_freshness_at_dispatch !== "not_evaluated_requires_future_transport_admission"
      || value.process_instance_identity !== "not_materialized"
      || value.transport_admission !== "not_granted" || value.transport !== "forbidden"
      || value.harness_invocation !== "forbidden" || value.response_instance !== null
      || value.response_admission !== "not_granted" || value.decision_output_authority !== "none"
      || value.signal_authority !== "none" || value.order_authority !== "none"
      || value.economic_authority !== "none" || value.trial_authority !== "none") {
    throw new Error("unsupported decision harness Execution Envelope authority")
  }
  for (const item of [value.envelope_id, value.source_response_contract_id, value.run_id, value.trial_id,
    value.reservation_ref, value.attempt_id, value.worker_id]) {
    requireText(item, "decision harness Execution Envelope identity")
  }
  for (const item of [value.envelope_hash, value.source_response_contract_hash, value.logical_request_id,
    value.worker_request_hash, value.request_context_hash, value.replay_execution_request_hash,
    value.reservation_hash, value.attempt_lease_hash]) {
    requireHash(item, "decision harness Execution Envelope hash")
  }
  if (value.predecessor_execution_envelope_hash !== null) {
    requireHash(value.predecessor_execution_envelope_hash, "decision harness predecessor Execution Envelope hash")
  }
  if (!Number.isSafeInteger(value.attempt_ordinal) || value.attempt_ordinal < 1
      || !Number.isSafeInteger(value.lease_generation) || value.lease_generation < 1) {
    throw new Error("decision harness Execution Envelope Attempt ordinal or generation is invalid")
  }
  requireUtc(value.claimed_at, "decision harness Execution Envelope claimed time")
  requireUtc(value.heartbeat_at, "decision harness Execution Envelope heartbeat time")
  requireUtc(value.lease_expires_at, "decision harness Execution Envelope expiry time")
  const root = value.succession_kind === "root_binding"
  if ((root && value.predecessor_execution_envelope_hash !== null)
      || (!root && (value.succession_kind !== "same_attempt_lease_generation_successor"
        || value.predecessor_execution_envelope_hash === null))) {
    throw new Error("decision harness Execution Envelope succession declaration is invalid")
  }
  assertReplayDecisionHarnessWorkerResponseV10Contract(value.source_response_contract)
  assertReplayAttemptLeaseEnvelopeView(value.attempt_lease)
  const source = value.source_response_contract
  const requestMaterialization = source.source_request_materialization
  const request = requestMaterialization.requests.find((item) => item.logical_request_id === value.logical_request_id)
  const contextBinding = requestMaterialization.source_identity_upgrade.source_invocation_identity_set
    .code_admission.source_assembly_v4.harness_context_binding
  const lease = value.attempt_lease
  if (!request || value.source_response_contract_id !== source.contract_id
      || value.source_response_contract_hash !== source.contract_hash
      || value.worker_request_hash !== request.request_hash
      || value.request_context_hash !== request.request_context_hash
      || value.replay_execution_request_hash !== contextBinding.request_hash
      || value.run_id !== request.run_id || value.run_id !== contextBinding.run_id
      || value.trial_id !== request.request_context.trial_id || value.trial_id !== contextBinding.trial_id
      || value.reservation_ref !== contextBinding.reservation_ref
      || value.reservation_hash !== contextBinding.reservation_hash
      || value.attempt_id !== lease.attempt_id || value.attempt_ordinal !== lease.attempt_ordinal
      || value.worker_id !== lease.worker_id || value.attempt_status !== lease.status
      || value.lease_generation !== lease.lease_generation || value.claimed_at !== lease.claimed_at
      || value.heartbeat_at !== lease.heartbeat_at || value.lease_expires_at !== lease.lease_expires_at
      || lease.run_id !== value.run_id || lease.trial_id !== value.trial_id
      || lease.reservation_ref !== value.reservation_ref || lease.reservation_hash !== value.reservation_hash
      || lease.request_hash !== value.replay_execution_request_hash) {
    throw new Error("decision harness Execution Envelope parent or Attempt binding drift")
  }
  const { envelope_hash: envelopeHash, ...body } = value
  const { envelope_id: envelopeId, ...bodyWithoutId } = body
  if (envelopeId !== `decision-harness-execution-envelope-${canonicalHash(bodyWithoutId).slice(0, 24)}`
      || envelopeHash !== canonicalHash(body)) {
    throw new Error("decision harness Execution Envelope identity or hash mismatch")
  }
}

export function assertReplayAttemptLeaseEnvelopeView(value: ReplayAttemptLeaseEnvelopeView): void {
  const fields = ["attempt_id", "attempt_ordinal", "claimed_at", "heartbeat_at", "lease_expires_at",
    "lease_generation", "request_hash", "reservation_hash", "reservation_ref", "run_id", "schema_version",
    "status", "trial_id", "worker_id"].sort()
  if (canonicalHash(Object.keys(value).sort()) !== canonicalHash(fields)
      || value.schema_version !== REPLAY_ATTEMPT_LEASE_INPUT_SCHEMA_VERSION
      || (value.status !== "claimed" && value.status !== "running")) {
    throw new Error("decision harness Execution Envelope Attempt lease wire view is invalid")
  }
  for (const item of [value.attempt_id, value.worker_id, value.trial_id, value.run_id, value.reservation_ref]) {
    requireText(item, "decision harness Execution Envelope Attempt lease identity")
  }
  requireHash(value.reservation_hash, "decision harness Execution Envelope Attempt lease Reservation hash")
  requireHash(value.request_hash, "decision harness Execution Envelope Attempt lease Request hash")
  if (!Number.isSafeInteger(value.attempt_ordinal) || value.attempt_ordinal < 1
      || !Number.isSafeInteger(value.lease_generation) || value.lease_generation < 1) {
    throw new Error("decision harness Execution Envelope Attempt lease ordinal or generation is invalid")
  }
  requireUtc(value.claimed_at, "decision harness Execution Envelope Attempt lease claimed time")
  requireUtc(value.heartbeat_at, "decision harness Execution Envelope Attempt lease heartbeat time")
  requireUtc(value.lease_expires_at, "decision harness Execution Envelope Attempt lease expiry time")
  if (Date.parse(value.heartbeat_at) < Date.parse(value.claimed_at)
      || Date.parse(value.lease_expires_at) <= Date.parse(value.heartbeat_at)) {
    throw new Error("decision harness Execution Envelope Attempt lease time ordering is invalid")
  }
}

const FIELDS = ["attempt_id", "attempt_lease", "attempt_lease_hash", "attempt_lease_schema_version",
  "attempt_ordinal", "attempt_status", "claimed_at", "cross_attempt_retry_policy", "decision_output_authority",
  "economic_authority", "envelope_hash", "envelope_id", "envelope_policy_version", "harness_invocation",
  "heartbeat_at", "lease_expires_at", "lease_freshness_at_dispatch", "lease_generation",
  "lease_generation_policy", "lease_renewal_policy", "logical_request_id", "order_authority", "owner",
  "parent_validation", "predecessor_execution_envelope_hash", "process_instance_identity", "purpose",
  "replay_execution_request_hash", "reproducibility_pair_policy", "request_context_hash", "reservation_hash",
  "reservation_ref", "response_admission", "response_instance", "run_id", "same_generation_policy",
  "schema_version", "scope", "signal_authority", "source_response_contract", "source_response_contract_hash",
  "source_response_contract_id", "succession_kind", "transport", "transport_admission", "trial_authority",
  "trial_id", "worker_id", "worker_identity_semantics", "worker_protocol_version", "worker_request_hash",
  "worker_request_schema_version", "worker_response_schema_version"].sort()

function assertFields(value: object): void {
  if (canonicalHash(Object.keys(value).sort()) !== canonicalHash(FIELDS)) {
    throw new Error("decision harness Execution Envelope field whitelist drift")
  }
}
