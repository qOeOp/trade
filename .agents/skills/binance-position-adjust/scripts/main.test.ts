import assert from "node:assert/strict"
import test from "node:test"

import { buildPlan, executeAdjustment, parseArgs, resolveLivePosition, run } from "./main"

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

test("executeAdjustment returns stable method and remaining position", async () => {
  const config = parseArgs([
    "--symbol",
    "CLUSDT",
    "--position-side",
    "LONG",
    "--reduce-quantity",
    "10",
    "--yes",
  ])
  const plan = {
    generatedAt: "2026-07-08T00:00:00.000Z",
    market: "usdm",
    symbol: "CLUSDT",
    positionSide: "LONG",
    currentPosition: {
      symbol: "CLUSDT",
      positionSide: "LONG",
      quantity: "29.69",
      quantityAbs: 29.69,
      rawPositionAmt: "29.69",
      reduceSide: "SELL",
    },
    reduction: {
      closePosition: false,
      reduceQuantity: "10",
      remainingQuantity: "19.69",
    },
    reduceOrder: {
      symbol: "CLUSDT",
      side: "SELL",
      type: "MARKET",
      quantity: "10",
      positionSide: "LONG",
    },
  } as const
  const client = {
    futuresOrder(request: Record<string, unknown>) {
      return Promise.resolve({
        orderId: 456,
        clientOrderId: "reduce-456",
        ...request,
        origQty: request.quantity,
        executedQty: request.quantity,
      })
    },
    futuresPositionRisk() {
      return Promise.resolve([{ symbol: "CLUSDT", positionSide: "LONG", positionAmt: "19.69" }])
    },
  }

  const result = await executeAdjustment(config, plan, client as never)
  assert.equal(result.method, "futuresOrder")
  assert.equal(result.remainingPosition?.quantity, "19.69")
})

test("run returns env status for --check-env", async () => {
  const result = await run(["--check-env"])
  assert.equal(result.ok, true)
})
