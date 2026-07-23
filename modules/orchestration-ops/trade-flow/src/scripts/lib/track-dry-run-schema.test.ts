import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { readFileSync } from "node:fs"
import { isAbsolute, join } from "node:path"
import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import test from "node:test"
import { acquireCronLock, releaseCronLock } from "./cron-runtime"
import { ensureSchema as ensureEventStoreSchema } from "../../../../../portfolio-execution-state/event-store/src/lib/event-store"
import { buildDatabaseIdentity, ensureDatabaseIdentity } from "../../../../../contracts/runtime-core/src/database-identity"
import { resolveRepoPath } from "../../../../../contracts/runtime-core/src/paths"
import { runTrackDryRun, TRACK_DRY_RUN_MODES, TRACK_DRY_RUN_TRACKS } from "./track-runner"

type JSONRecord = Record<string, unknown>

function ensureSchema(db: Database): void {
  ensureDatabaseIdentity(db, buildDatabaseIdentity("local:local", "trade_event_store"))
  ensureEventStoreSchema(db)
}

test("track dry-run summary schema matches stable cron result envelope", () => {
  const schema = readSchema()
  assert.equal(schema.$id, "trade-flow.track-dry-run-summary.v1")
  assert.deepEqual(asArray(schema.required), ["track", "mode", "executable"])
  assert.deepEqual(asArray(asRecord(asRecord(schema.properties).track).enum), [...TRACK_DRY_RUN_TRACKS])
  assert.deepEqual(asArray(asRecord(asRecord(schema.properties).mode).enum), [...TRACK_DRY_RUN_MODES])
  assert.deepEqual(asArray(asRecord(asRecord(schema.properties).lane_conflicts).items && asRecord(asRecord(asRecord(schema.properties).lane_conflicts).items).required), ["lane_key", "chain_ids"])

  const dir = makeCheckDir("track-dry-run-schema-")
  const dbPath = join(dir, "trade.db")
  const db = new Database(dbPath)
  try {
    ensureSchema(db)
    db.close()
    const completed = runTrackDryRun(dbPath, "slow", dir) as JSONRecord
    for (const field of asArray(schema.required)) {
      assert.ok(String(field) in completed, `missing required field ${String(field)}`)
    }
    assert.equal(completed.track, "slow")
    assert.equal(completed.mode, "dry-run")
    assert.equal(completed.executable, false)
    assert.equal(typeof completed.run_id, "string")
    assert.equal(completed.active_flow_count, 0)
    assert.equal(Array.isArray(completed.lane_conflicts), true)
    assert.equal(Array.isArray(completed.active_flows), true)
    assert.equal(Array.isArray(completed.planned_steps), true)
    assert.equal(existsSync(resolveRepoPath(String(completed.cron_log_path))), true)
    assert.equal(isAbsolute(String(completed.cron_log_path)), false)

    const lock = acquireCronLock({
      dataDir: dir,
      track: "slow",
      now: new Date(),
      runId: "track-schema-active-lock",
    })
    try {
      const skipped = runTrackDryRun(dbPath, "fast", dir) as JSONRecord
      for (const field of asArray(schema.required)) {
        assert.ok(String(field) in skipped, `missing required field ${String(field)}`)
      }
      assert.equal(skipped.track, "fast")
      assert.equal(skipped.mode, "dry-run")
      assert.equal(skipped.executable, false)
      assert.equal(skipped.skipped, true)
      assert.equal(skipped.skip_reason, "active_lock")
      assert.equal(asRecord(skipped.active_lock).track, "slow")
      assert.equal(existsSync(resolveRepoPath(String(skipped.cron_log_path))), true)
      assert.equal(isAbsolute(String(skipped.cron_log_path)), false)
    } finally {
      releaseCronLock(lock)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

function makeCheckDir(prefix: string): string {
  const checkRoot = join(process.cwd(), "../../..", "tmp/check")
  mkdirSync(checkRoot, { recursive: true })
  return mkdtempSync(join(checkRoot, prefix))
}

function readSchema(): JSONRecord {
  return JSON.parse(readFileSync(new URL("../../schemas/track-dry-run-summary.schema.json", import.meta.url), "utf8")) as JSONRecord
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}
