import assert from "node:assert/strict"
import test from "node:test"

import { executeCancel, parseArgs, run } from "./main"

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
