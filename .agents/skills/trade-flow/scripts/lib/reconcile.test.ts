import assert from "node:assert/strict"
import test from "node:test"

import { buildReconcileDrafts } from "./reconcile"

test("buildReconcileDrafts proposes source=reconcile submit for chain-owned open order", () => {
  const result = buildReconcileDrafts({
    chain_id: "flow-reconcile-1",
    created_at: "2026-07-06T12:00:00Z",
    local_events: [],
    local_state: {
      current_orders: [],
      current_position: {
        net_qty: 0,
      },
    },
    account_snapshot: {
      openOrders: {
        regular: [{
          symbol: "BTCUSDT",
          side: "BUY",
          type: "STOP_MARKET",
          status: "NEW",
          origQty: "0.01",
          stopPrice: "66000",
          orderId: "123",
          clientOrderId: "flow-reconcile-1-1-entry",
          positionSide: "BOTH",
          source: "openOrders",
          sourceType: "standard",
        }],
        protective: [],
      },
      positions: [],
    },
  })

  assert.equal(result.can_reconcile, true)
  assert.equal(result.unmatched.length, 0)
  assert.equal(result.drafts.length, 1)
  assert.equal(result.drafts[0].kind, "order_fill")
  assert.equal(result.drafts[0].body_json.source, "reconcile")
  assert.equal(result.drafts[0].body_json.sub_kind, "submit")
  assert.equal(result.drafts[0].body_json.client_order_id, "flow-reconcile-1-1-entry")
  assert.equal(result.drafts[0].body_json.exchange_order_id, "123")
})

test("buildReconcileDrafts refuses to assign foreign orders to current flow", () => {
  const result = buildReconcileDrafts({
    chain_id: "flow-reconcile-2",
    created_at: "2026-07-06T12:00:00Z",
    local_events: [],
    local_state: {
      current_orders: [],
      current_position: {
        net_qty: 0,
      },
    },
    account_snapshot: {
      openOrders: {
        regular: [{
          symbol: "BTCUSDT",
          side: "BUY",
          type: "LIMIT",
          status: "NEW",
          origQty: "0.01",
          price: "65000",
          orderId: "456",
          clientOrderId: "manual-order",
          positionSide: "BOTH",
          source: "openOrders",
          sourceType: "standard",
        }],
        protective: [],
      },
      positions: [{
        symbol: "BTCUSDT",
        positionSide: "BOTH",
        positionAmt: "0.01",
      }],
    },
  })

  assert.equal(result.can_reconcile, false)
  assert.equal(result.drafts.length, 0)
  assert.deepEqual(result.unmatched.map((item) => item.kind), [
    "open_order_unassigned",
    "position_delta_requires_history",
  ])
})

test("buildReconcileDrafts proposes fill from symbol-scoped order history", () => {
  const result = buildReconcileDrafts({
    chain_id: "flow-reconcile-3",
    created_at: "2026-07-06T12:00:00Z",
    local_events: [{
      event_key: "submit-known",
      chain_id: "flow-reconcile-3",
      kind: "order_fill",
      created_at: "2026-07-06T11:59:00Z",
      body_json: {
        sub_kind: "submit",
        client_order_id: "flow-reconcile-3-1-entry",
      },
    }],
    local_state: {
      current_orders: [{
        client_order_id: "flow-reconcile-3-1-entry",
        remaining_qty: 0.01,
      }],
      current_position: {
        net_qty: 0.01,
      },
    },
    account_snapshot: {
      openOrders: {
        regular: [],
        protective: [],
      },
      orderHistory: {
        regular: [{
          symbol: "BTCUSDT",
          side: "BUY",
          type: "LIMIT",
          status: "FILLED",
          origQty: "0.01",
          executedQty: "0.01",
          avgPrice: "65000",
          orderId: "789",
          clientOrderId: "flow-reconcile-3-1-entry",
          positionSide: "BOTH",
          source: "allOrders",
          sourceType: "standard",
        }],
        protective: [],
      },
      positions: [{
        symbol: "BTCUSDT",
        positionSide: "BOTH",
        positionAmt: "0.01",
      }],
    },
  })

  assert.equal(result.can_reconcile, true)
  assert.equal(result.drafts.length, 1)
  assert.equal(result.drafts[0].body_json.sub_kind, "fill")
  assert.equal(result.drafts[0].body_json.filled_qty, 0.01)
  assert.equal(result.drafts[0].body_json.avg_fill_price, 65000)
})
