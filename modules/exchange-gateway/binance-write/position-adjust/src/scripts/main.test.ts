import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { Database } from "bun:sqlite"

import { readExchangeCommandByIdempotencyKey, readExchangeResultsForCommand } from "../../../../exchange-runtime-store/src/lib/exchange-runtime-store"
import { buildPlan, executeAdjustment, parseArgs, recordExchangeAuditIfEnabled, resolveLivePosition, run } from "./main"

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
    generated_at: "2026-07-08T00:00:00.000Z",
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

test("position-adjust can record exchange runtime audit", () => {
  const dir = mkdtempSync(join(tmpdir(), "position-adjust-audit-"))
  const dbPath = join(dir, "exchange_runtime.db")
  const config = parseArgs([
    "--symbol",
    "CLUSDT",
    "--position-side",
    "LONG",
    "--reduce-quantity",
    "10",
    "--exchange-runtime-db",
    dbPath,
    "--requested-by-ref",
    "job-adjust-1",
    "--yes",
  ])
  const plan = {
    generated_at: "2026-07-08T00:00:00.000Z",
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

  recordExchangeAuditIfEnabled(config, plan, {
    market: "usdm",
    method: "futuresOrder",
    symbol: "CLUSDT",
    reduced: {
      orderId: 456,
      clientOrderId: "reduce-456",
      executedQty: "10",
    },
    remainingPosition: {
      symbol: "CLUSDT",
      positionSide: "LONG",
      quantity: "19.69",
    },
  })

  const db = new Database(dbPath)
  try {
    const command = readExchangeCommandByIdempotencyKey(db, "binance_position_adjust:CLUSDT:LONG:reduce-456:job-adjust-1")
    assert.equal(command?.command_type, "futuresOrder")
    assert.equal(command?.client_order_id, "reduce-456")
    assert.equal(command?.requested_by_ref, "job-adjust-1")
    assert.equal(command?.status, "confirmed")
    const results = readExchangeResultsForCommand(db, command?.command_id ?? "")
    assert.equal(results.length, 1)
    assert.equal(results[0].exchange_ref, "456")
  } finally {
    db.close()
  }
})

test("run returns env status for --check-env", async () => {
  const result = await run(["--check-env"])
  assert.equal(result.ok, true)
})
