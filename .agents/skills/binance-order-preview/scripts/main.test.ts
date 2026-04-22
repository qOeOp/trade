import assert from "node:assert/strict"
import test from "node:test"

import { buildPreview, parseArgs, resolveExecution } from "./main"

test("parseArgs requires executable size or close position", () => {
  assert.throws(
    () => parseArgs(["--symbol", "BTCUSDT", "--market", "usdm", "--side", "BUY", "--type", "LIMIT", "--price", "65000"]),
    /one of --quantity, --quote-order-qty, or --close-position true is required/,
  )
})

test("resolveExecution routes futures protective orders to position protect", () => {
  const config = parseArgs([
    "--symbol",
    "BTCUSDT",
    "--market",
    "usdm",
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
    "--market",
    "usdm",
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
    "--reduce-only",
    "true",
  ])

  assert.deepEqual(resolveExecution(config), {
    method: "futuresCreateAlgoOrder",
    skill: "binance-position-protect",
    authRequired: true,
  })
})

test("buildPreview returns spot market context using runtime-supported market methods", async () => {
  const config = parseArgs([
    "--symbol",
    "BOMEUSDT",
    "--market",
    "spot",
    "--side",
    "BUY",
    "--type",
    "MARKET",
    "--quote-order-qty",
    "1",
  ])

  const client = {
    prices() {
      return Promise.resolve({ BOMEUSDT: "0.0011" })
    },
    book() {
      return Promise.resolve({
        bids: [{ price: "0.00109", quantity: "1000" }],
        asks: [{ price: "0.00111", quantity: "1000" }],
      })
    },
  }

  const preview = await buildPreview(config, client as never)

  assert.deepEqual(preview.marketContext, {
    lastPrice: "0.0011",
    bidPrice: "0.00109",
    askPrice: "0.00111",
  })
})
