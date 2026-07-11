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
