import assert from "node:assert/strict"
import test from "node:test"

import { parseArgs, resolveExecution } from "./main"

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
    cli: "binance-position-protect",
    authRequired: true,
  })
})
