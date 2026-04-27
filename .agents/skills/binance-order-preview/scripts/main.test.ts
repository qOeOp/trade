import assert from "node:assert/strict"
import test from "node:test"

import { buildPreview, parseArgs, resolveExecution } from "./main"

test("parseArgs requires executable size or close position", () => {
  assert.throws(
    () => parseArgs(["--symbol", "BTCUSDT", "--side", "BUY", "--type", "LIMIT", "--price", "65000"]),
    /one of --quantity or --close-position true is required/,
  )
})

test("resolveExecution routes futures protective orders to position protect", () => {
  const config = parseArgs([
    "--symbol",
    "BTCUSDT",
    "--side",
    "SELL",
    "--type",
    "STOP_MARKET",
    "--close-position",
    "true",
    "--stop-price",
    "64000",
  ])

  assert.deepEqual(resolveExecution(config), {
    method: "futuresCreateAlgoOrder",
    skill: "binance-position-protect",
    authRequired: true,
  })
})

test("resolveExecution keeps standard futures stop entry on order place", () => {
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

  assert.deepEqual(resolveExecution(config), {
    method: "futuresCreateAlgoOrder",
    skill: "binance-order-place",
    authRequired: true,
  })
})

test("resolveExecution keeps take-profit entry on order place", () => {
  const config = parseArgs([
    "--symbol",
    "BTCUSDT",
    "--side",
    "BUY",
    "--type",
    "TAKE_PROFIT_MARKET",
    "--quantity",
    "0.01",
    "--stop-price",
    "64000",
  ])

  assert.deepEqual(resolveExecution(config), {
    method: "futuresCreateAlgoOrder",
    skill: "binance-order-place",
    authRequired: true,
  })
})

test("resolveExecution routes reduce-only take-profit to position protect", () => {
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
    "--reduce-only",
    "true",
  ])

  assert.deepEqual(resolveExecution(config), {
    method: "futuresCreateAlgoOrder",
    skill: "binance-position-protect",
    authRequired: true,
  })
})

test("buildPreview returns usdm market context", async () => {
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
  ])

  const client = {
    futuresPrices() {
      return Promise.resolve({ BTCUSDT: "65010" })
    },
    futuresMarkPrice() {
      return Promise.resolve({
        markPrice: "65005",
        lastFundingRate: "0.0001",
        nextFundingTime: 1700000000000,
      })
    },
  }

  const preview = await buildPreview(config, client as never)

  assert.equal(preview.market, "usdm")
  assert.deepEqual(preview.marketContext, {
    lastPrice: "65010",
    markPrice: "65005",
    lastFundingRate: "0.0001",
    nextFundingTime: 1700000000000,
  })
})
