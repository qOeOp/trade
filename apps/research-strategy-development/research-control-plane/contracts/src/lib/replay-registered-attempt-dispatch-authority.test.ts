import { describe, expect, test } from "bun:test"
import {
  REPLAY_ATTEMPT_LEASE_SCHEMA_VERSION,
  hashReplayAttemptLeaseSnapshot,
  type ReplayAttemptLeaseSnapshot,
} from "./control-plane-contracts"
import {
  REPLAY_REQUEST_REGISTRATION_RECORD_SCHEMA_VERSION,
  createReplayRequestRegistrationRecord,
} from "./replay-request-registration"
import {
  assertReplayRegisteredAttemptDispatchAuthority,
  createReplayRegisteredAttemptDispatchAuthority,
} from "./replay-registered-attempt-dispatch-authority"

const requestHash = "a".repeat(64)
const reservationHash = "b".repeat(64)
const registration = createReplayRequestRegistrationRecord({
  schema_version: REPLAY_REQUEST_REGISTRATION_RECORD_SCHEMA_VERSION,
  registration_id: "registration-dispatch-1",
  reservation_admission_id: "reservation-admission-1",
  reservation_admission_hash: "c".repeat(64),
  trial_id: "trial-1",
  run_id: "run-1",
  reservation_ref: "reservation://trial-1",
  reservation_hash: reservationHash,
  execution_spec_hash: "d".repeat(64),
  request_idempotency_key: "request-key-1",
  request_hash: requestHash,
  replay_request: { schema_version: "fixture", run_id: "run-1" },
  dataset_manifest_hash: "e".repeat(64),
  registered_at: "2026-07-23T01:00:00Z",
})
const lease: ReplayAttemptLeaseSnapshot = {
  schema_version: REPLAY_ATTEMPT_LEASE_SCHEMA_VERSION,
  attempt_id: "attempt-1",
  attempt_ordinal: 1,
  worker_id: "worker-1",
  trial_id: "trial-1",
  run_id: "run-1",
  reservation_ref: "reservation://trial-1",
  reservation_hash: reservationHash,
  request_hash: requestHash,
  status: "claimed",
  lease_generation: 1,
  claimed_at: "2026-07-23T01:01:00Z",
  heartbeat_at: "2026-07-23T01:01:00Z",
  lease_expires_at: "2026-07-23T01:10:00Z",
}

function authority() {
  return createReplayRegisteredAttemptDispatchAuthority({
    authority_id: "registered-attempt-dispatch-1",
    authority_ref: "authority://replay-registered-attempt-dispatch/1",
    request_registration_id: registration.registration_id,
    request_registration_hash: registration.registration_hash,
    request_registration: registration,
    replay_execution_request_hash: registration.request_hash,
    trial_id: lease.trial_id,
    run_id: lease.run_id,
    reservation_ref: lease.reservation_ref,
    reservation_hash: lease.reservation_hash,
    attempt_id: lease.attempt_id,
    attempt_ordinal: lease.attempt_ordinal,
    worker_id: lease.worker_id,
    attempt_status: lease.status,
    lease_generation: lease.lease_generation,
    attempt_lease_hash: hashReplayAttemptLeaseSnapshot(lease),
    attempt_lease: lease,
    issued_at: "2026-07-23T01:02:00Z",
    valid_before: lease.lease_expires_at,
  })
}

describe("Replay Registered Attempt Dispatch Authority", () => {
  test("binds one registered Request to one exact current Lease", () => {
    const value = authority()
    expect(() => assertReplayRegisteredAttemptDispatchAuthority(value)).not.toThrow()
    expect(value.request_registration_hash).toBe(registration.registration_hash)
    expect(value.attempt_lease_hash).toBe(hashReplayAttemptLeaseSnapshot(lease))
  })

  test("rejects Registration, Lease, chronology, and rehashed lineage drift", () => {
    const value = authority()
    expect(() => createReplayRegisteredAttemptDispatchAuthority({
      ...value,
      request_registration_hash: "f".repeat(64),
    })).toThrow(/lineage/)
    expect(() => createReplayRegisteredAttemptDispatchAuthority({
      ...value,
      lease_generation: 2,
    })).toThrow(/lineage/)
    expect(() => createReplayRegisteredAttemptDispatchAuthority({
      ...value,
      issued_at: value.valid_before,
    })).toThrow(/inside the current Lease window/)
    expect(() => assertReplayRegisteredAttemptDispatchAuthority({
      ...value,
      authority_hash: "0".repeat(64),
    })).toThrow(/hash drifted/)
  })
})
