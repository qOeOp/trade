import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import test from "node:test"

import {
  appendPlanEvent,
  buildOrderFillEvent,
  ensureSchema,
  readFlowEvents,
  readLatestOrderFill,
  validatePlanEvent,
} from "./event-store"

test("event store creates schema and reads ordered flow events", () => {
  const db = new Database(":memory:")
  try {
    ensureSchema(db)
    appendPlanEvent(db, {
      event_key: "obs-1",
      chain_id: "flow-1",
      kind: "observe",
      created_at: "2026-07-11T00:00:00Z",
      body_json: {
        symbol: "BTCUSDT",
        action_intent: { target_action: "no_action" },
      },
    })
    appendPlanEvent(db, buildOrderFillEvent({
      event_key: "fill-1",
      chain_id: "flow-1",
      created_at: "2026-07-11T00:01:00Z",
      body: {
        source: "reconcile",
        sub_kind: "fill",
        client_order_id: "client-1",
      },
    }))

    const events = readFlowEvents(db, "flow-1")
    assert.deepEqual(events.map((event) => event.event_key), ["obs-1", "fill-1"])
    assert.equal(readLatestOrderFill(db, "flow-1")?.event_key, "fill-1")
  } finally {
    db.close()
  }
})

test("event store validates trade-flow order fill audit fields", () => {
  assert.throws(
    () => validatePlanEvent({
      event_key: "fill-bad",
      chain_id: "flow-1",
      kind: "order_fill",
      created_at: "2026-07-11T00:00:00Z",
      body_json: {
        source: "trade_flow",
      },
    }),
    /source_observe_event_key/,
  )
})
