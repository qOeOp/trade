import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { ensureOpsRuntimeSchema, upsertCycleRun, buildCycleRun } from "../../../ops-runtime-store/src/lib/ops-runtime-store"
import { buildHealthChecks, runRuntimeHealthGuard } from "./runtime-health-guard"

test("runtime health guard records ok health when required checks pass", () => {
  const opsDb = new Database(":memory:")
  const dir = mkdtempSync(join(tmpdir(), "runtime-health-"))
  const checkedPath = join(dir, "checked.db")
  const checkedDb = new Database(checkedPath)
  try {
    checkedDb.run("CREATE TABLE ready(id TEXT PRIMARY KEY)")
    checkedDb.close()
    ensureOpsRuntimeSchema(opsDb)
    upsertCycleRun(opsDb, buildCycleRun({ cycle_id: "cycle-health", now: "2026-07-11T00:00:00Z" }))

    const result = runRuntimeHealthGuard(opsDb, {
      cycle_id: "cycle-health",
      health_id: "health-ok",
      now: "2026-07-11T00:00:01Z",
      required_env: ["API_KEY"],
      required_paths: [dir],
      sqlite_stores: [{ name: "checked", path: checkedPath, table: "ready" }],
    }, { API_KEY: "present" })

    assert.equal(result.ok, true)
    assert.equal(result.status, "ok")
    assert.equal(result.health_ref, "ops_runtime_store:runtime_health/health-ok")
    const row = opsDb.query("SELECT status FROM runtime_health WHERE health_id='health-ok'").get() as { status: string }
    assert.equal(row.status, "ok")
  } finally {
    opsDb.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("runtime health guard blocks on missing required env and honors safe mode", () => {
  const checks = buildHealthChecks({ required_env: ["MISSING"] }, {})
  assert.equal(checks[0].status, "fail")

  const db = new Database(":memory:")
  try {
    const result = runRuntimeHealthGuard(db, {
      health_id: "health-safe",
      safe_mode: true,
      required_env: ["MISSING"],
    }, {})
    assert.equal(result.status, "safe_mode")
    assert.equal(result.ok, false)
  } finally {
    db.close()
  }
})

test("runtime health guard records projected L2 owner evidence when explicitly required", () => {
  const db = new Database(":memory:")
  try {
    const result = runRuntimeHealthGuard(db, {
      health_id: "health-l2-ready",
      observed_at: "2026-07-22T12:00:00Z",
      require_l2_ready: true,
    }, {}, {
      readL2OwnerHealth: () => l2OwnerHealth({ ready: true }),
    })
    assert.equal(result.status, "ok")
    assert.equal(result.health.checks_json.checks instanceof Array, true)
    const checks = result.health.checks_json.checks as Array<Record<string, unknown>>
    const check = checks[0]
    assert.equal(check.name, "l2_service:owner_health")
    assert.equal(check.status, "ok")
    const evidence = check.evidence as Record<string, unknown>
    assert.equal(evidence.lifecycle_authority, "none")
    assert.equal(Object.hasOwn(evidence, "health_error"), false)
    assert.equal(JSON.stringify(evidence).includes("pid"), false)
    assert.equal(JSON.stringify(evidence).includes("path"), false)

    const row = db.query("SELECT checks_json FROM runtime_health WHERE health_id='health-l2-ready'").get() as { checks_json: string }
    assert.deepEqual(JSON.parse(row.checks_json), result.health.checks_json)
  } finally {
    db.close()
  }
})

test("runtime health guard fails closed when required L2 owner is not ready or unreadable", () => {
  const notReadyDb = new Database(":memory:")
  const unreadableDb = new Database(":memory:")
  try {
    const notReady = runRuntimeHealthGuard(notReadyDb, {
      health_id: "health-l2-not-ready",
      require_l2_ready: true,
    }, {}, {
      readL2OwnerHealth: () => l2OwnerHealth({ ready: false }),
    })
    assert.equal(notReady.status, "blocked")
    const notReadyCheck = (notReady.health.checks_json.checks as Array<Record<string, unknown>>)[0]
    assert.equal(notReadyCheck.detail, "owner reported degraded/overall_ready=false")

    const unreadable = runRuntimeHealthGuard(unreadableDb, {
      health_id: "health-l2-unreadable",
      require_l2_ready: true,
    }, {}, {
      readL2OwnerHealth: () => { throw new Error("/private/runtime/path must not escape") },
    })
    assert.equal(unreadable.status, "blocked")
    const unreadableCheck = (unreadable.health.checks_json.checks as Array<Record<string, unknown>>)[0]
    assert.equal(unreadableCheck.detail, "L2 owner health read failed closed")
    assert.equal(JSON.stringify(unreadable.health.checks_json).includes("/private"), false)
  } finally {
    notReadyDb.close()
    unreadableDb.close()
  }
})

test("runtime health guard does not call L2 owner without explicit boolean opt-in", () => {
  let calls = 0
  let consumerCalls = 0
  const dependencies = {
    readL2OwnerHealth: () => {
      calls += 1
      return l2OwnerHealth({ ready: true })
    },
    readL2WatchConsumer: () => {
      consumerCalls += 1
      return l2WatchConsumer({ ready: true })
    },
  }
  assert.equal(buildHealthChecks({}, {}, dependencies)[0].name, "runtime:default")
  assert.equal(calls, 0)
  assert.equal(consumerCalls, 0)
  const invalid = buildHealthChecks({ require_l2_ready: "true" }, {}, dependencies)
  assert.equal(invalid[0].status, "fail")
  assert.equal(calls, 0)
  const invalidConsumer = buildHealthChecks({ require_l2_watch_consumer_ready: "true" }, {}, dependencies)
  assert.equal(invalidConsumer[0].name, "config:require_l2_watch_consumer_ready")
  assert.equal(invalidConsumer[0].status, "fail")
  assert.equal(consumerCalls, 0)
})

test("runtime health guard records only the safe L2 watch consumer baseline projection", () => {
  const db = new Database(":memory:")
  try {
    const result = runRuntimeHealthGuard(db, {
      health_id: "health-l2-watch-ready",
      observed_at: "2026-07-22T12:00:05Z",
      require_l2_watch_consumer_ready: true,
    }, {}, {
      readL2WatchConsumer: () => l2WatchConsumer({ ready: true }),
    })
    assert.equal(result.status, "ok")
    const check = (result.health.checks_json.checks as Array<Record<string, unknown>>)[0]
    assert.equal(check.name, "l2_watch_consumer:owner_health")
    assert.equal(check.status, "ok")
    const evidence = check.evidence as Record<string, unknown>
    const baseline = evidence.latest_baseline as Record<string, unknown>
    const metrics = evidence.metrics as Record<string, unknown>
    assert.equal(baseline.stream_epoch, "epoch-2")
    assert.equal(baseline.book_hash, "a".repeat(64))
    assert.equal(metrics.worker_start_total, 2)
    assert.equal(metrics.resnapshot_total, 1)
    assert.equal(metrics.observed_event_total, 6447)
    assert.deepEqual(evidence.last_failure, {
      observed_at: "2026-07-22T12:00:02Z",
      operation: "snapshot",
      error_class: "owner_health_unavailable",
      attempt: 2,
    })
    const serialized = JSON.stringify(evidence)
    assert.equal(serialized.includes("pid"), false)
    assert.equal(serialized.includes("path"), false)
    assert.equal(serialized.includes("last_error_class"), false)
    assert.equal(serialized.includes("limitations"), false)

    const row = db.query("SELECT checks_json FROM runtime_health WHERE health_id='health-l2-watch-ready'").get() as { checks_json: string }
    assert.deepEqual(JSON.parse(row.checks_json), result.health.checks_json)
  } finally {
    db.close()
  }
})

test("runtime health guard fails closed on an unready or malformed L2 watch consumer baseline", () => {
  const notReady = buildHealthChecks({ require_l2_watch_consumer_ready: true }, {}, {
    readL2WatchConsumer: () => l2WatchConsumer({ ready: false }),
  })[0]
  assert.equal(notReady.status, "fail")
  assert.equal(notReady.detail, "owner reported degraded/overall_ready=false")

  const malformed = l2WatchConsumer({ ready: true })
  ;(malformed.latest_baseline as Record<string, unknown>).book_hash = "/private/runtime/path"
  const malformedCheck = buildHealthChecks({ require_l2_watch_consumer_ready: true }, {}, {
    readL2WatchConsumer: () => malformed,
  })[0]
  assert.equal(malformedCheck.status, "fail")
  assert.equal(malformedCheck.detail, "L2 watch consumer owner read failed closed")
  assert.equal(JSON.stringify(malformedCheck).includes("/private"), false)

  const invalidFailure = l2WatchConsumer({ ready: true })
  ;(invalidFailure.last_failure as Record<string, unknown>).error_class = "/private/runtime/path"
  const invalidFailureCheck = buildHealthChecks({ require_l2_watch_consumer_ready: true }, {}, {
    readL2WatchConsumer: () => invalidFailure,
  })[0]
  assert.equal(invalidFailureCheck.status, "fail")
  assert.equal(JSON.stringify(invalidFailureCheck).includes("/private"), false)
})

function l2OwnerHealth(input: { ready: boolean }): Record<string, unknown> {
  return {
    schema_version: "trade.l2-service-owner-health.v1",
    observed_at: "2026-07-22T12:00:00Z",
    status: input.ready ? "healthy" : "degraded",
    symbol: "BTCUSDT",
    readiness: {
      supervisor_alive: true,
      service_alive: true,
      control_state_fresh: true,
      control_ready: true,
      source_read_ready: input.ready,
      overall_ready: input.ready,
    },
    control: {
      runtime_status: "running",
      state_age_ms: 1_000,
      state_stale_after_ms: 90_000,
      attempt: 1,
      consecutive_failures: 0,
      disk_status: "healthy",
      admission_status: "ready",
      supervisor_pid: 123,
      runtime_path: "/private/runtime/path",
    },
    source: {
      continuity_status: "live",
      read_ready: input.ready,
      freshness_ms: 12,
      incident_count: 0,
    },
    health_error: "/private/runtime/path",
    lifecycle_authority: "none",
  }
}

function l2WatchConsumer(input: { ready: boolean }): Record<string, unknown> {
  return {
    schema_version: "trade.ops-l2-watch-consumer-owner-read.v1",
    observed_at: "2026-07-22T12:00:04Z",
    status: input.ready ? "healthy" : "degraded",
    readiness: {
      supervisor_alive: true,
      consumer_alive: true,
      runtime_state_fresh: true,
      observation_state_fresh: true,
      baseline_ready: input.ready,
      overall_ready: input.ready,
    },
    control: {
      runtime_status: "running",
      state_age_ms: 125,
      state_stale_after_ms: 15_000,
      attempt: 2,
      restart_total: 1,
      consecutive_failures: 0,
      supervisor_pid: 123,
      runtime_path: "/private/runtime/path",
    },
    latest_baseline: input.ready ? {
      stream_epoch: "epoch-2",
      book_hash: "a".repeat(64),
      snapshot_observed_at: "2026-07-22T12:00:03Z",
      snapshot_freshness_ms: 81,
      last_watch_at: "2026-07-22T12:00:04Z",
      last_watch_event_count: 11,
    } : null,
    metrics: {
      worker_start_total: 2,
      watch_cycle_total: 597,
      snapshot_total: 7,
      resnapshot_total: 1,
      retry_total: 3,
      watch_failure_total: 1,
      snapshot_failure_total: 2,
      reconnect_total: 1,
      resync_signal_total: 0,
      epoch_change_total: 1,
      observed_event_total: 6447,
    },
    last_failure: {
      observed_at: "2026-07-22T12:00:02Z",
      operation: "snapshot",
      error_class: "owner_health_unavailable",
      attempt: 2,
    },
    last_error_class: "/private/runtime/path",
    consumer_authority: "non_economic_observation_only",
    lifecycle_authority: "none",
    writes: [],
    limitations: ["private path must stay local"],
  }
}
