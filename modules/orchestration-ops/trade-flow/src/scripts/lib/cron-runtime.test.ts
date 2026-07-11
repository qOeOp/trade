import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import test from "node:test"
import { acquireCronLock, appendCronLog, releaseCronLock } from "./cron-runtime"
import { runTrackDryRun } from "./track-runner"
import { ensureSchema } from "../../../../../portfolio-execution-state/event-store/src/lib/event-store"
import { resolveRepoPath } from "./paths"

test("cron lock skips active lock and releases acquired lock", () => {
  const dir = mkdtempSync(join(tmpdir(), "trade-flow-lock-"))
  try {
    const acquired = acquireCronLock({
      dataDir: dir,
      track: "slow",
      now: new Date("2026-07-08T12:00:00Z"),
      runId: "run-lock-1",
    })
    assert.equal(acquired.acquired, true)

    const skipped = acquireCronLock({
      dataDir: dir,
      track: "fast",
      now: new Date("2026-07-08T12:01:00Z"),
      runId: "run-lock-2",
    })
    assert.equal(skipped.acquired, false)
    assert.equal(skipped.active_lock?.track, "slow")

    releaseCronLock(acquired)
    assert.equal(existsSync(join(dir, ".trade-flow.lock")), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("cron lock replaces stale lock", () => {
  const dir = mkdtempSync(join(tmpdir(), "trade-flow-stale-lock-"))
  try {
    writeFileSync(join(dir, ".trade-flow.lock"), JSON.stringify({
      run_id: "stale-run",
      track: "slow",
      pid: 1,
      start_time: "2026-07-08T12:00:00Z",
    }))

    const acquired = acquireCronLock({
      dataDir: dir,
      track: "fast",
      now: new Date("2026-07-08T12:11:00Z"),
      runId: "fresh-run",
    })
    assert.equal(acquired.acquired, true)
    assert.equal(acquired.active_lock?.run_id, "stale-run")
    releaseCronLock(acquired)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("cron log writes json lines and track dry-run releases lock", () => {
  const dir = mkdtempSync(join(tmpdir(), "trade-flow-cron-log-"))
  const db = new Database(":memory:")
  try {
    ensureSchema(db)
    const logPath = appendCronLog(dir, {
      run_id: "run-log-1",
      track: "slow",
      triggered_at: "2026-07-08T12:00:00Z",
      duration_ms: 1,
      status: "completed",
      chains_processed: 0,
      actions_taken: [],
      errors: [],
    })
    assert.equal(JSON.parse(readFileSync(resolveRepoPath(logPath), "utf8").trim()).run_id, "run-log-1")

    const result = runTrackDryRun(db, "fast", dir) as { status?: string; cron_log_path: string }
    assert.equal(result.status, undefined)
    assert.equal(existsSync(join(dir, ".trade-flow.lock")), false)
    const lines = readFileSync(resolveRepoPath(result.cron_log_path), "utf8").trim().split("\n")
    assert.equal(lines.length, 2)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
