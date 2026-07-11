import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { Database } from "bun:sqlite"

import { executeCancel, parseArgs, recordExchangeAuditIfEnabled, run } from "./main"
import { readExchangeCommandByIdempotencyKey, readExchangeResultsForCommand } from "../../../../exchange-runtime-store/src/lib/exchange-runtime-store"

test("parseArgs requires cancellation target", () => {
  assert.throws(() => parseArgs(["--symbol", "BTCUSDT"]), /provide --all or one identifier/)
})

test("run returns env status for --check-env", async () => {
  const result = await run(["--check-env"])
  assert.equal(result.ok, true)
  assert.ok("data" in result)
})

test("executeCancel returns stable method and result for regular order", async () => {
  const config = parseArgs([
    "--symbol",
    "BTCUSDT",
    "--orig-client-order-id",
    "flow-1-1-entry",
    "--yes",
  ])
  const client = {
    futuresCancelOrder(request: Record<string, unknown>) {
      return Promise.resolve({ orderId: 123, clientOrderId: request.origClientOrderId })
    },
  }

  const result = await executeCancel(config, client as never)
  assert.equal(result.method, "futuresCancelOrder")
  assert.deepEqual(result.result, { orderId: 123, clientOrderId: "flow-1-1-entry" })
})

test("executeCancel returns stable method and result for all regular orders", async () => {
  const config = parseArgs([
    "--symbol",
    "BTCUSDT",
    "--all",
    "--yes",
  ])
  const client = {
    futuresCancelAllOpenOrders(request: Record<string, unknown>) {
      return Promise.resolve({ code: 200, msg: `cancelled ${request.symbol}` })
    },
  }

  const result = await executeCancel(config, client as never)
  assert.equal(result.method, "futuresCancelAllOpenOrders")
  assert.deepEqual(result.result, { code: 200, msg: "cancelled BTCUSDT" })
})

test("executeCancel returns stable method and result for algo order", async () => {
  const config = parseArgs([
    "--symbol",
    "BTCUSDT",
    "--algo",
    "--client-algo-id",
    "flow-1-1-protect",
    "--yes",
  ])
  const client = {
    futuresCancelAlgoOrder(request: Record<string, unknown>) {
      return Promise.resolve({ algoId: 9001, clientAlgoId: request.clientAlgoId })
    },
  }

  const result = await executeCancel(config, client as never)
  assert.equal(result.method, "futuresCancelAlgoOrder")
  assert.deepEqual(result.result, { algoId: 9001, clientAlgoId: "flow-1-1-protect" })
})

test("order-cancel can record exchange runtime audit", () => {
  const dir = mkdtempSync(join(tmpdir(), "order-cancel-audit-"))
  const dbPath = join(dir, "exchange.db")
  try {
    const config = parseArgs([
      "--symbol",
      "BTCUSDT",
      "--orig-client-order-id",
      "flow-1-1-entry",
      "--yes",
      "--exchange-runtime-db",
      dbPath,
      "--requested-by-ref",
      "job:J03",
    ])

    recordExchangeAuditIfEnabled(config, {
      method: "futuresCancelOrder",
      result: { orderId: 123, clientOrderId: "flow-1-1-entry" },
    })

    const db = new Database(dbPath)
    try {
      const command = readExchangeCommandByIdempotencyKey(db, "binance_order_cancel:BTCUSDT:flow-1-1-entry:job:J03")
      assert.equal(command?.command_type, "futuresCancelOrder")
      assert.equal(command?.client_order_id, "flow-1-1-entry")
      assert.equal(command?.status, "cancelled")
      const results = readExchangeResultsForCommand(db, command?.command_id ?? "")
      assert.equal(results[0].exchange_ref, "123")
    } finally {
      db.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
