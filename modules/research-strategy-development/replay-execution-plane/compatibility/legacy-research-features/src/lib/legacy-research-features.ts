import type { Candle } from "../../../legacy-research-data/src/lib/legacy-research-data"

interface IndicatorSet {
  ema20: number[]
  ema50: number[]
  ema200: number[]
  atr14: number[]
}

function buildIndicators(candles: Candle[]): IndicatorSet {
  const closes = candles.map((item) => item.close)
  return {
    ema20: ema(closes, 20),
    ema50: ema(closes, 50),
    ema200: ema(closes, 200),
    atr14: atr(candles, 14),
  }
}

function ema(values: number[], length: number): number[] {
  const output = Array(values.length).fill(Number.NaN) as number[]
  const alpha = 2 / (length + 1)
  let previous = 0
  for (let index = 0; index < values.length; index += 1) {
    if (index < length - 1) {
      continue
    }
    if (index === length - 1) {
      previous = values.slice(0, length).reduce((sum, value) => sum + value, 0) / length
    } else {
      previous = values[index] * alpha + previous * (1 - alpha)
    }
    output[index] = previous
  }
  return output
}

function atr(candles: Candle[], length: number): number[] {
  const trueRanges = candles.map((candle, index) => {
    if (index === 0) {
      return candle.high - candle.low
    }
    const prevClose = candles[index - 1].close
    return Math.max(candle.high - candle.low, Math.abs(candle.high - prevClose), Math.abs(candle.low - prevClose))
  })
  return ema(trueRanges, length)
}

export { atr, buildIndicators, ema, type IndicatorSet }
