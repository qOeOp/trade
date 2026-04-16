import assert from "node:assert/strict"
import test from "node:test"

import { parseArgs, run } from "./main"

test("parseArgs requires symbol", () => {
  assert.throws(() => parseArgs([]), /--symbol is required/)
})

test("parseArgs validates market", () => {
  assert.throws(() => parseArgs(["--symbol", "BTCUSDT", "--market", "margin"]), /unsupported market/)
})

test("run returns structured error for invalid args", async () => {
  const result = await run(["--nope"])
  assert.deepEqual(result, {
    ok: false,
    error: "unknown flag: --nope",
  })
})
