import { factorConditionsToJson, passesFactorConditions, readFactorConditions, type FactorCondition } from "../factor-engine"
import type { Candle, IndicatorSet, ReplaySignal, ReplayStrategy } from "../../../../replay-engine/src/lib/replay-core"
import type { RndFamilyModule } from "../rnd-family"
import {
  readBoolean,
  readEmaLength,
  readNonNegativeInteger,
  readPositiveNumber,
  readSide,
  type JSONRecord,
  type SideFilter,
} from "../rnd-family-helpers"

interface Params {
  side: SideFilter
  fastEma: 20 | 50
  slowEma: 50 | 200
  pullbackAtr: number
  stopAtr: number
  maxRiskAtr: number
  rewardRisk: number
  slopeLookback: number
  requireEmaStack: boolean
  factorConditions: FactorCondition[]
}

const family: RndFamilyModule = {
  id: "trend_pullback_v1",
  configure(strategyId, raw, factorStore) {
    const params = normalize(raw)
    return {
      rewardRisk: params.rewardRisk,
      params: toJSON(params),
      strategy: buildStrategy(strategyId, params, factorStore),
    }
  },
}

function normalize(raw: JSONRecord): Params {
  return {
    side: readSide(raw.side),
    fastEma: readEmaLength(raw.fast_ema, 50, [20, 50]) as 20 | 50,
    slowEma: readEmaLength(raw.slow_ema, 200, [50, 200]) as 50 | 200,
    pullbackAtr: readPositiveNumber(raw.pullback_atr, 0.25),
    stopAtr: readPositiveNumber(raw.stop_atr, 0.5),
    maxRiskAtr: readPositiveNumber(raw.max_risk_atr, 1.25),
    rewardRisk: readPositiveNumber(raw.reward_risk, 2),
    slopeLookback: readNonNegativeInteger(raw.slope_lookback, 0),
    requireEmaStack: readBoolean(raw.require_ema_stack, true),
    factorConditions: readFactorConditions(raw.factor_conditions),
  }
}

function toJSON(params: Params): JSONRecord {
  return {
    side: params.side,
    fast_ema: params.fastEma,
    slow_ema: params.slowEma,
    pullback_atr: params.pullbackAtr,
    stop_atr: params.stopAtr,
    max_risk_atr: params.maxRiskAtr,
    reward_risk: params.rewardRisk,
    slope_lookback: params.slopeLookback,
    require_ema_stack: params.requireEmaStack,
    factor_conditions: factorConditionsToJson(params.factorConditions),
  }
}

function buildStrategy(strategyId: string, params: Params, factorStore: Parameters<RndFamilyModule["configure"]>[2]): ReplayStrategy {
  return {
    strategy_id: strategyId,
    default_timeframe: "4h",
    warmup_bars: Math.max(200, params.slopeLookback + 1),
    generateSignal({ candles, indicators, index, entryPrice, entryIndex, options }) {
      const candle = candles[index]
      const fast = readEma(indicators, params.fastEma, index)
      const slow = readEma(indicators, params.slowEma, index)
      const atr = indicators.atr14[index]
      if (!candle || !Number.isFinite(fast) || !Number.isFinite(slow) || !Number.isFinite(atr) || atr <= 0) {
        return null
      }
      if (!passesFactorConditions(params.factorConditions, factorStore, options.timeframe || "4h", candle.date)) {
        return null
      }
      const side = candidateSide(candles, indicators, index, params)
      return side ? signal(side, candle, index, entryIndex, entryPrice, fast, atr, params) : null
    },
  }
}

function candidateSide(candles: Candle[], indicators: IndicatorSet, index: number, params: Params): "long" | "short" | null {
  const candle = candles[index]
  const fast = readEma(indicators, params.fastEma, index)
  const slow = readEma(indicators, params.slowEma, index)
  const previousFast = params.slopeLookback > 0 ? readEma(indicators, params.fastEma, index - params.slopeLookback) : fast
  const longTrend = candle.close > fast && (!params.requireEmaStack || fast > slow) && (!params.slopeLookback || fast > previousFast)
  const shortTrend = candle.close < fast && (!params.requireEmaStack || fast < slow) && (!params.slopeLookback || fast < previousFast)
  if ((params.side === "long" || params.side === "both") && longTrend) return "long"
  if ((params.side === "short" || params.side === "both") && shortTrend) return "short"
  return null
}

function signal(side: "long" | "short", candle: Candle, index: number, entryIndex: number, entry: number, fast: number, atr: number, params: Params): ReplaySignal | null {
  if (side === "long") {
    if (candle.low > fast + params.pullbackAtr * atr) return null
    const stop = Math.min(candle.low, fast) - params.stopAtr * atr
    const risk = entry - stop
    if (risk <= 0 || risk > params.maxRiskAtr * atr) return null
    return { side, signal_index: index, entry_index: entryIndex, entry, stop, target: entry + risk * params.rewardRisk, reason: "rnd trend pullback long", meta: toJSON(params) }
  }
  if (candle.high < fast - params.pullbackAtr * atr) return null
  const stop = Math.max(candle.high, fast) + params.stopAtr * atr
  const risk = stop - entry
  if (risk <= 0 || risk > params.maxRiskAtr * atr) return null
  return { side, signal_index: index, entry_index: entryIndex, entry, stop, target: entry - risk * params.rewardRisk, reason: "rnd trend pullback short", meta: toJSON(params) }
}

function readEma(indicators: IndicatorSet, length: 20 | 50 | 200, index: number): number {
  return length === 20 ? indicators.ema20[index] : length === 50 ? indicators.ema50[index] : indicators.ema200[index]
}

export default family
