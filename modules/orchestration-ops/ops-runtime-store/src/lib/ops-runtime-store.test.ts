import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import test from "node:test"
import {
  buildCycleRun,
  buildJobRun,
  ensureOpsRuntimeSchema,
  readCycleSummary,
  readLatestRuntimeHealth,
  recordNotifyAttempt,
  recordRuntimeHealth,
  upsertCycleRun,
  upsertJobRun,
  upsertOpsLock,
} from "./ops-runtime-store"

test("ops runtime store creates schema and records cycle/job observability", () => {
  const db = new Database(":memory:")
  ensureOpsRuntimeSchema(db)
  try {
    const cycle = buildCycleRun({
      cycle_id: "cycle-1",
      now: "2026-07-11T00:00:00Z",
      summary: { mode: "test" },
    })
    upsertCycleRun(db, cycle)
    upsertJobRun(db, buildJobRun({
      cycle_id: "cycle-1",
      ticket_no: "J01",
      job_id: "runtime_health_guard",
      target_domain: "orchestration-ops",
      status: "completed",
      result_ref: "ops://health/1",
    }))

    const summary = readCycleSummary(db, "cycle-1") as {
      cycle: { cycle_id: string; summary_json: { mode: string } }
      jobs: Array<{ ticket_no: string; status: string; result_ref: string }>
    }
    assert.equal(summary.cycle.cycle_id, "cycle-1")
    assert.equal(summary.cycle.summary_json.mode, "test")
    assert.equal(summary.jobs.length, 1)
    assert.equal(summary.jobs[0].ticket_no, "J01")
    assert.equal(summary.jobs[0].status, "completed")
    assert.equal(summary.jobs[0].result_ref, "ops://health/1")
  } finally {
    db.close()
  }
})

test("ops runtime store records health, notify attempts, and locks", () => {
  const db = new Database(":memory:")
  ensureOpsRuntimeSchema(db)
  try {
    upsertCycleRun(db, buildCycleRun({ cycle_id: "cycle-2", now: "2026-07-11T00:00:00Z" }))
    recordRuntimeHealth(db, {
      health_id: "health-1",
      cycle_id: "cycle-2",
      status: "ok",
      observed_at: "2026-07-11T00:00:01Z",
      checks_json: { checks: [{ name: "config", status: "ok" }] },
    })
    recordNotifyAttempt(db, {
      notify_id: "notify-1",
      cycle_id: "cycle-2",
      channel: "stdout",
      status: "sent",
      attempted_at: "2026-07-11T00:00:02Z",
      result_json: { delivered: true },
    })
    upsertOpsLock(db, {
      lock_key: "automation-cycle",
      holder_id: "cycle-2",
      acquired_at: "2026-07-11T00:00:00Z",
      expires_at: "2026-07-11T00:05:00Z",
    })

    const latest = readLatestRuntimeHealth(db)
    assert.equal(latest?.health_id, "health-1")
    assert.equal(latest?.status, "ok")
    const notifyRow = db.query("SELECT status FROM notify_attempt WHERE notify_id='notify-1'").get() as { status: string }
    assert.equal(notifyRow.status, "sent")
    const lockRow = db.query("SELECT holder_id FROM ops_lock WHERE lock_key='automation-cycle'").get() as { holder_id: string }
    assert.equal(lockRow.holder_id, "cycle-2")
  } finally {
    db.close()
  }
})

