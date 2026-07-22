import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import { mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"
import { repoRoot } from "../../../../../contracts/runtime-core/src/paths"
import {
  REPLAY_ATTEMPT_LEASE_SCHEMA_VERSION,
} from "../../../contracts/src/lib/control-plane-contracts"
import { REPLAY_ATTEMPT_ADMISSION_REQUEST_SCHEMA_VERSION } from "../../../contracts/src/lib/replay-attempt-admission"
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
    const response = run([
      "--db", dbPath,
      "--artifact-root", artifactRoot,
      "--recovered-at", "2026-07-16T08:00:00Z",
      "--json", JSON.stringify(claim),
    ], {
      claim: (_db, input) => ({
        schema_version: REPLAY_ATTEMPT_LEASE_SCHEMA_VERSION,
        attempt_id: input.attempt_id,
        attempt_ordinal: 1,
        worker_id: input.worker_id,
        trial_id: "trial-cli-1",
        run_id: "run-cli-1",
        reservation_ref: "reservation://cli/1",
        reservation_hash: "a".repeat(64),
        request_hash: "c".repeat(64),
        status: "claimed",
        lease_generation: 1,
        claimed_at: input.claimed_at,
        heartbeat_at: input.claimed_at,
        lease_expires_at: input.lease_expires_at,
      }),
    })
    assert.equal(response.ok, true)
    const data = response.data as Record<string, unknown>
    assert.equal(data.schema_version, "trade.rd-replay-attempt-admission-result.v2")
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
