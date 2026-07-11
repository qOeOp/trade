import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import test from "node:test"
import {
  buildCycleRun,
  buildDomainMessage,
  buildJobRun,
  ensureOpsRuntimeSchema,
  readCycleSummary,
  readDomainMessages,
  readLatestRuntimeHealth,
  recordNotifyAttempt,
  recordRuntimeHealth,
  upsertCycleRun,
  upsertDomainMessage,
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
      command_ref: "serial_startup:runtime_health_guard",
      result_ref: "ops://health/1",
    }))
    upsertJobRun(db, buildJobRun({
      cycle_id: "cycle-1",
      ticket_no: "J03",
      job_id: "fast_track_guard",
      target_domain: "live-execution-control",
      status: "blocked",
      command_ref: "serial_trade_db_guard:fast_track_guard",
      result_ref: "ops://fast/blocked",
      error: { reason: "safe_mode" },
    }))

    const summary = readCycleSummary(db, "cycle-1") as {
      cycle: { cycle_id: string; summary_json: { mode: string } }
      jobs: Array<{ ticket_no: string; status: string; stage: string; result_ref: string }>
      ops_summary: {
        counts: { total: number; completed: number; blocked: number }
        stages: Array<{ stage: string; blocked: number }>
        domains: Array<{ target_domain: string; blocked: number }>
        attention: { needs_human: boolean; severity: string; reasons: string[]; blocked_jobs: Array<{ job_id: string }> }
      }
    }
    assert.equal(summary.cycle.cycle_id, "cycle-1")
    assert.equal(summary.cycle.summary_json.mode, "test")
    assert.equal(summary.jobs.length, 2)
    assert.equal(summary.jobs[0].ticket_no, "J01")
    assert.equal(summary.jobs[0].status, "completed")
    assert.equal(summary.jobs[0].stage, "serial_startup")
    assert.equal(summary.jobs[0].result_ref, "ops://health/1")
    assert.equal(summary.ops_summary.counts.total, 2)
    assert.equal(summary.ops_summary.counts.completed, 1)
    assert.equal(summary.ops_summary.counts.blocked, 1)
    assert.equal(summary.ops_summary.stages.find((stage) => stage.stage === "serial_trade_db_guard")?.blocked, 1)
    assert.equal(summary.ops_summary.domains.find((domain) => domain.target_domain === "live-execution-control")?.blocked, 1)
    assert.equal(summary.ops_summary.attention.needs_human, true)
    assert.equal(summary.ops_summary.attention.severity, "critical")
    assert.equal(summary.ops_summary.attention.reasons.includes("job_blocked:J03"), true)
    assert.equal(summary.ops_summary.attention.blocked_jobs[0].job_id, "fast_track_guard")
  } finally {
    db.close()
  }
})

test("ops runtime store records domain bus messages by cycle and target", () => {
  const db = new Database(":memory:")
  ensureOpsRuntimeSchema(db)
  try {
    upsertCycleRun(db, buildCycleRun({ cycle_id: "cycle-bus-1", now: "2026-07-11T00:00:00Z" }))
    upsertDomainMessage(db, buildDomainMessage({
      cycle_id: "cycle-bus-1",
      job_id: "fast_track_guard",
      status: "published",
      envelope: {
        schema_id: "trade.protocol.domain-inbox-envelope.v1",
        message_id: "msg-bus-1",
        source_domain: "orchestration-ops",
        target_domain: "live-execution-control",
        rail: "command_rail",
        payload_ref: "job:J03",
        idempotency_key: "cycle-bus-1:J03:inbox",
        created_at: "2026-07-11T00:00:01Z",
      },
    }))

    const messages = readDomainMessages(db, { cycle_id: "cycle-bus-1", target_domain: "live-execution-control" })
    assert.equal(messages.length, 1)
    assert.equal(messages[0].message_id, "msg-bus-1")
    assert.equal(messages[0].direction, "inbox")
    assert.equal(messages[0].payload_ref, "job:J03")
    const summary = readCycleSummary(db, "cycle-bus-1") as { messages: Array<{ message_id: string }> }
    assert.deepEqual(summary.messages.map((message) => message.message_id), ["msg-bus-1"])
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
