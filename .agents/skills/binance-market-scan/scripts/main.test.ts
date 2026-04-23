import assert from "node:assert/strict"
import test from "node:test"

import { buildCandidates, parseArgs } from "./main"

test("parseArgs validates direction", () => {
  assert.throws(() => parseArgs(["--direction", "sideways"]), /unsupported direction/)
})

test("parseArgs validates min quote volume", () => {
  assert.throws(() => parseArgs(["--min-quote-volume", "0"]), /greater than 0/)
})

test("parseArgs accepts limit-per-side", () => {
  assert.deepEqual(parseArgs(["--limit-per-side", "7"]), {
    market: "usdm",
    direction: "both",
    minQuoteVolume: 20_000_000,
    limitPerSide: 7,
    timeout: 20_000,
  })
})

test("parseArgs rejects old limit flag", () => {
  assert.throws(() => parseArgs(["--limit", "7"]), /unknown flag/)
})

test("buildCandidates filters and ranks tradable rows", () => {
  const result = buildCandidates(
    new Set(["BTCUSDT", "ETHUSDT"]),
    [
      { symbol: "BTCUSDT", quoteVolume: "150000000", priceChangePercent: "3", askPrice: "65000", count: 1000 },
      { symbol: "ETHUSDT", quoteVolume: "180000000", priceChangePercent: "-4", askPrice: "3200", count: 900 },
      { symbol: "SOLUSDT", quoteVolume: "500000000", priceChangePercent: "5", askPrice: "150", count: 800 },
    ],
    { market: "usdm", direction: "both", minQuoteVolume: 10_000_000, limitPerSide: 5, timeout: 10_000 },
  )

  assert.equal(result.eligible, 2)
  assert.equal(result.long.length, 1)
  assert.equal(result.short.length, 1)
  assert.equal(result.long[0].symbol, "BTCUSDT")
  assert.equal(result.short[0].symbol, "ETHUSDT")
})
