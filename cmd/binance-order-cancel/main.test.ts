import assert from "node:assert/strict"
import test from "node:test"

import { parseArgs, run } from "./main"

test("parseArgs requires cancellation target", () => {
  assert.throws(() => parseArgs(["--symbol", "BTCUSDT"]), /provide --all or one identifier/)
})

test("parseArgs rejects futures algo flags on spot", () => {
  assert.throws(
    () => parseArgs(["--symbol", "BTCUSDT", "--market", "spot", "--algo", "--order-id", "1"]),
    /spot cancel does not support futures algo identifiers/,
  )
})

test("run returns env status for --check-env", async () => {
  const result = await run(["--check-env"])
  assert.equal(result.ok, true)
  assert.ok("data" in result)
})
