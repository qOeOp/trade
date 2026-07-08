import { readFileSync } from "node:fs"
import assert from "node:assert/strict"
import test from "node:test"
import { PLAN_EVENT_KINDS, validatePlanEvent } from "./plan-events"

type JSONRecord = Record<string, unknown>

test("plan_event schema matches validator-owned outer contract", () => {
  const schema = readSchema()
  assert.equal(schema.$id, "trade-flow.plan-event.v1")
  assert.deepEqual(asArray(schema.required), ["event_key", "chain_id", "kind", "body_json", "created_at"])
  assert.deepEqual(asArray(asRecord(asRecord(schema.properties).kind).enum), [...PLAN_EVENT_KINDS])
  assert.equal(asRecord(schema).additionalProperties, false)

  validatePlanEvent({
    event_key: "evt-schema-1",
    chain_id: "flow-schema-1",
    kind: "observe",
    body_json: {},
    created_at: "2026-07-08T12:00:00Z",
  })
  assert.throws(
    () => validatePlanEvent({
      event_key: "evt-schema-2",
      chain_id: "flow-schema-1",
      kind: "observe",
      body_json: {},
      created_at: "",
    }),
    /created_at is required/,
  )
})

function readSchema(): JSONRecord {
  return JSON.parse(readFileSync(new URL("../../schemas/plan-event.schema.json", import.meta.url), "utf8")) as JSONRecord
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}
