import assert from "node:assert/strict"
import test from "node:test"

import {
  appendProtectiveOrders,
  checkEnv,
  normalizeFuturesAlgoOrder,
  normalizeStandardOrder,
  parseArgs,
  run,
  splitOrders,
} from "./main"

test("parseArgs validates symbol-scoped history", () => {
  assert.throws(() => parseArgs(["--include-history"]), /--include-history requires --symbol/)
})

test("splitOrders marks OTOCO orders as attached algo strategy", () => {
  const orders = [
    {
      symbol: "ETHUSDT",
      side: "BUY",
      type: "LIMIT",
      status: "NEW",
      origQty: "2",
      price: "2148",
      stopPrice: "0",
      timeInForce: "GTC",
      orderId: "8389766150651716534",
      clientOrderId: "ios_st_test",
      positionSide: "LONG",
      strategyType: "OTOCO",
      executedQty: "0",
    },
    {
      symbol: "BTCUSDT",
      side: "SELL",
      type: "STOP_MARKET",
      status: "NEW",
      origQty: "0.4",
      price: "0",
      stopPrice: "71960",
      timeInForce: "GTE_GTC",
      orderId: "456",
      positionSide: "LONG",
    },
  ]

  const split = splitOrders(
    orders,
    (order) => String(order.type).toUpperCase() === "STOP_MARKET",
    normalizeStandardOrder("openOrders", "standard"),
  )

  assert.equal(split.regular.length, 1)
  assert.equal(split.protective.length, 1)
  assert.equal(split.regular[0].orderId, "8389766150651716534")
  assert.equal(split.regular[0].strategyType, "OTOCO")
  assert.equal(split.regular[0].hasAttachedAlgoOrders, true)
  assert.equal(split.regular[0].attachedAlgoDetailsAvailable, false)
  assert.equal(split.regular[0].attachedTpSlReadStatus, "unavailable_via_public_api")
  assert.match(
    String(split.regular[0].attachedTpSlReadMessage),
    /does not currently return the attached TP\/SL details/i,
  )
  assert.equal(split.regular[0].manualTpSlRequired, true)
  assert.match(String(split.regular[0].manualTpSlPrompt), /ask the user to provide the TP\/SL prices/i)
  assert.equal(split.regular[0].clientOrderId, "ios_st_test")
})

test("normalizeFuturesAlgoOrder supports mapped algo payloads", () => {
  const normalized = normalizeFuturesAlgoOrder("openAlgoOrders", "algo")({
    algoId: "4000001071871707",
    clientAlgoId: "stToAg_OTOCO_589412122_1",
    symbol: "ETHUSDT",
    side: "BUY",
    positionSide: "LONG",
    type: "TAKE_PROFIT",
    status: "NEW",
    quantity: "2.34",
    price: "2136.0",
    triggerPrice: "2148.0",
    timeInForce: "GTC",
    workingType: "CONTRACT_PRICE",
    reduceOnly: false,
    priceProtect: true,
  })

  assert.deepEqual(normalized, {
    symbol: "ETHUSDT",
    side: "BUY",
    type: "TAKE_PROFIT",
    status: "NEW",
    origQty: "2.34",
    price: "2136.0",
    stopPrice: "2148.0",
    timeInForce: "GTC",
    algoId: "4000001071871707",
    source: "openAlgoOrders",
    sourceType: "algo",
    clientAlgoId: "stToAg_OTOCO_589412122_1",
    positionSide: "LONG",
    reduceOnly: false,
    workingType: "CONTRACT_PRICE",
    priceProtect: true,
  })
})

test("appendProtectiveOrders initializes empty buckets", () => {
  const buckets = appendProtectiveOrders(
    null,
    [
      {
        algoId: "1",
        orderType: "STOP_MARKET",
        algoStatus: "NEW",
        quantity: "1",
        triggerPrice: "100",
      },
    ],
    normalizeFuturesAlgoOrder("allAlgoOrders", "algo"),
  )

  assert.deepEqual(buckets.regular, [])
  assert.equal(buckets.protective.length, 1)
  assert.equal(buckets.protective[0].source, "allAlgoOrders")
})

test("checkEnv reports missing variables as structured data", () => {
  const originalKey = process.env.BINANCE_API_KEY
  const originalSecret = process.env.BINANCE_API_SECRET

  delete process.env.BINANCE_API_KEY
  delete process.env.BINANCE_API_SECRET

  try {
    assert.deepEqual(checkEnv(), {
      ok: false,
      missing: ["BINANCE_API_KEY", "BINANCE_API_SECRET"],
    })
  } finally {
    if (originalKey !== undefined) {
      process.env.BINANCE_API_KEY = originalKey
    }
    if (originalSecret !== undefined) {
      process.env.BINANCE_API_SECRET = originalSecret
    }
  }
})

test("run returns structured error JSON for invalid args", async () => {
  const result = await run(["--nope"])

  assert.deepEqual(result, {
    ok: false,
    error: "unknown flag: --nope",
  })
})

test("run returns structured error JSON for missing env", async () => {
  const originalKey = process.env.BINANCE_API_KEY
  const originalSecret = process.env.BINANCE_API_SECRET

  delete process.env.BINANCE_API_KEY
  delete process.env.BINANCE_API_SECRET

  try {
    const result = await run([])
    assert.deepEqual(result, {
      ok: false,
      error: "missing environment variables",
      data: {
        ok: false,
        missing: ["BINANCE_API_KEY", "BINANCE_API_SECRET"],
      },
    })
  } finally {
    if (originalKey !== undefined) {
      process.env.BINANCE_API_KEY = originalKey
    }
    if (originalSecret !== undefined) {
      process.env.BINANCE_API_SECRET = originalSecret
    }
  }
})
