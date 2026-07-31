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
    const parityStatus = run(parseArgs([
      "--db",
      dbPath,
      "--action",
      "parity_status",
      "--json",
      JSON.stringify({ as_of: "2026-07-11T00:00:00Z" }),
    ])) as { parity_status: { observation_state: string; supervisor_lease: { state: string } } }
    assert.equal(parityStatus.parity_status.observation_state, "no_comparable_evidence")
    assert.equal(parityStatus.parity_status.supervisor_lease.state, "absent")
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

    const incident = run(parseArgs([
      "--db",
      dbPath,
      "--action",
      "record_incident",
      "--json",
      JSON.stringify({
        incident_id: "incident-cli",
        cycle_id: "cycle-cli",
        source: "manual",
        severity: "warning",
        title: "operator note",
        first_seen_at: "2026-07-11T00:00:02Z",
      }),
    ])) as { incident: { incident_id: string; status: string } }
    assert.equal(incident.incident.incident_id, "incident-cli")
    assert.equal(incident.incident.status, "open")

    const updated = run(parseArgs([
      "--db",
      dbPath,
      "--action",
      "update_incident",
      "--json",
      JSON.stringify({
        incident_id: "incident-cli",
        action: "acknowledge",
        actor: "cli-test",
        note: "accepted",
        created_at: "2026-07-11T00:00:03Z",
      }),
    ])) as { incident: { status: string }; events: Array<{ action: string }> }
    assert.equal(updated.incident.status, "acknowledged")
    assert.deepEqual(updated.events.map((event) => event.action), ["acknowledge"])

    const incidents = run(parseArgs([
      "--db",
      dbPath,
      "--action",
      "list_incidents",
      "--json",
      JSON.stringify({ status: "acknowledged" }),
    ])) as { incidents: Array<{ incident_id: string }> }
    assert.deepEqual(incidents.incidents.map((item) => item.incident_id), ["incident-cli"])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
