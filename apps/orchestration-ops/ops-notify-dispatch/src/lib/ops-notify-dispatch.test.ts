import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import test from "node:test"
import { buildCycleRun, ensureOpsRuntimeSchema, upsertCycleRun } from "../../../ops-runtime-store/src/lib/ops-runtime-store"
import { resolveChannels, runOpsNotifyDispatch } from "./ops-notify-dispatch"

test("ops notify dispatch records dry-run attempts without sending", async () => {
  const db = new Database(":memory:")
  ensureOpsRuntimeSchema(db)
  upsertCycleRun(db, buildCycleRun({ cycle_id: "cycle-notify", now: "2026-07-11T00:00:00Z" }))
  try {
    let sent = false
    const result = await runOpsNotifyDispatch(db, {
      cycle_id: "cycle-notify",
      now: "2026-07-11T00:00:01Z",
      dry_run: true,
      channels: ["stdout"],
      payload: { message: "blocked job" },
    }, async () => {
      sent = true
      return { delivered: true }
    })
    assert.equal(sent, false)
    assert.equal(result.ok, true)
    assert.equal(result.attempts[0].status, "skipped")
    assert.equal(result.refs[0].startsWith("ops_runtime_store:notify_attempt/"), true)
    const row = db.query("SELECT COUNT(*) AS count FROM notify_attempt").get() as { count: number }
    assert.equal(row.count, 1)
  } finally {
    db.close()
  }
})

test("ops notify dispatch records sent and failed channel attempts", async () => {
  const db = new Database(":memory:")
  ensureOpsRuntimeSchema(db)
  try {
    const result = await runOpsNotifyDispatch(db, {
      now: "2026-07-11T00:00:01Z",
      channels: ["stdout", "failing"],
      payload: { message: "cycle summary" },
    }, async (attempt) => {
      if (attempt.channel === "failing") {
        throw new Error("boom")
      }
      return { delivered: true }
    })
    assert.equal(result.ok, false)
    assert.deepEqual(result.attempts.map((attempt) => attempt.status), ["sent", "failed"])
  } finally {
    db.close()
  }
})

test("ops notify dispatch disables empty default notification", () => {
  assert.deepEqual(resolveChannels({}), [{ channel: "stdout", enabled: false }])
})
