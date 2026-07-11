import { readFileSync } from "node:fs"
import assert from "node:assert/strict"
import test from "node:test"
import { buildReconcileDrafts } from "../../../../../live-execution-control/reconcile-drafts/src/lib/reconcile-drafts"

type JSONRecord = Record<string, unknown>

test("reconcile result schema matches stable outer result contract", () => {
  const schema = readSchema()
  assert.equal(schema.$id, "trade-flow.reconcile-result.v1")
  assert.deepEqual(asArray(schema.required), ["chain_id", "compared_at", "can_reconcile", "drafts", "unmatched"])
  assert.equal(asRecord(asRecord(asRecord(schema.properties).drafts).items).$ref, "plan-event.schema.json")
  assert.equal(asRecord(schema).additionalProperties, false)

  const result = buildReconcileDrafts({
    chain_id: "flow-reconcile-schema-1",
    created_at: "2026-07-08T12:00:00Z",
    local_events: [],
    local_state: {
      current_orders: [],
      current_position: {
        net_qty: 0,
      },
    },
    account_snapshot: {
      openOrders: {
        regular: [],
        protective: [],
      },
      positions: [],
    },
  }) as unknown as JSONRecord

  for (const field of asArray(schema.required)) {
    assert.ok(String(field) in result, `missing required field ${String(field)}`)
  }
  assert.equal(result.chain_id, "flow-reconcile-schema-1")
  assert.equal(result.compared_at, "2026-07-08T12:00:00Z")
  assert.equal(typeof result.can_reconcile, "boolean")
  assert.equal(Array.isArray(result.drafts), true)
  assert.equal(Array.isArray(result.unmatched), true)
})

function readSchema(): JSONRecord {
  return JSON.parse(readFileSync(new URL("../../schemas/reconcile-result.schema.json", import.meta.url), "utf8")) as JSONRecord
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}
