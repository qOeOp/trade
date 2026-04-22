import assert from "node:assert/strict"
import test from "node:test"

import { buildPlan, parseArgs, resolveLivePosition, run } from "./main"

test("parseArgs requires reduction intent", () => {
  assert.throws(
    () => parseArgs(["--symbol", "BTCUSDT", "--position-side", "LONG"]),
    /one of --reduce-quantity or --close-position true is required/,
  )
})

test("resolveLivePosition reads hedge long correctly", () => {
  const config = parseArgs([
    "--symbol",
    "CLUSDT",
    "--position-side",
    "LONG",
    "--close-position",
    "true",
  ])

  const position = resolveLivePosition(config, [
    { symbol: "CLUSDT", positionSide: "LONG", positionAmt: "29.69" },
  ])

  assert.equal(position.quantity, "29.69")
  assert.equal(position.reduceSide, "SELL")
})

test("buildPlan creates pure quantity-adjustment plan", async () => {
  const config = parseArgs([
    "--symbol",
    "CLUSDT",
    "--position-side",
    "LONG",
    "--reduce-quantity",
    "14.84",
  ])

  const client = {
    futuresPositionRisk() {
      return Promise.resolve([{ symbol: "CLUSDT", positionSide: "LONG", positionAmt: "29.69" }])
    },
  }

  const plan = await buildPlan(config, client as never)

  assert.equal(plan.reduction.reduceQuantity, "14.84")
  assert.equal(plan.reduction.remainingQuantity, "14.85")
  assert.equal(plan.reduceOrder.side, "SELL")
  assert.deepEqual(plan.reduceOrder, {
    symbol: "CLUSDT",
    side: "SELL",
    type: "MARKET",
    quantity: "14.84",
    positionSide: "LONG",
  })
})

test("buildPlan allows partial adjustment without touching protection", async () => {
  const config = parseArgs([
    "--symbol",
    "CLUSDT",
    "--position-side",
    "LONG",
    "--reduce-quantity",
    "10",
  ])

  const client = {
    futuresPositionRisk() {
      return Promise.resolve([{ symbol: "CLUSDT", positionSide: "LONG", positionAmt: "29.69" }])
    },
  }

  const plan = await buildPlan(config, client as never)
  assert.equal(plan.reduction.remainingQuantity, "19.69")
})

test("run returns env status for --check-env", async () => {
  const result = await run(["--check-env"])
  assert.equal(result.ok, true)
})
