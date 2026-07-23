import { canonicalNfcJson } from "../../../../../contracts/runtime-core/src/canonical-json"
import {
  assertReplayAttemptLeaseSnapshot,
  canonicalControlPlaneHash,
  hashReplayAttemptLeaseSnapshot,
  type ReplayAttemptLeaseSnapshot,
} from "./control-plane-contracts"
import {
  assertReplayRequestRegistrationRecord,
  type ReplayRequestRegistrationRecord,
} from "./replay-request-registration"
import { digest, isRecord, required, utc } from "./developer-contract-draft"

export const REPLAY_REGISTERED_ATTEMPT_DISPATCH_AUTHORITY_SCHEMA_VERSION =
  "trade.rd-replay-registered-attempt-dispatch-authority.v1" as const
export const REPLAY_REGISTERED_ATTEMPT_DISPATCH_AUTHORITY_POLICY_VERSION =
  "rd-replay-registered-attempt-dispatch-authority-v1" as const

export interface ReplayRegisteredAttemptDispatchAuthorityBody {
  schema_version: typeof REPLAY_REGISTERED_ATTEMPT_DISPATCH_AUTHORITY_SCHEMA_VERSION
  authority_id: string
  authority_ref: string
  authority_policy_version: typeof REPLAY_REGISTERED_ATTEMPT_DISPATCH_AUTHORITY_POLICY_VERSION
  status: "registered_request_current_lease_bound"
  authority_owner: "research_control_plane"
  authority_source: "research_control_plane_state_store"
  issue_consistency: "single_control_plane_transaction"
  binding_policy: "exact_registered_request_plus_exact_current_attempt_lease"
  request_registration_id: string
  request_registration_hash: string
  request_registration: ReplayRequestRegistrationRecord
  replay_execution_request_hash: string
  trial_id: string
  run_id: string
  reservation_ref: string
  reservation_hash: string
  attempt_id: string
  attempt_ordinal: number
  worker_id: string
  attempt_status: "claimed" | "running"
  lease_generation: number
  attempt_lease_hash: string
  attempt_lease: ReplayAttemptLeaseSnapshot
  issued_at: string
  valid_before: string
  dispatch_authority: "runner_may_validate_lineage_before_execution"
  search_authority: "none"
  review_authority: "none"
  lifecycle_authority: "none"
  economic_authority: "none"
}

export interface ReplayRegisteredAttemptDispatchAuthority
  extends ReplayRegisteredAttemptDispatchAuthorityBody {
  authority_hash: string
}

export function createReplayRegisteredAttemptDispatchAuthority(
  input: Omit<ReplayRegisteredAttemptDispatchAuthorityBody,
    "schema_version" | "authority_policy_version" | "status" | "authority_owner" |
    "authority_source" | "issue_consistency" | "binding_policy" | "dispatch_authority" |
    "search_authority" | "review_authority" | "lifecycle_authority" | "economic_authority">,
): ReplayRegisteredAttemptDispatchAuthority {
  const body: ReplayRegisteredAttemptDispatchAuthorityBody = {
    schema_version: REPLAY_REGISTERED_ATTEMPT_DISPATCH_AUTHORITY_SCHEMA_VERSION,
    authority_id: required(input.authority_id, "authority_id"),
    authority_ref: required(input.authority_ref, "authority_ref"),
    authority_policy_version: REPLAY_REGISTERED_ATTEMPT_DISPATCH_AUTHORITY_POLICY_VERSION,
    status: "registered_request_current_lease_bound",
    authority_owner: "research_control_plane",
    authority_source: "research_control_plane_state_store",
    issue_consistency: "single_control_plane_transaction",
    binding_policy: "exact_registered_request_plus_exact_current_attempt_lease",
    request_registration_id: required(input.request_registration_id, "request_registration_id"),
    request_registration_hash: digest(input.request_registration_hash, "request_registration_hash"),
    request_registration: structuredClone(input.request_registration),
    replay_execution_request_hash: digest(input.replay_execution_request_hash, "replay_execution_request_hash"),
    trial_id: required(input.trial_id, "trial_id"),
    run_id: required(input.run_id, "run_id"),
    reservation_ref: required(input.reservation_ref, "reservation_ref"),
    reservation_hash: digest(input.reservation_hash, "reservation_hash"),
    attempt_id: required(input.attempt_id, "attempt_id"),
    attempt_ordinal: input.attempt_ordinal,
    worker_id: required(input.worker_id, "worker_id"),
    attempt_status: input.attempt_status,
    lease_generation: input.lease_generation,
    attempt_lease_hash: digest(input.attempt_lease_hash, "attempt_lease_hash"),
    attempt_lease: structuredClone(input.attempt_lease),
    issued_at: utc(input.issued_at, "issued_at"),
    valid_before: utc(input.valid_before, "valid_before"),
    dispatch_authority: "runner_may_validate_lineage_before_execution",
    search_authority: "none",
    review_authority: "none",
    lifecycle_authority: "none",
    economic_authority: "none",
  }
  assertBindings(body)
  return { ...body, authority_hash: canonicalControlPlaneHash(body) }
}

export function assertReplayRegisteredAttemptDispatchAuthority(
  value: ReplayRegisteredAttemptDispatchAuthority,
): void {
  if (!isRecord(value)) throw new Error("Replay Registered Attempt Dispatch Authority must be an object")
  const { authority_hash: authorityHash, ...body } = value
  digest(authorityHash, "authority_hash")
  if (canonicalControlPlaneHash(body) !== authorityHash) {
    throw new Error("Replay Registered Attempt Dispatch Authority hash drifted")
  }
  const { schema_version: _schema, authority_policy_version: _policy, status: _status,
    authority_owner: _owner, authority_source: _source, issue_consistency: _consistency,
    binding_policy: _binding, dispatch_authority: _dispatch, search_authority: _search,
    review_authority: _review, lifecycle_authority: _lifecycle, economic_authority: _economic,
    ...input } = body
  const expected = createReplayRegisteredAttemptDispatchAuthority(input)
  if (canonicalNfcJson(value) !== canonicalNfcJson(expected)) {
    throw new Error("Replay Registered Attempt Dispatch Authority is non-canonical")
  }
}

function assertBindings(value: ReplayRegisteredAttemptDispatchAuthorityBody): void {
  assertReplayRequestRegistrationRecord(value.request_registration)
  assertReplayAttemptLeaseSnapshot(value.attempt_lease)
  const registration = value.request_registration
  const lease = value.attempt_lease
  if (!Number.isSafeInteger(value.attempt_ordinal) || value.attempt_ordinal < 1
      || !Number.isSafeInteger(value.lease_generation) || value.lease_generation < 1) {
    throw new Error("Replay Registered Attempt Dispatch Authority ordinal or generation is invalid")
  }
  if (value.attempt_status !== "claimed" && value.attempt_status !== "running") {
    throw new Error("Replay Registered Attempt Dispatch Authority requires an active Attempt")
  }
  if (value.request_registration_id !== registration.registration_id
      || value.request_registration_hash !== registration.registration_hash
      || value.replay_execution_request_hash !== registration.request_hash
      || value.trial_id !== registration.trial_id || value.trial_id !== lease.trial_id
      || value.run_id !== registration.run_id || value.run_id !== lease.run_id
      || value.reservation_ref !== registration.reservation_ref
      || value.reservation_ref !== lease.reservation_ref
      || value.reservation_hash !== registration.reservation_hash
      || value.reservation_hash !== lease.reservation_hash
      || value.replay_execution_request_hash !== lease.request_hash
      || value.attempt_id !== lease.attempt_id || value.attempt_ordinal !== lease.attempt_ordinal
      || value.worker_id !== lease.worker_id || value.attempt_status !== lease.status
      || value.lease_generation !== lease.lease_generation
      || value.attempt_lease_hash !== hashReplayAttemptLeaseSnapshot(lease)
      || value.valid_before !== lease.lease_expires_at) {
    throw new Error("Replay Registered Attempt Dispatch Authority lineage is inconsistent")
  }
  const issued = Date.parse(value.issued_at)
  if (issued < Date.parse(lease.heartbeat_at) || issued >= Date.parse(lease.lease_expires_at)) {
    throw new Error("Replay Registered Attempt Dispatch Authority must be issued inside the current Lease window")
  }
}
