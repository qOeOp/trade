import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import test from "node:test"
import { appendPlanEvent, ensureSchema } from "../../../event-store/src/lib/event-store"
import { reduceFlowState } from "./flow-projector"

test("flow reducer treats rejected expired and cancelled as order-closing non-position states", () => {
  const db = new Database(":memory:")
  ensureSchema(db)
  try {
    appendOrderFill(db, "submit-1", {
      sub_kind: "submit",
      lifecycle_status: "submitted",
      client_order_id: "flow-lifecycle-1-entry",
      side: "BUY",
      symbol: "BTCUSDT",
      position_side: "BOTH",
      order_type: "LIMIT",
      qty: 1,
      price: 65000,
      source: "reconcile",
    })
    appendOrderFill(db, "reject-1", {
      sub_kind: "reject",
      lifecycle_status: "rejected",
      client_order_id: "flow-lifecycle-1-entry",
      source: "reconcile",
    })

    const state = reduceFlowState(db, "flow-lifecycle") as {
      current_orders: unknown[]
      current_position: { state: string; net_qty: number }
    }
    assert.equal(state.current_orders.length, 0)
    assert.equal(state.current_position.state, "flat")
    assert.equal(state.current_position.net_qty, 0)
  } finally {
    db.close()
  }
})

test("flow reducer exposes risk lock for unknown or needs_review lifecycle states", () => {
  const db = new Database(":memory:")
  ensureSchema(db)
  try {
    appendOrderFill(db, "unknown-1", {
      sub_kind: "unknown",
      lifecycle_status: "unknown",
      client_order_id: "flow-risk-lock-1-entry",
      source: "reconcile",
    }, "flow-risk-lock")

    const state = reduceFlowState(db, "flow-risk-lock") as {
      risk_lock: { locked: boolean; reason: string; client_order_id: string }
    }
    assert.equal(state.risk_lock.locked, true)
    assert.equal(state.risk_lock.reason, "unknown_order_state")
    assert.equal(state.risk_lock.client_order_id, "flow-risk-lock-1-entry")
  } finally {
    db.close()
  }
})

test("flow reducer exposes risk lock from recovery review events", () => {
  const db = new Database(":memory:")
  ensureSchema(db)
  try {
    appendPlanEvent(db, {
      event_key: "review-needs-review-1",
      chain_id: "flow-review-lock",
      kind: "review",
      created_at: "2026-07-06T12:00:00Z",
      body_json: {
        status: "needs_review",
        lifecycle_status: "needs_review",
        reason: "unmatched_reconcile",
      },
    })

    const state = reduceFlowState(db, "flow-review-lock") as {
      risk_lock: { locked: boolean; reason: string; review_reason: string }
    }
    assert.equal(state.risk_lock.locked, true)
    assert.equal(state.risk_lock.reason, "needs_review")
    assert.equal(state.risk_lock.review_reason, "unmatched_reconcile")
  } finally {
    db.close()
  }
})

test("flow reducer lets lifecycle filled and reconciled change position only on actual fill facts", () => {
  const db = new Database(":memory:")
  ensureSchema(db)
  try {
    appendOrderFill(db, "submit-1", {
      lifecycle_status: "submitted",
      client_order_id: "flow-fill-status-1-entry",
      side: "BUY",
      symbol: "BTCUSDT",
      position_side: "BOTH",
      order_type: "LIMIT",
      qty: 1,
      price: 65000,
      source: "reconcile",
    }, "flow-fill-status")
    appendOrderFill(db, "fill-1", {
      lifecycle_status: "reconciled",
      client_order_id: "flow-fill-status-1-entry",
      side: "BUY",
      symbol: "BTCUSDT",
      position_side: "BOTH",
      filled_qty: 1,
      avg_fill_price: 65100,
      source: "reconcile",
    }, "flow-fill-status")

    const state = reduceFlowState(db, "flow-fill-status") as {
      current_orders: unknown[]
      current_position: { state: string; net_qty: number; avg_entry_price: number }
    }
    assert.equal(state.current_orders.length, 0)
    assert.equal(state.current_position.state, "long")
    assert.equal(state.current_position.net_qty, 1)
    assert.equal(state.current_position.avg_entry_price, 65100)
  } finally {
    db.close()
  }
})

function appendOrderFill(
  db: Database,
  eventKey: string,
  body: Record<string, unknown>,
  chainId = "flow-lifecycle",
): void {
  appendPlanEvent(db, {
    event_key: eventKey,
    chain_id: chainId,
    kind: "order_fill",
    created_at: `2026-07-06T12:00:${eventKey.slice(-1).padStart(2, "0")}Z`,
    body_json: body,
  })
}
