import assert from "node:assert/strict"
import test from "node:test"

import { buildReconcileDrafts } from "./reconcile-drafts"

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
        net_qty: 0,
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
  assert.equal(result.drafts[0].body_json.lifecycle_status, "reconciled")
  assert.equal(result.drafts[0].body_json.filled_qty, 0.01)
  assert.equal(result.drafts[0].body_json.avg_fill_price, 65000)
})

test("buildReconcileDrafts proposes partial fill from history when local fill is missing", () => {
  const result = buildReconcileDrafts({
    chain_id: "flow-reconcile-4",
    created_at: "2026-07-06T12:00:00Z",
    local_events: [{
      event_key: "submit-known",
      chain_id: "flow-reconcile-4",
      kind: "order_fill",
      created_at: "2026-07-06T11:59:00Z",
      body_json: {
        sub_kind: "submit",
        client_order_id: "flow-reconcile-4-1-entry",
      },
    }],
    local_state: {
      current_orders: [{
        client_order_id: "flow-reconcile-4-1-entry",
        remaining_qty: 0.01,
      }],
      current_position: {
        net_qty: 0,
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
          status: "PARTIALLY_FILLED",
          origQty: "0.01",
          executedQty: "0.004",
          cumQuote: "260",
          orderId: "790",
          clientOrderId: "flow-reconcile-4-1-entry",
          positionSide: "BOTH",
          source: "allOrders",
          sourceType: "standard",
        }],
        protective: [],
      },
      positions: [{
        symbol: "BTCUSDT",
        positionSide: "BOTH",
        positionAmt: "0.004",
      }],
    },
  })

  assert.equal(result.can_reconcile, true)
  assert.equal(result.unmatched.length, 0)
  assert.equal(result.drafts.length, 1)
  assert.equal(result.drafts[0].body_json.sub_kind, "partial_fill")
  assert.equal(result.drafts[0].body_json.lifecycle_status, "partially_filled")
  assert.equal(result.drafts[0].body_json.filled_qty, 0.004)
  assert.equal(result.drafts[0].body_json.avg_fill_price, 65000)
})

test("buildReconcileDrafts classifies protective order drift without submit draft", () => {
  const result = buildReconcileDrafts({
    chain_id: "flow-reconcile-5",
    created_at: "2026-07-06T12:00:00Z",
    local_events: [],
    local_state: {
      current_orders: [],
      current_position: {
        net_qty: 0.01,
      },
    },
    account_snapshot: {
      openOrders: {
        regular: [],
        protective: [{
          symbol: "BTCUSDT",
          side: "SELL",
          type: "STOP_MARKET",
          status: "NEW",
          origQty: "0.01",
          stopPrice: "64000",
          algoId: "9001",
          clientAlgoId: "flow-reconcile-5-protect-stop",
          positionSide: "BOTH",
          source: "openAlgoOrders",
          sourceType: "protective",
        }],
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
  assert.deepEqual(result.unmatched.map((item) => item.kind), ["protective_drift"])
  assert.equal(result.unmatched[0].client_order_id, "flow-reconcile-5-protect-stop")
})

test("buildReconcileDrafts converts cumulative partial fills into monotonic deltas", () => {
  const chainId = "flow-reconcile-delta"
  const orderId = `${chainId}-entry`
  const baseEvent = {
    event_key: "partial-04",
    chain_id: chainId,
    kind: "order_fill",
    created_at: "2026-07-06T11:00:00Z",
    body_json: {
      sub_kind: "partial_fill",
      client_order_id: orderId,
      side: "BUY",
      cumulative_filled_qty: 0.4,
      fill_delta_qty: 0.4,
    },
  }
  const at07 = buildReconcileDrafts(reconcileFixture(chainId, orderId, [baseEvent], 0.4, 0.7, "PARTIALLY_FILLED"))
  assert.equal(at07.can_reconcile, true)
  assert.equal(at07.drafts[0].body_json.cumulative_filled_qty, 0.7)
  assert.ok(Math.abs(Number(at07.drafts[0].body_json.fill_delta_qty) - 0.3) < 1e-12)

  const eventsAt07 = [...reconcileFixture(chainId, orderId, [baseEvent], 0.4, 0.7, "PARTIALLY_FILLED").local_events, at07.drafts[0]]
  const at10 = buildReconcileDrafts(reconcileFixture(chainId, orderId, eventsAt07, 0.7, 1, "FILLED"))
  assert.equal(at10.can_reconcile, true)
  assert.equal(at10.drafts[0].body_json.cumulative_filled_qty, 1)
  assert.ok(Math.abs(Number(at10.drafts[0].body_json.fill_delta_qty) - 0.3) < 1e-12)

  const completedEvents = [...eventsAt07, at10.drafts[0]]
  const duplicate = buildReconcileDrafts(reconcileFixture(chainId, orderId, completedEvents, 1, 1, "FILLED"))
  assert.equal(duplicate.can_reconcile, true)
  assert.equal(duplicate.drafts.length, 0)

  const stale = buildReconcileDrafts(reconcileFixture(chainId, orderId, completedEvents, 1, 0.7, "PARTIALLY_FILLED"))
  assert.equal(stale.drafts.length, 0)
  assert.equal(stale.can_reconcile, false)
})

function reconcileFixture(
  chainId: string,
  clientOrderId: string,
  localEvents: Array<{ event_key: string; chain_id: string; kind: string; created_at: string; body_json: Record<string, unknown> }>,
  localQty: number,
  exchangeQty: number,
  status: string,
) {
  return {
    chain_id: chainId,
    created_at: "2026-07-06T12:00:00Z",
    local_events: localEvents,
    local_state: {
      current_orders: status === "FILLED" ? [] : [{ client_order_id: clientOrderId, remaining_qty: Math.max(1 - localQty, 0) }],
      current_position: { net_qty: localQty },
    },
    account_snapshot: {
      openOrders: { regular: [], protective: [] },
      orderHistory: {
        regular: [{
          symbol: "BTCUSDT",
          side: "BUY",
          type: "LIMIT",
          status,
          origQty: "1",
          executedQty: String(exchangeQty),
          avgPrice: "100",
          orderId: "delta-order",
          clientOrderId,
          positionSide: "BOTH",
          source: "allOrders",
          sourceType: "standard",
          updateTime: 1783310400000,
        }],
        protective: [],
      },
      positions: [{ symbol: "BTCUSDT", positionSide: "BOTH", positionAmt: String(exchangeQty) }],
    },
  }
}
