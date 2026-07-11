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
    const recorded = run(parseArgs([
      "--db",
      dbPath,
      "--action",
      "record_message",
      "--json",
      JSON.stringify({
        envelope: {
          schema_id: "trade.protocol.domain-outbox-envelope.v1",
          message_id: "msg-cli",
          source_domain: "orchestration-ops",
          rail: "fact_rail",
          payload_ref: "ops-runtime://cycle/cycle-cli/job/J01",
          created_at: "2026-07-11T00:00:01Z",
        },
      }),
    ])) as { message: { message_id: string; direction: string } }
    assert.equal(recorded.message.message_id, "msg-cli")
    assert.equal(recorded.message.direction, "outbox")
    const listed = run(parseArgs([
      "--db",
      dbPath,
      "--action",
      "list_messages",
      "--json",
      JSON.stringify({ status: "published" }),
    ])) as { messages: Array<{ message_id: string }> }
    assert.deepEqual(listed.messages.map((message) => message.message_id), ["msg-cli"])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
