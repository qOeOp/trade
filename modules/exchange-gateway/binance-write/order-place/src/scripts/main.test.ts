import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { Database } from "bun:sqlite"

import {
  assertOrderWouldPassBasicSymbolRules,
  assertUsdmEntryIntent,
  buildDryRun,
  ensureUsdmLeverage,
  executeOrder,
  parseArgs,
  recordExchangeAuditIfEnabled,
  run,
  submitUsdmTestOrder,
} from "./main"
import { readExchangeCommandByIdempotencyKey, readExchangeResultsForCommand } from "../../../../exchange-runtime-store/src/lib/exchange-runtime-store"

test("parseArgs accepts standard usdm stop order", () => {
  const config = parseArgs([
    "--symbol",
    "BTCUSDT",
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
  const expected = buildDryRun(parseArgs([
    "--symbol",
    "BTCUSDT",
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
  ]))
  const data = "data" in result ? result.data as { request: unknown; exchange_command_ref: { status: string; action: string; command_ref: string } } : null
  assert.deepEqual(data?.request, expected.request)
  assert.equal(data?.exchange_command_ref.status, "planned")
  assert.equal(data?.exchange_command_ref.action, "place_entry")
  assert.match(data?.exchange_command_ref.command_ref || "", /^exchange_runtime_store:command\//)
})

test("buildDryRun uses futuresOrderTest for usdm test mode", () => {
  const config = parseArgs([
    "--symbol",
    "BTCUSDT",
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

test("buildDryRun maps new client order id to clientAlgoId for algo entries", () => {
  const config = parseArgs([
    "--symbol",
    "BTCUSDT",
    "--side",
    "BUY",
    "--type",
    "STOP_MARKET",
    "--quantity",
    "0.01",
    "--stop-price",
    "66000",
    "--new-client-order-id",
    "flow-1-1-entry",
  ])

  assert.deepEqual(buildDryRun(config), {
    method: "futuresCreateAlgoOrder",
    request: {
      algoType: "CONDITIONAL",
      symbol: "BTCUSDT",
      side: "BUY",
      type: "STOP_MARKET",
      positionSide: "BOTH",
      clientAlgoId: "flow-1-1-entry",
      quantity: "0.01",
      triggerPrice: "66000",
      workingType: "CONTRACT_PRICE",
      priceProtect: "true",
    },
  })
})

test("executeOrder rejects hedge-mode market reduction through open-only tool", async () => {
  const config = parseArgs([
    "--symbol",
    "CLUSDT",
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

  const client = {
    futuresPositionRisk() {
      return Promise.resolve([{ symbol: "CLUSDT", positionSide: "LONG", positionAmt: "14.84" }])
    },
  }

  await assert.rejects(() => executeOrder(config, client as never), /open-only/)
})

test("ensureUsdmLeverage changes leverage when current value differs", async () => {
  const config = parseArgs([
    "--symbol",
    "BTCUSDT",
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

test("executeOrder returns stable method request result for algo entry", async () => {
  const config = parseArgs([
    "--symbol",
    "BTCUSDT",
    "--side",
    "BUY",
    "--type",
    "STOP_MARKET",
    "--quantity",
    "0.01",
    "--stop-price",
    "66000",
    "--new-client-order-id",
    "flow-1-1-entry",
  ])

  const client = {
    futuresPositionRisk() {
      return Promise.resolve([{ symbol: "BTCUSDT", positionSide: "BOTH", positionAmt: "0" }])
    },
    futuresCreateAlgoOrder(request: Record<string, unknown>) {
      return Promise.resolve({ algoId: 9001, clientAlgoId: request.clientAlgoId })
    },
    futuresGetAlgoOrder(payload: Record<string, unknown>) {
      return Promise.resolve({
        algoId: payload.algoId,
        clientAlgoId: payload.clientAlgoId,
        status: "NEW",
      })
    },
  }

  const result = await executeOrder(config, client as never)
  assert.equal(result.method, "futuresCreateAlgoOrder")
  assert.deepEqual(result.request, buildDryRun(config).request)
  assert.deepEqual(result.result, { algoId: 9001, clientAlgoId: "flow-1-1-entry" })
  assert.deepEqual((result as { confirmedResult?: unknown }).confirmedResult, {
    algoId: 9001,
    clientAlgoId: "flow-1-1-entry",
    status: "NEW",
  })
})

test("order-place can record exchange runtime audit", () => {
  const dir = mkdtempSync(join(tmpdir(), "order-place-audit-"))
  const dbPath = join(dir, "exchange.db")
  try {
    const config = parseArgs([
      "--symbol",
      "BTCUSDT",
      "--side",
      "BUY",
      "--type",
      "STOP_MARKET",
      "--quantity",
      "0.01",
      "--stop-price",
      "66000",
      "--new-client-order-id",
      "flow-1-1-entry",
      "--exchange-runtime-db",
      dbPath,
      "--requested-by-ref",
      "job:J03",
    ])

    recordExchangeAuditIfEnabled(config, {
      mode: "live",
      method: "futuresCreateAlgoOrder",
      request: buildDryRun(config).request,
      result: { algoId: 9001, clientAlgoId: "flow-1-1-entry" },
      confirmedResult: { algoId: 9001, clientAlgoId: "flow-1-1-entry", status: "NEW" },
    })

    const db = new Database(dbPath)
    try {
      const command = readExchangeCommandByIdempotencyKey(db, "binance_order_place:BTCUSDT:flow-1-1-entry")
      assert.equal(command?.command_type, "futuresCreateAlgoOrder")
      assert.equal(command?.client_order_id, "flow-1-1-entry")
      assert.equal(command?.requested_by_ref, "job:J03")
      assert.equal(command?.status, "confirmed")
      const results = readExchangeResultsForCommand(db, command?.command_id ?? "")
      assert.equal(results.length, 1)
      assert.equal(results[0].exchange_ref, "9001")
    } finally {
      db.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
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
      fetchImpl: (async (input, init) => {
        capturedUrl = String(input)
        capturedInit = init as RequestInit | undefined
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      }) as typeof fetch,
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
        "--side", "BUY",
        "--type", "LIMIT",
        "--quantity", "0.01",
        "--price", "65000",
        "--time-in-force", "FOK",
      ]),
    /--time-in-force FOK is not valid for LIMIT/,
  )
})

test("parseArgs does not validate time-in-force for market orders", () => {
  const config = parseArgs([
    "--symbol", "BTCUSDT",
    "--side", "BUY",
    "--type", "MARKET",
    "--quantity", "0.01",
    "--time-in-force", "FOK",
  ])
  assert.equal(config.timeInForce, "FOK")
})

test("assertUsdmEntryIntent rejects hedge-mode long reduction through open-only tool", async () => {
  const config = parseArgs([
    "--symbol",
    "CLUSDT",
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
