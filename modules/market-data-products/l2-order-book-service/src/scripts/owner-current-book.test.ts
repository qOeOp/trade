import assert from "node:assert/strict"
import test from "node:test"
import { parseArgs } from "./owner-current-book"

test("L2 owner current-book CLI accepts only bounded depth, freshness, and symbol", () => {
  assert.deepEqual(parseArgs([]), { depth: 20, maxFreshnessMs: 1_000 })
  assert.deepEqual(parseArgs(["--depth", "50", "--max-freshness-ms", "500"]), { depth: 50, maxFreshnessMs: 500 })
  assert.throws(() => parseArgs(["--depth", "101"]), /between 1 and 100/)
  assert.throws(() => parseArgs(["--max-freshness-ms", "2001"]), /between 100 and 2000/)
  assert.deepEqual(parseArgs(["--symbol", "ETHUSDT"]), { depth: 20, maxFreshnessMs: 1_000, symbol: "ETHUSDT" })
  assert.throws(() => parseArgs(["--symbol", "eth/usdt"]), /unknown argument/)
  assert.throws(() => parseArgs(["--depth"]), /missing value/)
})
