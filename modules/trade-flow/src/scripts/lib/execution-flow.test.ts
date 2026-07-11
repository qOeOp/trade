import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import test from "node:test"
import {
  buildExecutionCommandSpec,
  buildOrderCancelCommand,
  buildPositionAdjustCommand,
  buildPositionProtectCommand,
  buildRecordedActionEvents,
  unwrapToolResponse,
} from "./execution-flow"
import { compileExecutionContract } from "../../../../contracts/execution-contract/src/execution-contract"
import { reduceFlowState } from "./flow-state"
import { appendPlanEvent, ensureSchema } from "./plan-events"

test("execution command spec routes place_entry to order-place with compiled contract", () => {
  const spec = buildExecutionCommandSpec({
    repoRoot: "/repo",
    target_action: "place_entry",
    execution_contract_input: contractInput(),
  })

  assert.equal(spec.target_action, "place_entry")
  assert.equal(spec.tool, "binance-order-place")
  assert.equal(spec.cwd, "/repo/modules/binance/order-place")
  assert.deepEqual(spec.command.slice(0, 8), [
    "bun",
    "src/scripts/main.ts",
    "--symbol",
    "BTCUSDT",
    "--side",
    "BUY",
    "--type",
    "STOP_MARKET",
  ])
  assert.ok(spec.command.includes("--new-client-order-id"))
  assert.ok(spec.command.includes("flow-route-1-1-entry"))
  assert.ok(spec.command.includes("--yes"))
})

test("execution command spec resolves semantic entry intent before routing order-place", () => {
  const spec = buildExecutionCommandSpec({
    repoRoot: "/repo",
    target_action: "place_entry",
    execution_contract_input: {
      ...contractInput(),
      entries: [{
        intent: "entry_at",
        price: 66000,
        reference_price: 65000,
        margin_usdt: 100,
      }],
    },
  })

  assert.deepEqual(spec.command.slice(0, 12), [
    "bun",
    "src/scripts/main.ts",
    "--symbol",
    "BTCUSDT",
    "--side",
    "BUY",
    "--type",
    "STOP_MARKET",
    "--quantity",
    "0.003",
    "--position-side",
    "BOTH",
  ])
  assert.ok(spec.command.includes("--stop-price"))
  assert.ok(spec.command.includes("66000"))
})

test("execution command spec keeps dry-run and live-small compiled contract parity", () => {
  const input = {
    repoRoot: "/repo",
    target_action: "place_entry",
    execution_contract_input: {
      ...contractInput(),
      entries: [{
        intent: "entry_at",
        price: 66000,
        reference_price: 65000,
        margin_usdt: 100,
      }],
    },
  }
  const dryRunSpec = buildExecutionCommandSpec(input)
  const precompiled = compileExecutionContract(input.execution_contract_input as unknown as Parameters<typeof compileExecutionContract>[0])
  const liveSmallSpec = buildExecutionCommandSpec(input, precompiled)

  assert.deepEqual(liveSmallSpec.command, dryRunSpec.command)
  assert.equal(precompiled.entries[0].resolver_snapshot.route_reason.includes("breakout"), true)
})

test("execution command spec routes cancel_order to order-cancel", () => {
  const spec = buildExecutionCommandSpec({
    repoRoot: "/repo",
    target_action: "cancel_order",
    request: {
      symbol: "btc/usdt",
      orig_client_order_id: "flow-route-1-1-entry",
    },
  })

  assert.equal(spec.tool, "binance-order-cancel")
  assert.equal(spec.cwd, "/repo/modules/binance/order-cancel")
  assert.deepEqual(spec.command, [
    "bun",
    "src/scripts/main.ts",
    "--symbol",
    "BTCUSDT",
    "--orig-client-order-id",
    "flow-route-1-1-entry",
    "--yes",
  ])
})

test("cancel command maps algo-all bucket without order identifiers", () => {
  assert.deepEqual(buildOrderCancelCommand({
    target_action: "cancel_order",
    request: {
      symbol: "ETHUSDT",
      order_bucket: "algo",
      scope: "all",
    },
  }), [
    "bun",
    "src/scripts/main.ts",
    "--symbol",
    "ETHUSDT",
    "--algo",
    "--all",
    "--yes",
  ])
})

test("position adjust command only maps reduce or close", () => {
  assert.deepEqual(buildPositionAdjustCommand({
    target_action: "adjust_position",
    request: {
      symbol: "SOLUSDT",
      position_side: "LONG",
      direction: "reduce",
      reduce_quantity: 1.25,
    },
  }), [
    "bun",
    "src/scripts/main.ts",
    "--symbol",
    "SOLUSDT",
    "--position-side",
    "LONG",
    "--reduce-quantity",
    "1.25",
    "--yes",
  ])

  assert.deepEqual(buildPositionAdjustCommand({
    target_action: "adjust_position",
    request: {
      symbol: "SOLUSDT",
      position_side: "SHORT",
      direction: "close",
    },
  }), [
    "bun",
    "src/scripts/main.ts",
    "--symbol",
    "SOLUSDT",
    "--position-side",
    "SHORT",
    "--close-position",
    "true",
    "--yes",
  ])

  assert.throws(
    () => buildPositionAdjustCommand({
      target_action: "adjust_position",
      request: {
        symbol: "SOLUSDT",
        position_side: "LONG",
        direction: "add",
        quantity: 1,
      },
    }),
    /only supports reduce or close/,
  )
})

test("position protect command maps stop take-profit and trailing legs", () => {
  const command = buildPositionProtectCommand({
    target_action: "sync_protection",
    plan: {
      symbol: "BTCUSDT",
      stop_price: 64000,
    },
    request: {
      position_side: "LONG",
      quantity: "0.01",
      take_profit_trigger: 69000,
      trailing_activation_price: 68000,
      callback_rate: 0.5,
      working_type: "MARK_PRICE",
      price_protect: false,
    },
  })

  assert.deepEqual(command, [
    "bun",
    "src/scripts/main.ts",
    "--symbol",
    "BTCUSDT",
    "--position-side",
    "LONG",
    "--quantity",
    "0.01",
    "--stop-loss-trigger",
    "64000",
    "--take-profit-trigger",
    "69000",
    "--trailing-activation-price",
    "68000",
    "--callback-rate",
    "0.5",
    "--working-type",
    "MARK_PRICE",
    "--price-protect",
    "false",
    "--yes",
  ])
})

test("no_action has no executable command spec", () => {
  assert.throws(
    () => buildExecutionCommandSpec({ target_action: "no_action" }),
    /no_action has no executable/,
  )
  assert.throws(
    () => buildExecutionCommandSpec({}),
    /no_action has no executable/,
  )
  assert.throws(
    () => buildRecordedActionEvents({}),
    /no_action has no recorded execution event/,
  )
})

test("recorded cancel action event closes an existing local order", () => {
  const db = new Database(":memory:")
  ensureSchema(db)
  try {
    appendPlanEvent(db, submitEvent("submit-cancel-route", "flow-route-cancel", "flow-route-cancel-entry"))
    const [event] = buildRecordedActionEvents({
      target_action: "cancel_order",
      chain_id: "flow-route-cancel",
      source_observe_event_key: "obs-route-cancel",
      request: {
        symbol: "BTCUSDT",
        orig_client_order_id: "flow-route-cancel-entry",
      },
      execution_result: {
        method: "futuresCancelOrder",
        result: {
          clientOrderId: "flow-route-cancel-entry",
          orderId: 123,
        },
      },
    })
    appendPlanEvent(db, event)

    const state = reduceFlowState(db, "flow-route-cancel") as { current_orders: unknown[] }
    assert.equal(state.current_orders.length, 0)
    assert.equal(event.body_json.sub_kind, "cancel")
    assert.equal(event.body_json.execution_action_snapshot instanceof Object, true)
  } finally {
    db.close()
  }
})

test("recorded protection action events add protective submitted orders", () => {
  const db = new Database(":memory:")
  ensureSchema(db)
  try {
    const events = buildRecordedActionEvents({
      target_action: "sync_protection",
      chain_id: "flow-route-protect",
      source_observe_event_key: "obs-route-protect",
      request: {
        symbol: "BTCUSDT",
        position_side: "LONG",
        quantity: "0.01",
      },
      execution_result: {
        market: "usdm",
        method: "futuresCreateAlgoOrder",
        symbol: "BTCUSDT",
        positionSide: "LONG",
        created: [{
          leg: "stopLoss",
          request: {
            symbol: "BTCUSDT",
            side: "SELL",
            positionSide: "LONG",
            type: "STOP_MARKET",
            quantity: "0.01",
            triggerPrice: "64000",
          },
          result: {
            algoId: 9001,
            clientAlgoId: "flow-route-protect-stop",
          },
        }, {
          leg: "takeProfit",
          request: {
            symbol: "BTCUSDT",
            side: "SELL",
            positionSide: "LONG",
            type: "TAKE_PROFIT_MARKET",
            quantity: "0.01",
            triggerPrice: "69000",
          },
          result: {
            algoId: 9002,
            clientAlgoId: "flow-route-protect-tp",
          },
        }],
      },
    })
    for (const event of events) {
      appendPlanEvent(db, event)
    }

    const state = reduceFlowState(db, "flow-route-protect") as {
      current_orders: Array<{ protective: boolean; client_order_id: string; stop_price: number }>
    }
    assert.equal(events.length, 2)
    assert.equal(state.current_orders.length, 2)
    assert.deepEqual(state.current_orders.map((order) => order.client_order_id), [
      "flow-route-protect-stop",
      "flow-route-protect-tp",
    ])
    assert.equal(state.current_orders[0].protective, undefined)
    assert.equal(events[0].body_json.protective, true)
  } finally {
    db.close()
  }
})

test("recorded adjust action event reduces local position", () => {
  const db = new Database(":memory:")
  ensureSchema(db)
  try {
    appendPlanEvent(db, {
      event_key: "fill-adjust-route-open",
      chain_id: "flow-route-adjust",
      kind: "order_fill",
      created_at: "2026-07-06T12:00:00Z",
      body_json: {
        sub_kind: "fill",
        lifecycle_status: "filled",
        client_order_id: "flow-route-adjust-entry",
        symbol: "BTCUSDT",
        side: "BUY",
        position_side: "BOTH",
        filled_qty: 1,
        avg_fill_price: 65000,
        source: "reconcile",
      },
    })
    const [event] = buildRecordedActionEvents({
      target_action: "adjust_position",
      chain_id: "flow-route-adjust",
      source_observe_event_key: "obs-route-adjust",
      request: {
        symbol: "BTCUSDT",
        position_side: "BOTH",
        direction: "reduce",
        reduce_quantity: 0.25,
      },
      execution_result: {
        market: "usdm",
        method: "futuresOrder",
        symbol: "BTCUSDT",
        reduced: {
          orderId: 456,
          clientOrderId: "flow-route-adjust-reduce",
          symbol: "BTCUSDT",
          side: "SELL",
          positionSide: "BOTH",
          type: "MARKET",
          origQty: "0.25",
          executedQty: "0.25",
          avgPrice: "66000",
        },
        remainingPosition: {
          quantity: "0.75",
        },
      },
    })
    appendPlanEvent(db, event)

    const state = reduceFlowState(db, "flow-route-adjust") as {
      current_position: { state: string; net_qty: number; avg_entry_price: number }
    }
    assert.equal(state.current_position.state, "long")
    assert.equal(state.current_position.net_qty, 0.75)
    assert.equal(state.current_position.avg_entry_price, 65000)
    assert.equal(event.body_json.sub_kind, "fill")
  } finally {
    db.close()
  }
})

test("recorded action events reject incomplete execution tool results", () => {
  assert.throws(
    () => buildRecordedActionEvents({
      target_action: "place_entry",
      chain_id: "flow-incomplete-entry",
      source_observe_event_key: "obs-incomplete-entry",
      preflight_result: { verdict: "armable" },
      execution_contract_input: contractInput(),
      execution_result: {
        method: "futuresOrder",
        result: { clientOrderId: "flow-incomplete-entry" },
      },
    }),
    /place_entry execution_result\.request must be an object/,
  )
  assert.throws(
    () => buildRecordedActionEvents({
      target_action: "cancel_order",
      chain_id: "flow-incomplete-cancel",
      source_observe_event_key: "obs-incomplete-cancel",
      request: { symbol: "BTCUSDT", orig_client_order_id: "flow-incomplete-entry" },
      execution_result: {
        result: { clientOrderId: "flow-incomplete-entry" },
      },
    }),
    /cancel_order execution_result\.method is required/,
  )
  assert.throws(
    () => buildRecordedActionEvents({
      target_action: "sync_protection",
      chain_id: "flow-incomplete-protect",
      source_observe_event_key: "obs-incomplete-protect",
      request: { symbol: "BTCUSDT", position_side: "LONG", quantity: "0.01" },
      execution_result: {
        method: "futuresCreateAlgoOrder",
        created: [{ leg: "stopLoss", request: { symbol: "BTCUSDT" } }],
      },
    }),
    /sync_protection execution_result\.created\[0\]\.result must be an object/,
  )
  assert.throws(
    () => buildRecordedActionEvents({
      target_action: "adjust_position",
      chain_id: "flow-incomplete-adjust",
      source_observe_event_key: "obs-incomplete-adjust",
      request: { symbol: "BTCUSDT", position_side: "BOTH", reduce_quantity: "0.1" },
      execution_result: {
        method: "futuresOrder",
        reduced: { orderId: 1 },
      },
    }),
    /adjust_position execution_result\.remainingPosition is required/,
  )
})

test("unwrapToolResponse rejects failed tool envelopes", () => {
  assert.throws(
    () => unwrapToolResponse({ ok: false, error: "binance rejected order" }),
    /binance rejected order/,
  )
})

function contractInput() {
  return {
    source_observe_event_key: "obs-route-1",
    chain_id: "flow-route-1",
    setup_id: "trend-breakout",
    market: "usdm",
    symbol: "BTCUSDT",
    side: "long",
    position_side: "BOTH",
    margin_mode: "isolated",
    target_leverage: 2,
    account_snapshot: {
      equity_usdt: 1000,
      available_balance_usdt: 900,
      snapshot_at: "2026-07-06T12:00:00+08:00",
    },
    risk: {
      risk_budget_usdt: 10,
      stop_price: 64000,
      invalidation: "below range",
      expected_rr_net: 2,
    },
    entries: [{
      type: "STOP_MARKET",
      stop_price: 66000,
      margin_usdt: 100,
    }],
    exchange_rules: {
      quantity_step_size: "0.001",
      min_qty: "0.001",
    },
  }
}

function submitEvent(eventKey: string, chainId: string, clientOrderId: string) {
  return {
    event_key: eventKey,
    chain_id: chainId,
    kind: "order_fill" as const,
    created_at: "2026-07-06T12:00:00Z",
    body_json: {
      sub_kind: "submit",
      lifecycle_status: "submitted",
      client_order_id: clientOrderId,
      symbol: "BTCUSDT",
      side: "BUY",
      position_side: "BOTH",
      order_type: "LIMIT",
      qty: 1,
      price: 65000,
      source: "reconcile",
    },
  }
}
