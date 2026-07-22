import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
  REPLAY_ATTEMPT_LEASE_SCHEMA_VERSION,
  type ReplayAttemptLeaseSnapshot,
} from "../../../contracts/src/lib/control-plane-contracts"
import {
  REPLAY_ATTEMPT_ADMISSION_REQUEST_SCHEMA_VERSION,
  type ReplayAttemptAdmissionRequest,
} from "../../../contracts/src/lib/replay-attempt-admission"
import { ensureResearchStateSchema } from "../../../state-store/src/lib/research-state-store"
import { admitReplayAttemptAfterCancellationRecovery } from "./replay-attempt-admission"

const RECOVERED_AT = "2026-07-16T08:00:00Z"
const CLAIMED_AT = "2026-07-16T08:00:01Z"
const HASH = "a".repeat(64)

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
    })
    assert.equal(claimCount, 1)
    assert.equal(result.schema_version, "trade.rd-replay-attempt-admission-result.v2")
    assert.equal(result.request_registration_id, claim.request_registration_id)
    assert.equal(result.recovery.status, "no_outbox")
    assert.equal(result.attempt_lease.attempt_id, claim.attempt_id)
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
    request_registration_hash: "b".repeat(64),
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
    request_hash: "c".repeat(64),
    status: "claimed",
    lease_generation: 1,
    claimed_at: input.claimed_at,
    heartbeat_at: input.claimed_at,
    lease_expires_at: input.lease_expires_at,
  }
}
