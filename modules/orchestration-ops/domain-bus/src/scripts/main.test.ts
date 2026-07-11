import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { parseArgs, run } from "./main"

test("domain bus CLI publishes and lists messages", () => {
  const dir = mkdtempSync(join(tmpdir(), "domain-bus-"))
  const dbPath = join(dir, "ops.db")
  try {
    const published = run(parseArgs([
      "--db",
      dbPath,
      "--action",
      "publish",
      "--json",
      JSON.stringify({
        direction: "outbox",
        cycle_id: "cycle-bus-cli",
        job_id: "ops_notify_dispatch",
        source_domain: "orchestration-ops",
        rail: "artifact_rail",
        payload_ref: "ops-runtime://cycle/cycle-bus-cli",
        created_at: "2026-07-11T00:00:00Z",
      }),
    ])) as { message: { direction: string } }
    assert.equal(published.message.direction, "outbox")

    const listed = run(parseArgs([
      "--db",
      dbPath,
      "--action",
      "list",
      "--json",
      JSON.stringify({ cycle_id: "cycle-bus-cli" }),
    ])) as { messages: Array<{ payload_ref: string }> }
    assert.deepEqual(listed.messages.map((message) => message.payload_ref), ["ops-runtime://cycle/cycle-bus-cli"])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
