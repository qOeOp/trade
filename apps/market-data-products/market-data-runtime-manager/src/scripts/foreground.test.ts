import assert from "node:assert/strict"
import test from "node:test"
import { parseArgs } from "./foreground"

test("market data runtime manager arguments are bounded and closed-world", () => {
  assert.deepEqual(parseArgs([]), {
    marketDataDb: "data/market_data.db",
    maxInstances: 3,
    basePort: 51_100,
    reconcileIntervalMs: 30_000,
    readinessDeadlineMs: 30_000,
  })
  assert.equal(parseArgs(["--max-instances", "5", "--base-port", "52000"]).maxInstances, 5)
  assert.throws(() => parseArgs(["--market-data-db", "/tmp/other.db"]), /is fixed/)
  assert.throws(() => parseArgs(["--command", "arbitrary"]), /unknown argument/)
  assert.throws(() => parseArgs(["--max-instances", "0"]), /between 1 and 20/)
  assert.throws(() => parseArgs(["--base-port", "65535", "--max-instances", "2"]), /port range/)
  assert.throws(() => parseArgs(["--base-port", "51100", "--base-port", "51101"]), /duplicate/)
})
