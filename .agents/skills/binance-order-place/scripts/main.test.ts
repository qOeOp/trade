import assert from "node:assert/strict"
import test from "node:test"

import {
  assertOrderWouldPassBasicSymbolRules,
  assertUsdmEntryIntent,
  buildDryRun,
  ensureUsdmLeverage,
  executeOrder,
  parseArgs,
  run,
  submitUsdmTestOrder,
} from "./main"

test("parseArgs accepts standard usdm stop order", () => {
  const config = parseArgs([
    "--symbol",
    "BTCUSDT",
    "--market",
    "usdm",
    "--side",
    "BUY",
    "--type",
    "STOP",
    "--quantity",
    "0.01",
    "--stop-price",
    "65000",
    "--price",
    "65010",
  ])

  assert.equal(config.type, "STOP")
  assert.equal(config.stopPrice, "65000")
  assert.equal(config.price, "65010")
})

test("parseArgs accepts usdm take-profit entry order", () => {
  const config = parseArgs([
    "--symbol",
    "BTCUSDT",
    "--market",
    "usdm",
    "--side",
    "BUY",
    "--type",
    "TAKE_PROFIT",
    "--quantity",
    "0.01",
    "--stop-price",
    "64000",
    "--price",
    "63990",
  ])

  assert.equal(config.type, "TAKE_PROFIT")
  assert.equal(config.stopPrice, "64000")
  assert.equal(config.price, "63990")
})

test("parseArgs accepts leverage for usdm orders", () => {
  const config = parseArgs([
    "--symbol",
    "BTCUSDT",
    "--market",
    "usdm",
    "--side",
    "BUY",
    "--type",
    "LIMIT",
    "--quantity",
    "0.01",
    "--price",
    "65000",
    "--leverage",
    "20",
  ])

  assert.equal(config.leverage, 20)
})

test("parseArgs rejects stop order without stop price", () => {
  assert.throws(
    () =>
      parseArgs([
        "--symbol",
        "BTCUSDT",
        "--market",
        "usdm",
        "--side",
        "BUY",
        "--type",
        "STOP_MARKET",
        "--quantity",
        "0.01",
      ]),
    /--stop-price is required for STOP_MARKET/,
  )
})

test("parseArgs rejects take-profit order without stop price", () => {
  assert.throws(
    () =>
      parseArgs([
        "--symbol",
        "BTCUSDT",
        "--market",
        "usdm",
        "--side",
        "BUY",
        "--type",
        "TAKE_PROFIT_MARKET",
        "--quantity",
        "0.01",
      ]),
    /--stop-price is required for TAKE_PROFIT_MARKET/,
  )
})

test("run returns env status for --check-env", async () => {
  const result = await run(["--check-env"])
  assert.equal(result.ok, true)
  assert.ok("data" in result)
})

test("run returns final request for --dry-json without env access", async () => {
  const result = await run([
    "--symbol",
    "BTCUSDT",
    "--market",
    "usdm",
    "--side",
    "BUY",
    "--type",
    "STOP",
    "--quantity",
    "0.01",
    "--stop-price",
    "65000",
    "--price",
    "65010",
    "--dry-json",
  ])

  assert.equal(result.ok, true)
  assert.deepEqual("data" in result ? result.data : null, buildDryRun(parseArgs([
    "--symbol",
    "BTCUSDT",
    "--market",
    "usdm",
    "--side",
    "BUY",
    "--type",
    "STOP",
    "--quantity",
    "0.01",
    "--stop-price",
    "65000",
    "--price",
    "65010",
    "--dry-json",
  ])))
})

test("buildDryRun uses futuresOrderTest for usdm test mode", () => {
  const config = parseArgs([
    "--symbol",
    "BTCUSDT",
    "--market",
    "usdm",
    "--side",
    "BUY",
    "--type",
    "LIMIT",
    "--quantity",
    "0.01",
    "--price",
    "65000",
    "--test",
  ])

  assert.deepEqual(buildDryRun(config), {
    market: "usdm",
    method: "futuresOrderTest",
    request: {
      symbol: "BTCUSDT",
      side: "BUY",
      type: "LIMIT",
      positionSide: "BOTH",
      quantity: "0.01",
      price: "65000",
      timeInForce: "GTC",
      reduceOnly: "false",
    },
  })
})

test("buildDryRun keeps take-profit entry on place-order path", () => {
  const config = parseArgs([
    "--symbol",
    "BTCUSDT",
    "--market",
    "usdm",
    "--side",
    "SELL",
    "--type",
    "TAKE_PROFIT_MARKET",
    "--quantity",
    "0.01",
    "--stop-price",
    "76000",
    "--test",
  ])

  assert.deepEqual(buildDryRun(config), {
    market: "usdm",
    method: "futuresCreateAlgoOrder",
    warning: "Binance does not expose a test endpoint for futures algo entry orders; this payload was only validated locally",
    request: {
      algoType: "CONDITIONAL",
      symbol: "BTCUSDT",
      side: "SELL",
      type: "TAKE_PROFIT_MARKET",
      positionSide: "BOTH",
      quantity: "0.01",
      triggerPrice: "76000",
      workingType: "CONTRACT_PRICE",
      priceProtect: "true",
    },
  })
})

test("buildDryRun omits timeInForce for spot limit maker orders", () => {
  const config = parseArgs([
    "--symbol",
    "BOMEUSDT",
    "--market",
    "spot",
    "--side",
    "BUY",
    "--type",
    "LIMIT_MAKER",
    "--quantity",
    "1819",
    "--price",
    "0.000550",
  ])

  assert.deepEqual(buildDryRun(config), {
    market: "spot",
    method: "order",
    request: {
      symbol: "BOMEUSDT",
      side: "BUY",
      type: "LIMIT_MAKER",
      quantity: "1819",
      price: "0.000550",
    },
  })
})

test("parseArgs rejects leverage for spot", () => {
  assert.throws(
    () =>
      parseArgs([
        "--symbol",
        "BTCUSDT",
        "--market",
        "spot",
        "--side",
        "BUY",
        "--type",
        "LIMIT",
        "--quantity",
        "0.01",
        "--price",
        "65000",
        "--leverage",
        "20",
      ]),
    /--leverage is only supported for usdm/,
  )
})

test("parseArgs rejects spot orders that provide both quantity and quote order qty", () => {
  assert.throws(
    () =>
      parseArgs([
        "--symbol",
        "BOMEUSDT",
        "--market",
        "spot",
        "--side",
        "BUY",
        "--type",
        "MARKET",
        "--quantity",
        "1000",
        "--quote-order-qty",
        "1",
      ]),
    /either --quantity or --quote-order-qty, not both/,
  )
})

test("parseArgs rejects quote-order-qty on spot limit orders", () => {
  assert.throws(
    () =>
      parseArgs([
        "--symbol",
        "BOMEUSDT",
        "--market",
        "spot",
        "--side",
        "BUY",
        "--type",
        "LIMIT",
        "--quote-order-qty",
        "1",
        "--price",
        "0.001",
      ]),
    /only supported for spot MARKET orders/,
  )
})

test("executeOrder omits timeInForce and reduceOnly for hedge-mode market reduce", async () => {
  const config = parseArgs([
    "--symbol",
    "CLUSDT",
    "--market",
    "usdm",
    "--side",
    "SELL",
    "--type",
    "MARKET",
    "--quantity",
    "14.84",
    "--position-side",
    "LONG",
    "--reduce-only",
    "true",
  ])

  let capturedRequest: Record<string, unknown> | undefined
  const client = {
    futuresOrder(request: Record<string, unknown>) {
      capturedRequest = request
      return Promise.resolve({ orderId: 1 })
    },
  }

  await executeOrder(config, client as never)

  assert.ok(capturedRequest)
  assert.equal(capturedRequest?.type, "MARKET")
  assert.equal("timeInForce" in capturedRequest!, false)
  assert.equal("reduceOnly" in capturedRequest!, false)
})

test("ensureUsdmLeverage changes leverage when current value differs", async () => {
  const config = parseArgs([
    "--symbol",
    "BTCUSDT",
    "--market",
    "usdm",
    "--side",
    "BUY",
    "--type",
    "LIMIT",
    "--quantity",
    "0.01",
    "--price",
    "65000",
    "--leverage",
    "25",
  ])

  let capturedPayload: Record<string, unknown> | undefined
  const client = {
    futuresPositionRisk() {
      return Promise.resolve([{ symbol: "BTCUSDT", leverage: "20", positionAmt: "0" }])
    },
    futuresLeverage(payload: Record<string, unknown>) {
      capturedPayload = payload
      return Promise.resolve({ symbol: "BTCUSDT", leverage: 25, maxNotionalValue: "1000000" })
    },
  }

  const result = await ensureUsdmLeverage(config, client as never)

  assert.deepEqual(capturedPayload, { symbol: "BTCUSDT", leverage: 25 })
  assert.deepEqual(result, {
    targetLeverage: 25,
    previousLeverage: 20,
    changed: true,
    result: { symbol: "BTCUSDT", leverage: 25, maxNotionalValue: "1000000" },
  })
})

test("executeOrder returns leverage adjustment details for usdm", async () => {
  const config = parseArgs([
    "--symbol",
    "BTCUSDT",
    "--market",
    "usdm",
    "--side",
    "BUY",
    "--type",
    "LIMIT",
    "--quantity",
    "0.01",
    "--price",
    "65000",
    "--leverage",
    "20",
  ])

  let futuresLeverageCalls = 0
  const client = {
    futuresPositionRisk() {
      return Promise.resolve([{ symbol: "BTCUSDT", leverage: "20", positionAmt: "0" }])
    },
    futuresLeverage() {
      futuresLeverageCalls += 1
      return Promise.resolve({ symbol: "BTCUSDT", leverage: 20, maxNotionalValue: "1000000" })
    },
    futuresOrder(request: Record<string, unknown>) {
      return Promise.resolve({ orderId: 9, ...request })
    },
  }

  const result = await executeOrder(config, client as never)

  assert.equal(futuresLeverageCalls, 0)
  assert.deepEqual(result, {
    market: "usdm",
    mode: "live",
    method: "futuresOrder",
    leverageAdjustment: {
      targetLeverage: 20,
      previousLeverage: 20,
      changed: false,
    },
    request: {
      symbol: "BTCUSDT",
      side: "BUY",
      type: "LIMIT",
      positionSide: "BOTH",
      quantity: "0.01",
      price: "65000",
      timeInForce: "GTC",
      reduceOnly: "false",
    },
    result: {
      orderId: 9,
      symbol: "BTCUSDT",
      side: "BUY",
      type: "LIMIT",
      positionSide: "BOTH",
      quantity: "0.01",
      price: "65000",
      timeInForce: "GTC",
      reduceOnly: "false",
    },
  })
})

test("submitUsdmTestOrder signs and posts to Binance futures test order endpoint", async () => {
  let capturedUrl = ""
  let capturedInit: RequestInit | undefined
  const response = await submitUsdmTestOrder(
    {
      symbol: "BTCUSDT",
      side: "BUY",
      type: "LIMIT",
      positionSide: "BOTH",
      quantity: "0.01",
      price: "65000",
      timeInForce: "GTC",
      reduceOnly: "false",
    },
    {
      apiKey: "test-key",
      apiSecret: "test-secret",
      timeout: 1_000,
      fetchImpl: async (input, init) => {
        capturedUrl = String(input)
        capturedInit = init
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      },
      httpBase: "https://example.com",
    },
  )

  assert.deepEqual(response, { ok: true })
  assert.match(capturedUrl, /^https:\/\/example\.com\/fapi\/v1\/order\/test\?/)
  assert.match(capturedUrl, /symbol=BTCUSDT/)
  assert.match(capturedUrl, /timestamp=/)
  assert.match(capturedUrl, /signature=/)
  assert.equal(capturedInit?.method, "POST")
  assert.equal((capturedInit?.headers as Record<string, string>)["X-MBX-APIKEY"], "test-key")
})

test("assertOrderWouldPassBasicSymbolRules rejects low-notional usdm orders before exchange submission", async () => {
  const config = parseArgs([
    "--symbol",
    "ATOMUSDT",
    "--market",
    "usdm",
    "--side",
    "BUY",
    "--type",
    "MARKET",
    "--quantity",
    "0.2",
  ])

  const client = {
    futuresExchangeInfo() {
      return Promise.resolve({
        symbols: [
          {
            symbol: "ATOMUSDT",
            filters: [
              { filterType: "PRICE_FILTER", tickSize: "0.001" },
              { filterType: "LOT_SIZE", minQty: "0.01", stepSize: "0.01" },
              { filterType: "MARKET_LOT_SIZE", minQty: "0.01", stepSize: "0.01" },
              { filterType: "MIN_NOTIONAL", notional: "5" },
            ],
          },
        ],
      })
    },
    futuresMarkPrice() {
      return Promise.resolve({ markPrice: "1.77471714" })
    },
  }

  await assert.rejects(
    () => assertOrderWouldPassBasicSymbolRules(config, client as never),
    /below min notional 5/,
  )
})

test("run can hit Binance USDM test order endpoint when explicitly enabled", async () => {
  if (
    process.env.BINANCE_ENABLE_USDM_TEST_ORDER !== "1"
    || !process.env.BINANCE_API_KEY
    || !process.env.BINANCE_API_SECRET
  ) {
    return
  }

  const result = await run([
    "--symbol",
    "BTCUSDT",
    "--market",
    "usdm",
    "--side",
    "BUY",
    "--type",
    "MARKET",
    "--quantity",
    "0.001",
    "--test",
  ])

  assert.equal(result.ok, true, "ok" in result && !result.ok ? `error: ${result.error}` : "")
  assert.ok("data" in result)
  assert.deepEqual((result.data as { method: string }).method, "futuresOrderTest")
})

test("parseArgs accepts GTX time-in-force for usdm limit orders", () => {
  const config = parseArgs([
    "--symbol", "BTCUSDT",
    "--market", "usdm",
    "--side", "BUY",
    "--type", "LIMIT",
    "--quantity", "0.01",
    "--price", "65000",
    "--time-in-force", "GTX",
  ])
  assert.equal(config.timeInForce, "GTX")
})

test("parseArgs accepts IOC time-in-force for usdm limit orders", () => {
  const config = parseArgs([
    "--symbol", "BTCUSDT",
    "--market", "usdm",
    "--side", "BUY",
    "--type", "LIMIT",
    "--quantity", "0.01",
    "--price", "65000",
    "--time-in-force", "IOC",
  ])
  assert.equal(config.timeInForce, "IOC")
})

test("parseArgs rejects FOK time-in-force for usdm limit orders", () => {
  assert.throws(
    () =>
      parseArgs([
        "--symbol", "BTCUSDT",
        "--market", "usdm",
        "--side", "BUY",
        "--type", "LIMIT",
        "--quantity", "0.01",
        "--price", "65000",
        "--time-in-force", "FOK",
      ]),
    /--time-in-force FOK is not valid for usdm LIMIT/,
  )
})

test("parseArgs rejects GTX time-in-force for spot limit orders", () => {
  assert.throws(
    () =>
      parseArgs([
        "--symbol", "BTCUSDT",
        "--market", "spot",
        "--side", "BUY",
        "--type", "LIMIT",
        "--quantity", "0.01",
        "--price", "65000",
        "--time-in-force", "GTX",
      ]),
    /--time-in-force GTX is not valid for spot LIMIT/,
  )
})

test("parseArgs accepts FOK time-in-force for spot limit orders", () => {
  const config = parseArgs([
    "--symbol", "BTCUSDT",
    "--market", "spot",
    "--side", "BUY",
    "--type", "LIMIT",
    "--quantity", "0.01",
    "--price", "65000",
    "--time-in-force", "FOK",
  ])
  assert.equal(config.timeInForce, "FOK")
})

test("parseArgs does not validate time-in-force for market orders", () => {
  const config = parseArgs([
    "--symbol", "BTCUSDT",
    "--market", "usdm",
    "--side", "BUY",
    "--type", "MARKET",
    "--quantity", "0.01",
    "--time-in-force", "FOK",
  ])
  assert.equal(config.timeInForce, "FOK")
})

test("assertUsdmEntryIntent rejects hedge-mode long reduction through open-only skill", async () => {
  const config = parseArgs([
    "--symbol",
    "CLUSDT",
    "--market",
    "usdm",
    "--side",
    "SELL",
    "--type",
    "MARKET",
    "--quantity",
    "14.84",
    "--position-side",
    "LONG",
  ])

  const client = {
    futuresPositionRisk() {
      return Promise.resolve([{ symbol: "CLUSDT", positionSide: "LONG", positionAmt: "14.85" }])
    },
  }

  await assert.rejects(() => assertUsdmEntryIntent(config, client as never), /open-only/)
})
