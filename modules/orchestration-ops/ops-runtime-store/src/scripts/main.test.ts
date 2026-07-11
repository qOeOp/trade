import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { parseArgs, run } from "./main"

test("ops runtime store CLI initializes and returns cycle summary", () => {
  const dir = mkdtempSync(join(tmpdir(), "ops-runtime-store-"))
  const dbPath = join(dir, "ops.db")
  try {
    const init = run(parseArgs(["--db", dbPath, "--action", "init"]))
    assert.equal(init.ok, true)
    run(parseArgs([
      "--db",
      dbPath,
      "--action",
      "record_cycle",
      "--json",
      JSON.stringify({ cycle_id: "cycle-cli", now: "2026-07-11T00:00:00Z" }),
    ]))
    const summary = run(parseArgs([
      "--db",
      dbPath,
      "--action",
      "summary",
      "--json",
      JSON.stringify({ cycle_id: "cycle-cli" }),
    ])) as { summary: { cycle: { cycle_id: string } } }
    assert.equal(summary.summary.cycle.cycle_id, "cycle-cli")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

