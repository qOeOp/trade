import assert from "node:assert/strict"
import test from "node:test"

import { buildSnapshot, parseArgs, run } from "./main"

function asRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>
}

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
        lastPrice: "103.2",
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
      publicRequest: async (_method: string, path: string) => {
        if (path === "/fapi/v1/openInterest") {
          return {
            symbol: "BTCUSDT",
            openInterest: "12345",
            time: 789,
          }
        }

        return {
          symbol: "BTCUSDT",
          bidPrice: "101",
          bidQty: "1",
          askPrice: "102",
          askQty: "1",
        }
      },
    } as never,
  )

  assert.equal(snapshot.symbol, "BTCUSDT")
  assert.equal(snapshot.market, "usdm")
  assert.equal(snapshot.ticker24h.lastPrice, "103.2")
  const priceSnapshot = asRecord(snapshot.priceSnapshot)
  assert.equal(priceSnapshot.tradePrice, "103.2")
  assert.equal(priceSnapshot.markPrice, "101.5")
  assert.equal(priceSnapshot.indexPrice, "101.2")
  assert.equal(priceSnapshot.bestBid, "101")
  assert.equal(priceSnapshot.bestAsk, "102")
  assert.equal(priceSnapshot.midPrice, "101.5")
  assert.equal(snapshot.premiumIndex.markPrice, "101.5")
  assert.equal(snapshot.premiumIndex.indexPrice, "101.2")
  assert.equal(snapshot.openInterest.openInterest, "12345")
})

test("buildSnapshot uses markPrice as futures lastPrice fallback instead of openPrice", async () => {
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
        bidPrice: "",
        bidQty: "1",
        askPrice: "",
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
      publicRequest: async (_method: string, path: string) => {
        if (path === "/fapi/v1/openInterest") {
          return {
            symbol: "BTCUSDT",
            openInterest: "12345",
            time: 789,
          }
        }

        return {
          symbol: "BTCUSDT",
          bidPrice: "100.8",
          bidQty: "1",
          askPrice: "102.2",
          askQty: "1",
        }
      },
    } as never,
  )

  assert.equal(snapshot.ticker24h.lastPrice, "101.5")
  const priceSnapshot = asRecord(snapshot.priceSnapshot)
  assert.equal(priceSnapshot.tradePrice, "101.5")
  assert.equal(priceSnapshot.markPrice, "101.5")
  assert.equal(priceSnapshot.bestBid, "100.8")
  assert.equal(priceSnapshot.bestAsk, "102.2")
  assert.equal(priceSnapshot.midPrice, "101.5")
  assert.notEqual(snapshot.ticker24h.lastPrice, "99")
})

test("buildSnapshot prefers spot lastPrice over bid ask fallback", async () => {
  const snapshot = await buildSnapshot(
    {
      symbol: "BTCUSDT",
      market: "spot",
      timeout: 10_000,
    },
    {
      dailyStats: async () => ({
        symbol: "BTCUSDT",
        lastPrice: "105.4",
        priceChange: "1",
        priceChangePercent: "2",
        weightedAvgPrice: "100",
        openPrice: "99",
        open: "99",
        highPrice: "110",
        high: "110",
        lowPrice: "90",
        low: "90",
        volume: "1000",
        quoteVolume: "100000",
        askPrice: "106.0",
        askQty: "2",
        bidPrice: "104.0",
        bidQty: "3",
        count: 10,
        totalTrades: 10,
        openTime: 1,
        closeTime: 2,
      }),
      publicRequest: async () => ({
        symbol: "BTCUSDT",
        bidPrice: "104.0",
        bidQty: "3",
        askPrice: "106.0",
        askQty: "2",
      }),
    } as never,
  )

  assert.equal(snapshot.market, "spot")
  assert.equal(snapshot.ticker24h.lastPrice, "105.4")
  const priceSnapshot = asRecord(snapshot.priceSnapshot)
  assert.equal(priceSnapshot.tradePrice, "105.4")
  assert.equal(priceSnapshot.bestBid, "104.0")
  assert.equal(priceSnapshot.bestAsk, "106.0")
  assert.equal(priceSnapshot.midPrice, "105")
})
