import assert from "node:assert/strict"
import test from "node:test"
import type { BinanceRest } from "binance-api-node"

import {
  candleCloseTimestamp,
  ensureSymbolSupported,
  fetchKlines,
  formatRFC3339UTC,
  orderedTimeframes,
  parseArgs,
  resolveFetchConfig,
} from "./main"

test("parseArgs requires --symbol", () => {
  assert.throws(() => parseArgs([]), /--symbol is required/)
})

test("parseArgs rejects negative limit", () => {
  assert.throws(
    () => parseArgs(["--symbol", "ETHUSDT", "--limit", "-1"]),
    /--limit cannot be negative/,
  )
})

test("parseArgs requires --since-ts for paginated history", () => {
  assert.throws(
    () => parseArgs(["--symbol", "BTCUSDT", "--limit", "1501"]),
    /requires --since-ts/,
  )
})

test("parseArgs defaults timeframes to 1w,1d,4h,1h", () => {
  const cfg = parseArgs(["--symbol", "ETHUSDT"])
  assert.deepEqual(cfg.timeframes, ["1w", "1d", "4h", "1h"])
})

test("orderedTimeframes preserves canonical order and dedupes", () => {
  assert.deepEqual(orderedTimeframes("1h,1d,1h,4h"), ["1d", "4h", "1h"])
  assert.deepEqual(orderedTimeframes("15m,1h"), ["1h", "15m"])
})

test("resolveFetchConfig slash symbol → manifest with quote suffix, api strips slash", () => {
  const cfg = resolveFetchConfig("binance", "ETH/USDT")
  assert.equal(cfg.exchangeID, "binanceusdm")
  assert.equal(cfg.symbol.manifest, "ETH/USDT:USDT")
  assert.equal(cfg.symbol.api, "ETHUSDT")
})

test("resolveFetchConfig direct symbol passes through", () => {
  const cfg = resolveFetchConfig("binance", "ETHUSDT")
  assert.equal(cfg.symbol.manifest, "ETHUSDT")
  assert.equal(cfg.symbol.api, "ETHUSDT")
})

test("resolveFetchConfig colon symbol keeps manifest, strips for api", () => {
  const cfg = resolveFetchConfig("binance", "ETH/USDT:USDT")
  assert.equal(cfg.symbol.manifest, "ETH/USDT:USDT")
  assert.equal(cfg.symbol.api, "ETHUSDT")
})

test("resolveFetchConfig accepts binanceusdm exchange id", () => {
  const cfg = resolveFetchConfig("binanceusdm", "ETHUSDT")
  assert.equal(cfg.exchangeID, "binanceusdm")
})

test("resolveFetchConfig rejects non-Binance exchange", () => {
  assert.throws(
    () => resolveFetchConfig("okx", "ETHUSDT"),
    /only Binance USD-M is supported/,
  )
})

test("ensureSymbolSupported finds matches beyond the first row", () => {
  ensureSymbolSupported(
    {
      symbols: [
        { symbol: "BTCUSDT", status: "TRADING" },
        { symbol: "ETHUSDT", status: "TRADING" },
      ],
    },
    { exchangeID: "binanceusdm", symbol: { manifest: "ETHUSDT", api: "ETHUSDT" } },
  )
})

test("ensureSymbolSupported rejects non-TRADING status", () => {
  assert.throws(
    () =>
      ensureSymbolSupported(
        { symbols: [{ symbol: "TSMUSDT", status: "BREAK" }] },
        { exchangeID: "binanceusdm", symbol: { manifest: "TSMUSDT", api: "TSMUSDT" } },
      ),
    /symbol not tradable/,
  )
})

test("ensureSymbolSupported rejects missing symbol", () => {
  assert.throws(
    () =>
      ensureSymbolSupported(
        { symbols: [{ symbol: "BTCUSDT", status: "TRADING" }] },
        { exchangeID: "binanceusdm", symbol: { manifest: "ETHUSDT", api: "ETHUSDT" } },
      ),
    /does not support symbol/,
  )
})

test("ensureSymbolSupported rejects payload with error code", () => {
  assert.throws(
    () =>
      ensureSymbolSupported(
        { code: -1121, msg: "Invalid symbol." },
        { exchangeID: "binanceusdm", symbol: { manifest: "BOGUS", api: "BOGUS" } },
      ),
    /does not support symbol/,
  )
})

test("formatRFC3339UTC strips zero milliseconds for parity with Go RFC3339", () => {
  assert.equal(formatRFC3339UTC(0), "1970-01-01T00:00:00Z")
  assert.equal(formatRFC3339UTC(1735689600000), "2025-01-01T00:00:00Z")
})

test("candleCloseTimestamp verifies monthly candles and rejects unknown intervals", () => {
  assert.equal(
    candleCloseTimestamp(Date.UTC(2026, 0, 1), "1M"),
    Date.UTC(2026, 1, 1),
  )
  assert.throws(() => candleCloseTimestamp(0, "odd"), /unsupported timeframe/)
})

test("fetchKlines paginates above the Binance page limit", async () => {
  const start = 1_000
  const step = 14_400_000
  const calls: Array<Record<string, unknown>> = []
  const rows = Array.from({ length: 1502 }, (_, index) => ({
    openTime: start + index * step,
    open: "1",
    high: "2",
    low: "0.5",
    close: "1.5",
    volume: "10",
  }))
  const client = {
    futuresCandles: async (payload: { startTime?: number; limit: number }) => {
      calls.push(payload)
      const offset = payload.startTime
        ? rows.findIndex((row) => row.openTime >= Number(payload.startTime))
        : 0
      return rows.slice(Math.max(0, offset), Math.max(0, offset) + payload.limit)
    },
  } as unknown as BinanceRest

  const candles = await fetchKlines(
    client,
    { exchangeID: "binanceusdm", symbol: { manifest: "BTCUSDT", api: "BTCUSDT" } },
    "4h",
    1502,
    start,
  )

  assert.equal(candles.length, 1502)
  assert.deepEqual(calls.map((call) => call.limit), [1500, 3])
  assert.equal(calls[1].startTime, rows[1499].openTime + 1)
  assert.equal(candles[0].timestamp, start)
  assert.equal(candles.at(-1)?.timestamp, rows.at(-1)?.openTime)
})

test("fetchKlines keeps the latest closed candles when no start time is given", async () => {
  const rows = [1, 2, 3, 4].map((index) => ({
    openTime: index * 14_400_000,
    open: "1",
    high: "2",
    low: "0.5",
    close: "1.5",
    volume: "10",
  }))
  const client = { futuresCandles: async () => rows } as unknown as BinanceRest

  const candles = await fetchKlines(
    client,
    { exchangeID: "binanceusdm", symbol: { manifest: "BTCUSDT", api: "BTCUSDT" } },
    "4h",
    3,
    0,
  )

  assert.deepEqual(candles.map((candle) => candle.timestamp), rows.slice(-3).map((row) => row.openTime))
})
