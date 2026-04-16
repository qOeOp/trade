import assert from "node:assert/strict"
import test from "node:test"

import { buildSnapshot, parseArgs, run } from "./main"

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

test("buildSnapshot accepts single-object futuresDailyStats response", async () => {
  const snapshot = await buildSnapshot(
    {
      symbol: "BTCUSDT",
      market: "usdm",
      timeout: 10_000,
    },
    {
      futuresDailyStats: async () => ({
        symbol: "BTCUSDT",
        priceChange: "1",
        priceChangePercent: "2",
        weightedAvgPrice: "100",
        openPrice: "99",
        highPrice: "110",
        lowPrice: "90",
        volume: "1000",
        quoteVolume: "100000",
        bidPrice: "101",
        bidQty: "1",
        askPrice: "102",
        askQty: "1",
        count: 10,
        openTime: 1,
        closeTime: 2,
      }),
      futuresMarkPrice: async () => ({
        symbol: "BTCUSDT",
        markPrice: "101.5",
        indexPrice: "101.2",
        lastFundingRate: "0.0001",
        nextFundingTime: 123,
        time: 456,
      }),
      publicRequest: async () => ({
        symbol: "BTCUSDT",
        openInterest: "12345",
        time: 789,
      }),
    } as never,
  )

  assert.equal(snapshot.symbol, "BTCUSDT")
  assert.equal(snapshot.market, "usdm")
  assert.equal(snapshot.premiumIndex.markPrice, "101.5")
  assert.equal(snapshot.premiumIndex.indexPrice, "101.2")
  assert.equal(snapshot.openInterest.openInterest, "12345")
})
