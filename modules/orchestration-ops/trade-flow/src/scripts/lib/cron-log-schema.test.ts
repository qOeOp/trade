import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import assert from "node:assert/strict"
import test from "node:test"
import { appendCronLog, CRON_LOG_STATUSES, CRON_LOG_TRACKS } from "./cron-runtime"
import { resolveRepoPath } from "../../../../../contracts/runtime-core/src/paths"

type JSONRecord = Record<string, unknown>

test("cron log entry schema matches append-only audit log shape", () => {
  const schema = readSchema()
  assert.equal(schema.$id, "trade-flow.cron-log-entry.v1")
  assert.deepEqual(asArray(schema.required), [
    "run_id",
    "track",
    "triggered_at",
    "duration_ms",
    "status",
    "chains_processed",
    "actions_taken",
    "errors",
  ])
  assert.deepEqual(asArray(asRecord(asRecord(schema.properties).track).enum), [...CRON_LOG_TRACKS])
  assert.deepEqual(asArray(asRecord(asRecord(schema.properties).status).enum), [...CRON_LOG_STATUSES])
  assert.equal(asRecord(schema).additionalProperties, false)

  const dir = mkdtempSync(join(tmpdir(), "cron-log-schema-"))
  try {
    const logPath = appendCronLog(dir, {
      run_id: "run-cron-schema-1",
      track: "slow",
      triggered_at: "2026-07-08T12:00:00Z",
      duration_ms: 12,
      status: "completed",
      chains_processed: 2,
      actions_taken: ["place_entry"],
      errors: [],
      next_cron_at: "2026-07-08T16:00:00Z",
    })
    const entry = JSON.parse(readFileSync(resolveRepoPath(logPath), "utf8").trim()) as JSONRecord
    for (const field of asArray(schema.required)) {
      assert.ok(String(field) in entry, `missing required field ${String(field)}`)
    }
    assert.equal(entry.track, "slow")
    assert.equal(entry.status, "completed")
    assert.equal(entry.duration_ms, 12)
    assert.equal(entry.chains_processed, 2)
    assert.deepEqual(entry.actions_taken, ["place_entry"])
    assert.deepEqual(entry.errors, [])
    assert.equal(entry.next_cron_at, "2026-07-08T16:00:00Z")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

function readSchema(): JSONRecord {
  return JSON.parse(readFileSync(new URL("../../schemas/cron-log-entry.schema.json", import.meta.url), "utf8")) as JSONRecord
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}
