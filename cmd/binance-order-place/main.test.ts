import assert from "node:assert/strict"
import test from "node:test"

import { parseArgs, run } from "./main"

test("parseArgs accepts standard usdm stop order", () => {
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

  assert.equal(config.type, "STOP")
  assert.equal(config.stopPrice, "65000")
  assert.equal(config.price, "65010")
})

test("parseArgs rejects stop order without stop price", () => {
  assert.throws(
    () =>
      parseArgs([
        "--symbol",
        "BTCUSDT",
        "--market",
        "usdm",
        "--side",
        "BUY",
        "--type",
        "STOP_MARKET",
        "--quantity",
        "0.01",
      ]),
    /--stop-price is required for STOP_MARKET/,
  )
})

test("run returns env status for --check-env", async () => {
  const result = await run(["--check-env"])
  assert.equal(result.ok, true)
  assert.ok("data" in result)
})
