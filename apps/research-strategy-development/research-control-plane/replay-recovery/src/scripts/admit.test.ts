import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import { mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"
import { repoRoot } from "../../../../../contracts/runtime-core/src/paths"
import {
  REPLAY_ATTEMPT_LEASE_SCHEMA_VERSION,
  hashReplayAttemptLeaseSnapshot,
} from "../../../contracts/src/lib/control-plane-contracts"
import { REPLAY_ATTEMPT_ADMISSION_REQUEST_SCHEMA_VERSION } from "../../../contracts/src/lib/replay-attempt-admission"
import {
  REPLAY_REQUEST_REGISTRATION_RECORD_SCHEMA_VERSION,
  createReplayRequestRegistrationRecord,
} from "../../../contracts/src/lib/replay-request-registration"
import { createReplayRegisteredAttemptDispatchAuthority } from "../../../contracts/src/lib/replay-registered-attempt-dispatch-authority"
import { ensureResearchStateSchema } from "../../../state-store/src/lib/research-state-store"
import { run } from "./admit"

test("Replay Attempt admission CLI gates claim behind recovery", () => {
  const relativeRoot = "tmp/check/rd-replay-attempt-admission-cli"
  const absoluteRoot = join(repoRoot(), relativeRoot)
  const dbPath = `${relativeRoot}/rd.db`
  const artifactRoot = `${relativeRoot}/artifacts`
  rmSync(absoluteRoot, { recursive: true, force: true })
  mkdirSync(join(repoRoot(), artifactRoot), { recursive: true })
  const db = new Database(join(repoRoot(), dbPath))
  ensureResearchStateSchema(db)
  db.close()
  const claim = testClaim()
  try {
    const lease = testLease(claim)
    const registration = testRegistration(lease)
    claim.request_registration_hash = registration.registration_hash
    const response = run([
      "--db", dbPath,
      "--artifact-root", artifactRoot,
      "--recovered-at", "2026-07-16T08:00:00Z",
      "--json", JSON.stringify(claim),
    ], {
      claim: () => lease,
      issue_dispatch_authority: (_db, input) => createReplayRegisteredAttemptDispatchAuthority({
        authority_id: "registered-attempt-dispatch-cli-1",
        authority_ref: "authority://replay-registered-attempt-dispatch/cli-1",
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
        issued_at: input.issued_at,
        valid_before: lease.lease_expires_at,
      }),
    })
    assert.equal(response.ok, true)
    const data = response.data as Record<string, unknown>
    assert.equal(data.schema_version, "trade.rd-replay-attempt-admission-result.v3")
    assert.equal(JSON.stringify(response).includes(repoRoot()), false)
  } finally {
    rmSync(absoluteRoot, { recursive: true, force: true })
  }
})

test("Replay Attempt admission CLI requires explicit recovery evidence", () => {
  const response = run(["--artifact-root", "tmp/check/missing", "--json", "{}"])
  assert.equal(response.ok, false)
  assert.match(String(response.error), /recovered-at/)
})

function testClaim(): Record<string, unknown> {
  return {
    schema_version: REPLAY_ATTEMPT_ADMISSION_REQUEST_SCHEMA_VERSION,
    attempt_id: "attempt-cli-1",
    worker_id: "worker-cli-1",
    idempotency_key: "attempt-cli-key-1",
    request_registration_id: "request-registration-cli-1",
    request_registration_hash: "b".repeat(64),
    claimed_at: "2026-07-16T08:00:01Z",
    lease_expires_at: "2026-07-16T08:05:00Z",
  }
}

function testLease(claim: Record<string, unknown>) {
  return {
    schema_version: REPLAY_ATTEMPT_LEASE_SCHEMA_VERSION,
    attempt_id: String(claim.attempt_id),
    attempt_ordinal: 1,
    worker_id: String(claim.worker_id),
    trial_id: "trial-cli-1",
    run_id: "run-cli-1",
    reservation_ref: "reservation://cli/1",
    reservation_hash: "a".repeat(64),
    request_hash: "c".repeat(64),
    status: "claimed" as const,
    lease_generation: 1,
    claimed_at: String(claim.claimed_at),
    heartbeat_at: String(claim.claimed_at),
    lease_expires_at: String(claim.lease_expires_at),
  }
}

function testRegistration(lease: ReturnType<typeof testLease>) {
  return createReplayRequestRegistrationRecord({
    schema_version: REPLAY_REQUEST_REGISTRATION_RECORD_SCHEMA_VERSION,
    registration_id: "request-registration-cli-1",
    reservation_admission_id: "reservation-admission-cli-1",
    reservation_admission_hash: "d".repeat(64),
    trial_id: lease.trial_id,
    run_id: lease.run_id,
    reservation_ref: lease.reservation_ref,
    reservation_hash: lease.reservation_hash,
    execution_spec_hash: "e".repeat(64),
    request_idempotency_key: "request-key-cli-1",
    request_hash: lease.request_hash,
    replay_request: { schema_version: "fixture", run_id: lease.run_id },
    dataset_manifest_hash: "f".repeat(64),
    registered_at: "2026-07-16T07:59:00Z",
  })
}
