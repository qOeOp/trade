import assert from "node:assert/strict"
import test from "node:test"

import { parseArgs, run } from "./main"

test("parseArgs requires cancellation target", () => {
  assert.throws(() => parseArgs(["--symbol", "BTCUSDT"]), /provide --all or one identifier/)
})

test("run returns env status for --check-env", async () => {
  const result = await run(["--check-env"])
  assert.equal(result.ok, true)
  assert.ok("data" in result)
})
