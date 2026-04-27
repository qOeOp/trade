import assert from "node:assert/strict"
import test from "node:test"

import {
  ensureSymbolSupported,
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
