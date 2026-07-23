import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import test from "node:test"
import { appendPlanEvent, ensureSchema } from "../../../event-store/src/lib/event-store"
import { buildPortfolioAccountProjection, listActiveFlows, reduceFlowState } from "./flow-projector"

test("active flow projection exposes the canonical symbol needed by defensive data owners", () => {
  const db = new Database(":memory:")
  ensureSchema(db)
  try {
    appendPlanEvent(db, {
      event_key: "observe-active-symbol-1",
      chain_id: "flow-active-symbol",
      kind: "observe",
      created_at: "2026-07-23T00:00:00.000Z",
      body_json: {
        symbol: "btcusdt",
        strategy_ref: "strategy://trend/1",
        side: "long",
      },
    })
    assert.deepEqual(listActiveFlows(db).map((flow) => ({
      chain_id: flow.chain_id,
      symbol: flow.symbol,
      position_state: flow.current_position_state,
    })), [{
      chain_id: "flow-active-symbol",
      symbol: "BTCUSDT",
      position_state: "flat",
    }])
  } finally {
    db.close()
  }
})

test("portfolio account projection returns owner-backed zero state for an empty account scope", () => {
  const db = new Database(":memory:")
  ensureSchema(db)
  try {
    const projection = buildPortfolioAccountProjection(db, {
      account_ref: "exchange-account://binance/live/usdm/primary",
      account_scope: "capital-scope://retail-small-usdm",
      symbol: "BTCUSDT",
      as_of: "2026-07-23T00:00:00.000Z",
    })
    assert.equal(projection.completeness, "complete")
    assert.equal(projection.active_risk_flow_count, 0)
    assert.equal(projection.current_gross_notional_usdt, 0)
    assert.match(String(projection.projection_ref), /^flow-read-models:\/\/portfolio-account\//)
  } finally {
    db.close()
  }
})

test("portfolio account projection aggregates scoped risk and fails closed on flow locks", () => {
  const db = new Database(":memory:")
  ensureSchema(db)
  try {
    appendPlanEvent(db, {
      event_key: "observe-portfolio-1",
      chain_id: "flow-portfolio-1",
      kind: "observe",
      created_at: "2026-07-23T00:00:00.000Z",
      body_json: {
        symbol: "BTCUSDT",
        side: "long",
        risk_budget_usdt: 25,
        account: {
          account_ref: "exchange-account://binance/live/usdm/primary",
          account_scope: "capital-scope://retail-small-usdm",
        },
      },
    })
    appendOrderFill(db, "unknown-portfolio-1", {
      sub_kind: "unknown",
      lifecycle_status: "unknown",
      client_order_id: "flow-portfolio-1-entry",
      source: "reconcile",
    }, "flow-portfolio-1")

    const projection = buildPortfolioAccountProjection(db, {
      account_ref: "exchange-account://binance/live/usdm/primary",
      account_scope: "capital-scope://retail-small-usdm",
      symbol: "BTCUSDT",
      as_of: "2026-07-23T00:30:00.000Z",
    })
    assert.equal(projection.completeness, "complete")
    assert.equal(projection.active_plans_risk_sum, 25)
    assert.equal(projection.active_plans_worst_loss_at_stop, -25)
    assert.equal(projection.active_risk_flow_count, 1)
    assert.equal((projection.risk_lock as { locked: boolean }).locked, true)
    assert.equal(projection.reconcile_status, "blocked")
  } finally {
    db.close()
  }
})

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

test("flow reducer derives deltas from cumulative fills and ignores duplicate or stale snapshots", () => {
  const db = new Database(":memory:")
  ensureSchema(db)
  try {
    appendOrderFill(db, "submit-cumulative-0", {
      sub_kind: "submit",
      lifecycle_status: "submitted",
      client_order_id: "flow-cumulative-entry",
      side: "BUY",
      symbol: "BTCUSDT",
      qty: 1,
      source: "reconcile",
    }, "flow-cumulative")
    for (const [eventKey, subKind, cumulative, declaredDelta] of [
      ["fill-04-1", "partial_fill", 0.4, 0.4],
      ["fill-07-2", "partial_fill", 0.7, 0.3],
      ["fill-07-duplicate-3", "partial_fill", 0.7, 0.7],
      ["fill-04-stale-4", "partial_fill", 0.4, 0.4],
      ["fill-10-5", "fill", 1, 0.3],
    ] as const) {
      appendOrderFill(db, eventKey, {
        sub_kind: subKind,
        lifecycle_status: subKind === "fill" ? "reconciled" : "partially_filled",
        client_order_id: "flow-cumulative-entry",
        side: "BUY",
        symbol: "BTCUSDT",
        cumulative_filled_qty: cumulative,
        fill_delta_qty: declaredDelta,
        avg_fill_price: 100,
        source: "reconcile",
      }, "flow-cumulative")
    }

    const state = reduceFlowState(db, "flow-cumulative") as {
      current_orders: unknown[]
      current_position: { net_qty: number; avg_entry_price: number }
    }
    assert.equal(state.current_orders.length, 0)
    assert.equal(state.current_position.net_qty, 1)
    assert.equal(state.current_position.avg_entry_price, 100)
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
