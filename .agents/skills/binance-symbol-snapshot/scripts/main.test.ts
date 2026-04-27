import assert from "node:assert/strict"
import test from "node:test"

import { buildSnapshot, parseArgs, run } from "./main"

function asRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>
}

test("parseArgs requires symbol", () => {
  assert.throws(() => parseArgs([]), /--symbol is required/)
})

test("parseArgs supports pulse preset and custom flags", () => {
  const parsed = parseArgs(["--symbol", "BTCUSDT", "--pulse", "--funding-limit", "7", "--recent-kline-limit", "20"])
  assert.equal(parsed.symbol, "BTCUSDT")
  assert.equal(parsed.fundingLimit, 7)
  assert.equal(parsed.recentKlineLimit, 20)
  assert.deepEqual(parsed.recentKlines, ["15m", "1h", "4h"])
})

test("parseArgs validates recent kline interval", () => {
  assert.throws(() => parseArgs(["--symbol", "BTCUSDT", "--recent-klines", "15x"]), /unsupported kline interval/)
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
      timeout: 10_000,
      fundingLimit: 5,
      recentKlines: [],
      recentKlineLimit: 16,
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

        if (path === "/fapi/v1/fundingRate") {
          return [
            { symbol: "BTCUSDT", fundingRate: "0.0001", fundingTime: 222, markPrice: "101.5" },
            { symbol: "BTCUSDT", fundingRate: "0.0002", fundingTime: 333, markPrice: "102.5" },
          ]
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
  assert.equal(snapshot.fundingRates[0].fundingRate, "0.0002")
  assert.equal(snapshot.fundingRates[0].fundingTime, 333)
})

test("buildSnapshot uses markPrice as futures lastPrice fallback instead of openPrice", async () => {
  const snapshot = await buildSnapshot(
    {
      symbol: "BTCUSDT",
      timeout: 10_000,
      fundingLimit: 5,
      recentKlines: [],
      recentKlineLimit: 16,
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

        if (path === "/fapi/v1/fundingRate") {
          return []
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
  assert.equal(priceSnapshot.spreadBps, "137.931")
  assert.notEqual(snapshot.ticker24h.lastPrice, "99")
})

test("buildSnapshot can include recent klines", async () => {
  const snapshot = await buildSnapshot(
    {
      symbol: "BTCUSDT",
      timeout: 10_000,
      fundingLimit: 1,
      recentKlines: ["15m", "1h"],
      recentKlineLimit: 2,
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
      publicRequest: async (_method: string, path: string, payload?: { interval?: string }) => {
        if (path === "/fapi/v1/openInterest") {
          return {
            symbol: "BTCUSDT",
            openInterest: "12345",
            time: 789,
          }
        }

        if (path === "/fapi/v1/fundingRate") {
          return [{ symbol: "BTCUSDT", fundingRate: "0.0001", fundingTime: 333, markPrice: "101.5" }]
        }

        if (path === "/fapi/v1/klines") {
          return [
            [1, "100", "101", "99", payload?.interval === "15m" ? "100.5" : "100.8", "10", 2, "1000", 3, "4", "400", "0"],
            [3, "100.8", "102", "100", "101.2", "11", 4, "1100", 5, "6", "600", "0"],
          ]
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

  const recentKlines = snapshot.recentKlines!
  assert.equal(recentKlines["15m"].length, 2)
  assert.equal(recentKlines["15m"][0].interval, "15m")
  assert.equal(recentKlines["15m"][0].close, "100.5")
  assert.equal(recentKlines["1h"][0].close, "100.8")
})
