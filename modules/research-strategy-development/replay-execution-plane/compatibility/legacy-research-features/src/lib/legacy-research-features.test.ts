import assert from "node:assert/strict"
import test from "node:test"
import { atr, buildIndicators, ema } from "./legacy-research-features"
import type { Candle } from "../../../legacy-research-data/src/lib/legacy-research-data"

const candles: Candle[] = Array.from({ length: 20 }, (_, index) => ({
  date: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
  timestamp: Date.UTC(2026, 0, index + 1),
  open: index + 1,
  high: index + 2,
  low: index,
  close: index + 1,
  volume: 10,
}))

test("preserves legacy EMA warmup and recurrence", () => {
  const values = ema([1, 2, 3, 4], 3)
  assert.equal(Number.isNaN(values[0]), true)
  assert.equal(Number.isNaN(values[1]), true)
  assert.deepEqual(values.slice(2), [2, 3])
})

test("preserves legacy ATR and fixed indicator shape", () => {
  assert.equal(atr(candles, 3)[2], 2)
  assert.equal(atr([
    { ...candles[0], high: 2, low: 0, close: 1 },
    { ...candles[1], high: 11, low: 9, close: 10 },
  ], 1)[1], 10)
  const indicators = buildIndicators(candles)
  assert.deepEqual(Object.keys(indicators), ["ema20", "ema50", "ema200", "atr14"])
  assert.equal(indicators.atr14[13], 2)
})
