import assert from "node:assert/strict"
import test from "node:test"
import { Database } from "bun:sqlite"
import { ensureOpsRuntimeSchema, readIncidents } from "../../../ops-runtime-store/src/lib/ops-runtime-store"
import { listDomainMessages, publishDomainMessage } from "./domain-bus"

test("domain bus publishes protocol envelopes into ops runtime store", () => {
  const db = new Database(":memory:")
  try {
    ensureOpsRuntimeSchema(db)
    const message = publishDomainMessage(db, {
      direction: "inbox",
      cycle_id: "cycle-bus-lib",
      job_id: "fast_track_guard",
      source_domain: "orchestration-ops",
      target_domain: "live-execution-control",
      rail: "command_rail",
      interaction: "command",
      payload_ref: "job:J03",
      idempotency_key: "cycle-bus-lib:J03",
      created_at: "2026-07-11T00:00:00Z",
    })

    assert.equal(message.message_id, "cycle-bus-lib:fast_track_guard:inbox:cycle-bus-lib:J03")
    assert.equal(message.direction, "inbox")
    assert.equal(message.status, "published")
    assert.equal((message.envelope_json as Record<string, unknown>).schema_id, "trade.protocol.domain-inbox-envelope.v1")
    assert.equal((message.envelope_json as Record<string, unknown>).interaction, "command")
    const messages = listDomainMessages(db, { cycle_id: "cycle-bus-lib" })
    assert.equal(messages.length, 1)
    assert.equal(messages[0].payload_ref, "job:J03")
  } finally {
    db.close()
  }
})

test("domain bus rejects rail routes outside protocol ownership registry", () => {
  const db = new Database(":memory:")
  try {
    ensureOpsRuntimeSchema(db)
    assert.throws(() => publishDomainMessage(db, {
      direction: "inbox",
      cycle_id: "cycle-bus-reject",
      job_id: "bad-command",
      source_domain: "research-strategy-development",
      target_domain: "live-execution-control",
      rail: "command_rail",
      interaction: "command",
      payload_ref: "job:J99",
      idempotency_key: "cycle-bus-reject:J99",
      created_at: "2026-07-11T00:00:00Z",
    }), /cannot publish command_rail/)
    const incidents = readIncidents(db, { cycle_id: "cycle-bus-reject" })
    assert.equal(incidents.length, 1)
    assert.equal(incidents[0].source, "domain_bus")
    assert.equal(incidents[0].severity, "critical")
    assert.match(String(incidents[0].detail_json?.error), /cannot publish command_rail/)
  } finally {
    db.close()
  }
})
