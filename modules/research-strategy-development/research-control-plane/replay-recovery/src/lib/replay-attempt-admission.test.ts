import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
  REPLAY_ATTEMPT_LEASE_SCHEMA_VERSION,
  hashReplayAttemptLeaseSnapshot,
  type ReplayAttemptLeaseSnapshot,
} from "../../../contracts/src/lib/control-plane-contracts"
import {
  REPLAY_ATTEMPT_ADMISSION_REQUEST_SCHEMA_VERSION,
  type ReplayAttemptAdmissionRequest,
} from "../../../contracts/src/lib/replay-attempt-admission"
import { ensureResearchStateSchema } from "../../../state-store/src/lib/research-state-store"
import type { IssueReplayRegisteredAttemptDispatchAuthorityInput } from "../../../state-store/src/lib/replay-attempt-authority"
import {
  REPLAY_REQUEST_REGISTRATION_RECORD_SCHEMA_VERSION,
  createReplayRequestRegistrationRecord,
} from "../../../contracts/src/lib/replay-request-registration"
import { createReplayRegisteredAttemptDispatchAuthority } from "../../../contracts/src/lib/replay-registered-attempt-dispatch-authority"
import { admitReplayAttemptAfterCancellationRecovery } from "./replay-attempt-admission"

const RECOVERED_AT = "2026-07-16T08:00:00Z"
const CLAIMED_AT = "2026-07-16T08:00:01Z"
const HASH = "a".repeat(64)
const REQUEST_HASH = "c".repeat(64)
const REGISTRATION = createReplayRequestRegistrationRecord({
  schema_version: REPLAY_REQUEST_REGISTRATION_RECORD_SCHEMA_VERSION,
  registration_id: "request-registration-admission-1",
  reservation_admission_id: "reservation-admission-1",
  reservation_admission_hash: "d".repeat(64),
  trial_id: "trial-admission-1",
  run_id: "run-admission-1",
  reservation_ref: "reservation://admission/1",
  reservation_hash: HASH,
  execution_spec_hash: "e".repeat(64),
  request_idempotency_key: "request-key-admission-1",
  request_hash: REQUEST_HASH,
  replay_request: { schema_version: "fixture", run_id: "run-admission-1" },
  dataset_manifest_hash: "f".repeat(64),
  registered_at: "2026-07-16T07:59:00Z",
})

test("Attempt admission runs complete recovery before invoking the authoritative claim", () => {
  const fixture = setup("rd-replay-attempt-admission-")
  let claimCount = 0
  try {
    const claim = claimInput()
    const result = admitReplayAttemptAfterCancellationRecovery({
      db_path: fixture.dbPath,
      artifact_root: fixture.artifactRoot,
      recovered_at: RECOVERED_AT,
      claim,
    }, {
      claim: (_db, input) => {
        claimCount += 1
        return leaseFor(input)
      },
      issue_dispatch_authority: (_db, input) => dispatchAuthorityFor(input),
    })
    assert.equal(claimCount, 1)
    assert.equal(result.schema_version, "trade.rd-replay-attempt-admission-result.v3")
    assert.equal(result.dispatch_authority.request_registration_id, claim.request_registration_id)
    assert.equal(result.recovery.status, "no_outbox")
    assert.equal(result.dispatch_authority.attempt_lease.attempt_id, claim.attempt_id)
    assert.equal(JSON.stringify(result).includes(fixture.dir), false)
  } finally {
    fixture.cleanup()
  }
})

test("malformed outbox fails closed before Attempt claim", () => {
  const fixture = setup("rd-replay-attempt-admission-malformed-")
  const attemptRoot = join(fixture.artifactRoot, "a".repeat(24), "b".repeat(24))
  mkdirSync(attemptRoot, { recursive: true })
  writeFileSync(join(attemptRoot, "cancellation-observation-outbox.json"), "not-json\n", "utf8")
  let claimCount = 0
  try {
    assert.throws(() => admitReplayAttemptAfterCancellationRecovery({
      db_path: fixture.dbPath,
      artifact_root: fixture.artifactRoot,
      recovered_at: RECOVERED_AT,
      claim: claimInput(),
    }, {
      claim: (_db, input) => {
        claimCount += 1
        return leaseFor(input)
      },
      issue_dispatch_authority: (_db, input) => dispatchAuthorityFor(input),
    }), /invalid JSON/)
    assert.equal(claimCount, 0)
    const verify = new Database(fixture.dbPath, { readonly: true })
    try {
      const count = verify.query("SELECT COUNT(*) AS count FROM rd_replay_attempt").get() as { count: number }
      assert.equal(count.count, 0)
    } finally {
      verify.close()
    }
  } finally {
    fixture.cleanup()
  }
})

test("default admission adapter reaches authoritative claim only after recovery", () => {
  const fixture = setup("rd-replay-attempt-admission-authority-")
  try {
    assert.throws(() => admitReplayAttemptAfterCancellationRecovery({
      db_path: fixture.dbPath,
      artifact_root: fixture.artifactRoot,
      recovered_at: RECOVERED_AT,
      claim: claimInput(),
    }), /Request Registration Record is missing/)
    const verify = new Database(fixture.dbPath, { readonly: true })
    try {
      const count = verify.query("SELECT COUNT(*) AS count FROM rd_replay_attempt").get() as { count: number }
      assert.equal(count.count, 0)
    } finally {
      verify.close()
    }
  } finally {
    fixture.cleanup()
  }
})

test("Attempt admission rejects recovery chronology before opening authority", () => {
  let claimCount = 0
  assert.throws(() => admitReplayAttemptAfterCancellationRecovery({
    db_path: "/missing/authority.db",
    artifact_root: "/missing/artifacts",
    recovered_at: "2026-07-16T08:00:02Z",
    claim: claimInput(),
  }, {
    claim: (_db, input) => {
      claimCount += 1
      return leaseFor(input)
    },
    issue_dispatch_authority: (_db, input) => dispatchAuthorityFor(input),
  }), /at or before/)
  assert.equal(claimCount, 0)
})

test("Attempt admission rejects caller-supplied Request or Reservation authority", () => {
  assert.throws(() => admitReplayAttemptAfterCancellationRecovery({
    db_path: "/missing/authority.db",
    artifact_root: "/missing/artifacts",
    recovered_at: RECOVERED_AT,
    claim: {
      ...claimInput(),
      request_hash: "d".repeat(64),
      trial_reservation: { status: "reserved" },
    } as unknown as ReplayAttemptAdmissionRequest,
  }), /carries unsupported fields/)
})

function setup(prefix: string): { dir: string; dbPath: string; artifactRoot: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  const dbPath = join(dir, "rd.db")
  const artifactRoot = join(dir, "artifacts")
  mkdirSync(artifactRoot)
  const db = new Database(dbPath)
  ensureResearchStateSchema(db)
  db.close()
  return { dir, dbPath, artifactRoot, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function claimInput(): ReplayAttemptAdmissionRequest {
  return {
    schema_version: REPLAY_ATTEMPT_ADMISSION_REQUEST_SCHEMA_VERSION,
    attempt_id: "attempt-admission-1",
    worker_id: "worker-admission-1",
    idempotency_key: "attempt-admission-key-1",
    request_registration_id: "request-registration-admission-1",
    request_registration_hash: REGISTRATION.registration_hash,
    claimed_at: CLAIMED_AT,
    lease_expires_at: "2026-07-16T08:05:00Z",
  }
}

function leaseFor(input: ReplayAttemptAdmissionRequest): ReplayAttemptLeaseSnapshot {
  return {
    schema_version: REPLAY_ATTEMPT_LEASE_SCHEMA_VERSION,
    attempt_id: input.attempt_id,
    attempt_ordinal: 1,
    worker_id: input.worker_id,
    trial_id: "trial-admission-1",
    run_id: "run-admission-1",
    reservation_ref: "reservation://admission/1",
    reservation_hash: HASH,
    request_hash: REQUEST_HASH,
    status: "claimed",
    lease_generation: 1,
    claimed_at: input.claimed_at,
    heartbeat_at: input.claimed_at,
    lease_expires_at: input.lease_expires_at,
  }
}

function dispatchAuthorityFor(input: IssueReplayRegisteredAttemptDispatchAuthorityInput) {
  const lease = {
    ...leaseFor(claimInput()),
    attempt_id: input.attempt_id,
    worker_id: input.worker_id,
    lease_generation: input.expected_lease_generation,
  }
  return createReplayRegisteredAttemptDispatchAuthority({
    authority_id: "registered-attempt-dispatch-admission-1",
    authority_ref: "authority://replay-registered-attempt-dispatch/admission-1",
    request_registration_id: REGISTRATION.registration_id,
    request_registration_hash: REGISTRATION.registration_hash,
    request_registration: REGISTRATION,
    replay_execution_request_hash: REGISTRATION.request_hash,
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
    issued_at: input.issued_at,
    valid_before: lease.lease_expires_at,
  })
}
