import assert from "node:assert/strict"
import test from "node:test"

import { buildSummary, normalizeAggTrade, parseArgs, run } from "./main"

test("parseArgs requires symbol", () => {
  assert.throws(() => parseArgs([]), /--symbol is required/)
})

test("parseArgs validates limit upper bound", () => {
  assert.throws(() => parseArgs(["--symbol", "BTCUSDT", "--limit", "1001"]), /cannot be greater than 1000/)
})

test("parseArgs validates time range", () => {
  assert.throws(
    () => parseArgs(["--symbol", "BTCUSDT", "--start-time", "20", "--end-time", "10"]),
    /--start-time cannot be greater than --end-time/,
  )
})

test("normalizeAggTrade derives taker side and notional", () => {
  assert.deepEqual(
    normalizeAggTrade({
      aggId: 1,
      symbol: "BTCUSDT",
      price: "65000",
      quantity: "0.02",
      firstId: 10,
      lastId: 12,
      timestamp: 1000,
      isBuyerMaker: true,
      wasBestPrice: true,
    }),
    {
      aggId: 1,
      symbol: "BTCUSDT",
      price: "65000",
      quantity: "0.02",
      notional: "1300.00000000",
      firstId: 10,
      lastId: 12,
      timestamp: 1000,
      isBuyerMaker: true,
      takerSide: "sell",
      wasBestPrice: true,
    },
  )
})

test("buildSummary returns null bounds for empty trade list", () => {
  assert.deepEqual(buildSummary([]), {
    count: 0,
    firstAggId: null,
    lastAggId: null,
    firstTimestamp: null,
    lastTimestamp: null,
  })
})

test("run returns structured error for invalid args", async () => {
  const result = await run(["--nope"])
  assert.deepEqual(result, {
    ok: false,
    error: "unknown flag: --nope",
  })
})
