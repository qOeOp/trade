import assert from "node:assert/strict"
import test from "node:test"
import { parseArgs } from "./foreground"

test("indicator demand worker arguments are fixed-path and bounded", () => {
  const defaults = parseArgs([])
  assert.equal(defaults.marketDataDb, "data/market_data.db")
  assert.equal(defaults.ohlcvDb, "data/ohlcv.db")
  assert.equal(defaults.maxJobsPerCycle, 2)
  assert.throws(() => parseArgs(["--ohlcv-db", "/tmp/other.db"]), /fixed/)
  assert.throws(() => parseArgs(["--provider-command", "arbitrary"]), /unknown/)
  assert.throws(() => parseArgs(["--max-bars", "50001"]), /between/)
})
