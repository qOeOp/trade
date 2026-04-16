import assert from "node:assert/strict"
import test from "node:test"

import { parseArgs, run } from "./main"

test("parseArgs rejects unsupported usdm protective type", () => {
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
    /use binance-position-protect/,
  )
})

test("run returns env status for --check-env", async () => {
  const result = await run(["--check-env"])
  assert.equal(result.ok, true)
  assert.ok("data" in result)
})
