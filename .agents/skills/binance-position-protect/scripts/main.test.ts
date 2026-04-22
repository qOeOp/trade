import assert from "node:assert/strict"
import test from "node:test"

import {
  assertProtectionMatchesPosition,
  buildDryRun,
  buildLegs,
  cleanRequest,
  parseArgs,
  resolveProtectiveSide,
  run,
} from "./main"

test("parseArgs requires quantity unless close position is true", () => {
  assert.throws(
    () => parseArgs(["--symbol", "BTCUSDT", "--position-side", "LONG", "--stop-loss-trigger", "64000"]),
    /--quantity is required unless --close-position true/,
  )
})

test("buildLegs creates stop and take profit requests", () => {
  const config = parseArgs([
    "--symbol",
    "BTCUSDT",
    "--position-side",
    "LONG",
    "--quantity",
    "0.01",
    "--stop-loss-trigger",
    "64000",
    "--take-profit-trigger",
    "68000",
  ])

  const legs = buildLegs(config, "SELL")
  assert.equal(legs.length, 2)
  assert.equal(legs[0].name, "stopLoss")
  assert.equal(legs[1].name, "takeProfit")
  assert.equal(legs[0].request.type, "STOP_MARKET")
})

test("buildLegs keeps closePosition false and omits reduceOnly in hedge mode", () => {
  const config = parseArgs([
    "--symbol",
    "CLUSDT",
    "--position-side",
    "LONG",
    "--quantity",
    "14.85",
    "--stop-loss-trigger",
    "79.10",
  ])

  const [stopLoss] = buildLegs(config, "SELL")

  assert.equal(stopLoss.request.closePosition, false)
  assert.equal("reduceOnly" in stopLoss.request, false)
})

test("run returns protective legs for --dry-json without env access", async () => {
  const argv = [
    "--symbol",
    "CLUSDT",
    "--position-side",
    "LONG",
    "--quantity",
    "14.85",
    "--stop-loss-trigger",
    "79.10",
    "--take-profit-trigger",
    "84.50",
    "--dry-json",
  ]

  const result = await run(argv)
  const config = parseArgs(argv)

  assert.equal(result.ok, true)
  assert.deepEqual("data" in result ? result.data : null, buildDryRun(config))
  assert.equal(resolveProtectiveSide(config), "SELL")
})

test("assertProtectionMatchesPosition allows planned quantity protection without live hedge leg", async () => {
  const config = parseArgs([
    "--symbol",
    "CLUSDT",
    "--position-side",
    "LONG",
    "--quantity",
    "14.85",
    "--stop-loss-trigger",
    "79.10",
  ])

  const client = {
    futuresPositionRisk() {
      return Promise.resolve([{ symbol: "CLUSDT", positionSide: "SHORT", positionAmt: "-14.85" }])
    },
  }

  await assert.doesNotReject(() => assertProtectionMatchesPosition(config, "SELL", client as never))
})

test("assertProtectionMatchesPosition still rejects closePosition without live hedge leg", async () => {
  const config = parseArgs([
    "--symbol",
    "CLUSDT",
    "--position-side",
    "LONG",
    "--close-position",
    "true",
    "--stop-loss-trigger",
    "79.10",
  ])

  const client = {
    futuresPositionRisk() {
      return Promise.resolve([{ symbol: "CLUSDT", positionSide: "SHORT", positionAmt: "-14.85" }])
    },
  }

  await assert.rejects(
    () => assertProtectionMatchesPosition(config, "SELL", client as never),
    /closePosition protection requires an existing position/,
  )
})

test("cleanRequest removes undefined fields before handing payload to library", () => {
  const cleaned = cleanRequest({
    symbol: "RAVEUSDT",
    side: "SELL",
    positionSide: "LONG",
    closePosition: false,
    quantity: "63",
    workingType: "CONTRACT_PRICE",
    priceProtect: "true",
    type: "STOP_MARKET",
    triggerPrice: "16.88",
    price: undefined,
    timeInForce: undefined,
    activatePrice: undefined,
    callbackRate: undefined,
  })

  assert.equal(cleaned.symbol, "RAVEUSDT")
  assert.equal(cleaned.closePosition, false)
  assert.equal("timeInForce" in cleaned, false)
  assert.equal("price" in cleaned, false)
})

test("buildLegs uses activatePrice for trailing stop requests", () => {
  const config = parseArgs([
    "--symbol",
    "ATOMUSDT",
    "--position-side",
    "LONG",
    "--quantity",
    "3",
    "--trailing-activation-price",
    "1.830",
    "--callback-rate",
    "0.5",
  ])

  const [trailingStop] = buildLegs(config, "SELL")

  assert.equal(trailingStop.name, "trailingStop")
  assert.equal(trailingStop.request.type, "TRAILING_STOP_MARKET")
  assert.equal(trailingStop.request.activatePrice, "1.830")
  assert.equal("activationPrice" in trailingStop.request, false)
})
