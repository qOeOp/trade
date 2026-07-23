import assert from "node:assert/strict"
import test from "node:test"
import { parseArgs } from "./foreground"

test("OHLCV demand worker arguments are fixed-path and bounded", () => {
  const defaults = parseArgs([])
  assert.equal(defaults.marketDataDb, "data/market_data.db")
  assert.equal(defaults.ohlcvDb, "data/ohlcv.db")
  assert.equal(defaults.maxSymbols, 20)
  assert.throws(() => parseArgs(["--market-data-db", "/tmp/other.db"]), /fixed/)
  assert.throws(() => parseArgs(["--endpoint", "https://override.invalid"]), /unknown/)
  assert.throws(() => parseArgs(["--interval-ms", "4999"]), /between/)
  assert.throws(() => parseArgs(["--max-rows-per-job", "100001"]), /between/)
})
