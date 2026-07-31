import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { ensureResearchStateSchema } from "../../../state-store/src/lib/research-state-store"
import { runReplayCancellationRecoveryJob } from "./replay-cancellation-recovery-job"

const NOW = "2026-07-16T08:00:00Z"

test("startup recovery accepts an empty certified local store without leaking local paths", () => {
  const dir = mkdtempSync(join(tmpdir(), "rd-replay-recovery-job-"))
  const dbPath = join(dir, "rd.db")
  const artifactRoot = join(dir, "artifacts")
  mkdirSync(artifactRoot)
  const db = new Database(dbPath)
  ensureResearchStateSchema(db)
  db.close()
  try {
    const result = runReplayCancellationRecoveryJob({
      db_path: dbPath,
      artifact_root: artifactRoot,
      registered_at: NOW,
    })
    assert.deepEqual(result, {
      schema_version: "trade.rd-replay-cancellation-recovery-job-result.v1",
      status: "no_outbox",
      recovered_at: NOW,
      discovered_count: 0,
      registered_count: 0,
      already_registered_count: 0,
      recovery: {
        schema_version: "trade.rd-replay-cancellation-discovery-recovery-result.v2",
        discovered_count: 0,
        deliveries: [],
      },
    })
    assert.equal(JSON.stringify(result).includes(dir), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("startup recovery fails closed on malformed outbox before registry mutation", () => {
  const dir = mkdtempSync(join(tmpdir(), "rd-replay-recovery-malformed-"))
  const dbPath = join(dir, "rd.db")
  const artifactRoot = join(dir, "artifacts")
  const attemptRoot = join(artifactRoot, "a".repeat(24), "b".repeat(24))
  mkdirSync(attemptRoot, { recursive: true })
  writeFileSync(join(attemptRoot, "cancellation-observation-outbox.json"), "not-json\n", "utf8")
  const db = new Database(dbPath)
  ensureResearchStateSchema(db)
  db.close()
  try {
    assert.throws(() => runReplayCancellationRecoveryJob({
      db_path: dbPath,
      artifact_root: artifactRoot,
      registered_at: NOW,
    }), /invalid JSON/)
    const verify = new Database(dbPath, { readonly: true })
    try {
      const count = verify.query("SELECT COUNT(*) AS count FROM rd_replay_attempt_cancellation_observation").get() as { count: number }
      assert.equal(count.count, 0)
    } finally {
      verify.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("startup recovery refuses missing or non-authoritative Control Plane databases", () => {
  const dir = mkdtempSync(join(tmpdir(), "rd-replay-recovery-db-"))
  const artifactRoot = join(dir, "artifacts")
  mkdirSync(artifactRoot)
  try {
    assert.throws(() => runReplayCancellationRecoveryJob({
      db_path: join(dir, "missing.db"),
      artifact_root: artifactRoot,
      registered_at: NOW,
    }), /does not exist/)
    const emptyDbPath = join(dir, "empty.db")
    new Database(emptyDbPath).close()
    assert.throws(() => runReplayCancellationRecoveryJob({
      db_path: emptyDbPath,
      artifact_root: artifactRoot,
      registered_at: NOW,
    }), /authority schema/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
