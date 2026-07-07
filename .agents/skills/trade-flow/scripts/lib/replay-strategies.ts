import { replayStrategy, type Candle, type ReplayOptions, type ReplayResult, type ReplaySignal, type ReplayStrategy } from "./replay-core"

const btcTrendPullbackStrategy: ReplayStrategy = {
  strategy_id: "S-BTC-4H-TREND-PULLBACK",
  default_timeframe: "4h",
  warmup_bars: 200,
  generateSignal({ candles, indicators, index, entryPrice, entryIndex, options }) {
    const candle = candles[index]
    const emaFast = indicators.ema50[index]
    const emaSlow = indicators.ema200[index]
    const currentAtr = indicators.atr14[index]
    const trend = readTrend(candle, emaFast, emaSlow, currentAtr)
    if (!trend) {
      return null
    }
    return buildTrendPullbackSignal({
      side: trend,
      signal: candle,
      signalIndex: index,
      entryIndex,
      entry: entryPrice,
      emaFast,
      currentAtr,
      rewardRisk: options.rewardRisk ?? 2,
    })
  },
}

const replayStrategies = new Map<string, ReplayStrategy>([
  [btcTrendPullbackStrategy.strategy_id, btcTrendPullbackStrategy],
])

function replayRegisteredStrategy(options: ReplayOptions): ReplayResult {
  const strategyId = options.strategyId || btcTrendPullbackStrategy.strategy_id
  const strategy = replayStrategies.get(strategyId)
  if (!strategy) {
    throw new Error(`unsupported replay strategy: ${strategyId}`)
  }
  return replayStrategy(strategy, options)
}

function listReplayStrategies(): string[] {
  return Array.from(replayStrategies.keys()).sort()
}

function readTrend(candle: Candle, emaFast: number, emaSlow: number, currentAtr: number): "long" | "short" | null {
  if (!Number.isFinite(emaFast) || !Number.isFinite(emaSlow) || !Number.isFinite(currentAtr) || currentAtr <= 0) {
    return null
  }
  if (emaFast > emaSlow && candle.close > emaFast) {
    return "long"
  }
  if (emaFast < emaSlow && candle.close < emaFast) {
    return "short"
  }
  return null
}

function buildTrendPullbackSignal(input: {
  side: "long" | "short"
  signal: Candle
  signalIndex: number
  entryIndex: number
  entry: number
  emaFast: number
  currentAtr: number
  rewardRisk: number
}): ReplaySignal | null {
  if (input.side === "long") {
    const pulledBack = input.signal.low <= input.emaFast + 0.25 * input.currentAtr
    if (!pulledBack) {
      return null
    }
    const stop = Math.min(input.signal.low, input.emaFast) - 0.5 * input.currentAtr
    const risk = input.entry - stop
    if (risk <= 0 || risk > 1.25 * input.currentAtr) {
      return null
    }
    return {
      side: "long",
      signal_index: input.signalIndex,
      entry_index: input.entryIndex,
      entry: input.entry,
      stop,
      target: input.entry + risk * input.rewardRisk,
      reason: "ema50 trend pullback long",
      meta: {
        ema50: input.emaFast,
        atr14: input.currentAtr,
      },
    }
  }

  const pulledBack = input.signal.high >= input.emaFast - 0.25 * input.currentAtr
  if (!pulledBack) {
    return null
  }
  const stop = Math.max(input.signal.high, input.emaFast) + 0.5 * input.currentAtr
  const risk = stop - input.entry
  if (risk <= 0 || risk > 1.25 * input.currentAtr) {
    return null
  }
  return {
    side: "short",
    signal_index: input.signalIndex,
    entry_index: input.entryIndex,
    entry: input.entry,
    stop,
    target: input.entry - risk * input.rewardRisk,
    reason: "ema50 trend pullback short",
    meta: {
      ema50: input.emaFast,
      atr14: input.currentAtr,
    },
  }
}

export {
  buildTrendPullbackSignal,
  btcTrendPullbackStrategy,
  listReplayStrategies,
  replayRegisteredStrategy,
  replayStrategies,
}
