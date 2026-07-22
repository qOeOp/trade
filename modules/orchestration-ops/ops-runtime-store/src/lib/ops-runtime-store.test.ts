import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import test from "node:test"
import {
  buildCycleRun,
  buildDomainMessage,
  buildIncident,
  buildJobRun,
  ensureOpsRuntimeSchema,
  readCycleSummary,
  readDomainMessages,
  readIncidentEvents,
  readIncidents,
  readLatestRuntimeHealth,
  recordIncident,
  recordNotifyAttempt,
  recordRuntimeHealth,
  updateIncidentStatus,
  upsertCycleRun,
  upsertDomainMessage,
  upsertJobRun,
  upsertOpsLock,
  acquireOpsLock,
  readOpsLock,
  readRuntimeParityObservations,
  recordRuntimeParityObservation,
  renewOpsLock,
  releaseOpsLock,
} from "./ops-runtime-store"

test("ops runtime store keeps an immutable Agent/program parity ledger", () => {
  const db = new Database(":memory:")
  ensureOpsRuntimeSchema(db)
  try {
    upsertCycleRun(db, buildCycleRun({ cycle_id: "program-cycle", now: "2026-07-23T08:00:00Z", status: "completed" }))
    upsertCycleRun(db, buildCycleRun({ cycle_id: "agent-cycle", now: "2026-07-23T08:00:00Z", status: "completed" }))
    const observation = {
      observation_id: "parity:program-cycle",
      program_cycle_id: "program-cycle",
      agent_cycle_id: "agent-cycle",
      program_projection_hash: "same-hash",
      agent_projection_hash: "same-hash",
      status: "match" as const,
      detail_json: { program: { projection_hash: "same-hash" }, agent: { projection_hash: "same-hash" } },
      observed_at: "2026-07-23T08:00:01Z",
    }

    assert.deepEqual(recordRuntimeParityObservation(db, observation), observation)
    assert.deepEqual(recordRuntimeParityObservation(db, observation), observation)
    assert.deepEqual(readRuntimeParityObservations(db, { status: "match" }), [observation])
    assert.throws(
      () => recordRuntimeParityObservation(db, { ...observation, agent_cycle_id: "changed-agent-cycle" }),
      /runtime parity observation is immutable/,
    )
  } finally {
    db.close()
  }
})

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

test("ops runtime store records incidents and exposes them in cycle summary", () => {
  const db = new Database(":memory:")
  ensureOpsRuntimeSchema(db)
  try {
    upsertCycleRun(db, buildCycleRun({ cycle_id: "cycle-incident-1", now: "2026-07-11T00:00:00Z" }))
    recordIncident(db, buildIncident({
      incident_id: "incident-job-blocked",
      cycle_id: "cycle-incident-1",
      source: "job_run",
      severity: "critical",
      title: "fast guard blocked",
      refs: ["ops-runtime://cycle/cycle-incident-1/job/J02"],
      detail: { job_id: "fast_track_guard", reason: "safe_mode" },
      first_seen_at: "2026-07-11T00:00:01Z",
    }))

    const incidents = readIncidents(db, { cycle_id: "cycle-incident-1" })
    assert.equal(incidents.length, 1)
    assert.equal(incidents[0].incident_id, "incident-job-blocked")
    assert.equal(incidents[0].severity, "critical")
    assert.deepEqual(incidents[0].refs_json, ["ops-runtime://cycle/cycle-incident-1/job/J02"])

    const summary = readCycleSummary(db, "cycle-incident-1") as {
      incidents: Array<{ incident_id: string }>
      ops_summary: { incidents: { open: number; critical: number }; attention: { needs_human: boolean; reasons: string[] } }
    }
    assert.equal(summary.incidents.length, 1)
    assert.equal(summary.ops_summary.incidents.open, 1)
    assert.equal(summary.ops_summary.incidents.critical, 1)
    assert.equal(summary.ops_summary.attention.needs_human, true)
    assert.equal(summary.ops_summary.attention.reasons.includes("incident:incident-job-blocked"), true)
  } finally {
    db.close()
  }
})

test("ops runtime store tracks incident lifecycle events", () => {
  const db = new Database(":memory:")
  ensureOpsRuntimeSchema(db)
  try {
    upsertCycleRun(db, buildCycleRun({ cycle_id: "cycle-incident-2", now: "2026-07-11T00:00:00Z" }))
    recordIncident(db, buildIncident({
      incident_id: "incident-lifecycle",
      cycle_id: "cycle-incident-2",
      source: "domain_bus",
      severity: "critical",
      title: "rail rejected",
      first_seen_at: "2026-07-11T00:00:01Z",
    }))

    const acknowledged = updateIncidentStatus(db, {
      incident_id: "incident-lifecycle",
      action: "acknowledge",
      actor: "operator",
      note: "triaged",
      created_at: "2026-07-11T00:01:00Z",
    })
    assert.equal(acknowledged.status, "acknowledged")

    const resolved = updateIncidentStatus(db, {
      incident_id: "incident-lifecycle",
      action: "resolve",
      actor: "operator",
      note: "fixed registry",
      created_at: "2026-07-11T00:02:00Z",
    })
    assert.equal(resolved.status, "resolved")

    const events = readIncidentEvents(db, { incident_id: "incident-lifecycle" })
    assert.deepEqual(events.map((event) => event.action), ["acknowledge", "resolve"])
    assert.equal(events[0].status_after, "acknowledged")
    assert.equal(events[1].status_after, "resolved")

    const summary = readCycleSummary(db, "cycle-incident-2") as {
      ops_summary: { incidents: { open: number; acknowledged: number; active: number }; attention: { needs_human: boolean; active_incidents: unknown[] } }
    }
    assert.equal(summary.ops_summary.incidents.open, 0)
    assert.equal(summary.ops_summary.incidents.acknowledged, 0)
    assert.equal(summary.ops_summary.incidents.active, 0)
    assert.equal(summary.ops_summary.attention.needs_human, false)
    assert.equal(summary.ops_summary.attention.active_incidents.length, 0)
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

test("ops runtime store acquires, rejects, expires, and releases named locks atomically", () => {
  const db = new Database(":memory:")
  try {
    ensureOpsRuntimeSchema(db)
    const first = acquireOpsLock(db, {
      lock_key: "research-rd",
      holder_id: "cycle-1",
      acquired_at: "2026-07-22T00:00:00.000Z",
      expires_at: "2026-07-22T01:00:00.000Z",
    })
    assert.equal(first.acquired, true)
    assert.equal(first.recovered_stale, false)
    assert.equal(first.lock.fencing_token, 1)
    assert.throws(() => upsertOpsLock(db, {
      lock_key: "research-rd",
      holder_id: "unsafe-overwrite",
      acquired_at: "2026-07-22T00:15:00.000Z",
      expires_at: "2026-07-22T01:15:00.000Z",
    }), /held by another active owner/)
    const blocked = acquireOpsLock(db, {
      lock_key: "research-rd",
      holder_id: "cycle-2",
      acquired_at: "2026-07-22T00:30:00.000Z",
      expires_at: "2026-07-22T01:30:00.000Z",
    })
    assert.equal(blocked.acquired, false)
    assert.equal(blocked.recovered_stale, false)
    assert.equal(blocked.lock.holder_id, "cycle-1")
    assert.equal(blocked.lock.fencing_token, 1)
    const renewed = renewOpsLock(db, {
      lock_key: "research-rd",
      holder_id: "cycle-1",
      fencing_token: 1,
      renewed_at: "2026-07-22T00:45:00.000Z",
      expires_at: "2026-07-22T01:45:00.000Z",
    })
    assert.equal(renewed.renewed, true)
    assert.equal(renewed.lock?.expires_at, "2026-07-22T01:45:00.000Z")
    const staleRenewal = renewOpsLock(db, {
      lock_key: "research-rd",
      holder_id: "cycle-1",
      fencing_token: 1,
      renewed_at: "2026-07-22T02:00:00.000Z",
      expires_at: "2026-07-22T03:00:00.000Z",
    })
    assert.equal(staleRenewal.renewed, false)
    const replaced = acquireOpsLock(db, {
      lock_key: "research-rd",
      holder_id: "cycle-2",
      acquired_at: "2026-07-22T02:00:00.000Z",
      expires_at: "2026-07-22T03:00:00.000Z",
    })
    assert.equal(replaced.acquired, true)
    assert.equal(replaced.recovered_stale, true)
    assert.equal(replaced.lock.fencing_token, 2)
    assert.equal(readOpsLock(db, "research-rd")?.holder_id, "cycle-2")
    assert.equal(releaseOpsLock(db, "research-rd", "cycle-2", 1), false)
    assert.equal(releaseOpsLock(db, "research-rd", "cycle-1"), false)
    assert.equal(releaseOpsLock(db, "research-rd", "cycle-2"), true)
    assert.equal(readOpsLock(db, "research-rd"), null)
    const nextOwner = acquireOpsLock(db, {
      lock_key: "research-rd",
      holder_id: "cycle-3",
      acquired_at: "2026-07-22T03:00:00.000Z",
      expires_at: "2026-07-22T04:00:00.000Z",
    })
    assert.equal(nextOwner.acquired, true)
    assert.equal(nextOwner.recovered_stale, false)
    assert.equal(nextOwner.lock.fencing_token, 3)
  } finally {
    db.close()
  }
})

test("ops runtime store migrates legacy locks to the first fencing generation", () => {
  const db = new Database(":memory:")
  try {
    db.run(`
      CREATE TABLE ops_lock (
        lock_key TEXT PRIMARY KEY,
        holder_id TEXT NOT NULL,
        acquired_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      )
    `)
    db.query(`
      INSERT INTO ops_lock(lock_key, holder_id, acquired_at, expires_at)
      VALUES (?, ?, ?, ?)
    `).run("legacy-lock", "legacy-owner", "2026-07-23T00:00:00Z", "2026-07-23T01:00:00Z")

    ensureOpsRuntimeSchema(db)

    assert.equal(readOpsLock(db, "legacy-lock")?.fencing_token, 1)
    assert.equal(renewOpsLock(db, {
      lock_key: "legacy-lock",
      holder_id: "legacy-owner",
      fencing_token: 1,
      renewed_at: "2026-07-23T00:30:00Z",
      expires_at: "2026-07-23T01:30:00Z",
    }).renewed, true)
    assert.equal(releaseOpsLock(db, "legacy-lock", "legacy-owner", 1), true)
    assert.equal(acquireOpsLock(db, {
      lock_key: "legacy-lock",
      holder_id: "new-owner",
      acquired_at: "2026-07-23T02:00:00Z",
      expires_at: "2026-07-23T03:00:00Z",
    }).lock.fencing_token, 2)
  } finally {
    db.close()
  }
})
