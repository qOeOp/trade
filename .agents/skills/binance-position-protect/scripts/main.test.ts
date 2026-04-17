import assert from "node:assert/strict"
import test from "node:test"

import { buildLegs, parseArgs } from "./main"

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
