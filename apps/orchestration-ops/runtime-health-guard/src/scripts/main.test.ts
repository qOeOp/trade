import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { parseArgs, run } from "./main"

test("runtime health CLI writes a health row", () => {
  const dir = mkdtempSync(join(tmpdir(), "runtime-health-cli-"))
  const dbPath = join(dir, "ops.db")
  try {
    const result = run(parseArgs([
      "--db",
      dbPath,
      "--json",
      JSON.stringify({ health_id: "health-cli", now: "2026-07-11T00:00:00Z" }),
    ])) as { status: string; health_ref: string }
    assert.equal(result.status, "ok")
    assert.equal(result.health_ref, "ops_runtime_store:runtime_health/health-cli")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
