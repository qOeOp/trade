import assert from "node:assert/strict"
import test from "node:test"
import { parseArgs } from "./owner-book-watch"

test("L2 owner watch CLI accepts only bounded watch controls", () => {
  assert.deepEqual(parseArgs([]), { maxEvents: 20, watchMs: 1_000 })
  assert.deepEqual(parseArgs(["--max-events", "5", "--watch-ms", "250"]), { maxEvents: 5, watchMs: 250 })
  assert.deepEqual(parseArgs(["--symbol", "ETHUSDT"]), { maxEvents: 20, watchMs: 1_000, symbol: "ETHUSDT" })
  assert.throws(() => parseArgs(["--endpoint", "http://remote"]), /unknown argument/)
  assert.throws(() => parseArgs(["--watch-ms", "5001"]), /between 100 and 5000/)
})
