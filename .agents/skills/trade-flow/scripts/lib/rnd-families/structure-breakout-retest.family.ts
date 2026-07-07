import { factorConditionsToJson, passesFactorConditions, readFactorConditions, type FactorCondition, type FactorFeatureStore } from "../factor-engine"
import type { Candle, ReplaySignal, ReplayStrategy } from "../replay-core"
import type { RndFamilyModule } from "../rnd-family"
import { readNonNegativeNumber, readPositiveInteger, readPositiveNumber, readSide, round, type JSONRecord, type SideFilter } from "../rnd-family-helpers"

interface Params {
  side: SideFilter
  lookbackBars: number
  breakoutBufferAtr: number
  retestToleranceAtr: number
  stopAtr: number
  maxRiskAtr: number
  rewardRisk: number
  factorConditions: FactorCondition[]
}

const family: RndFamilyModule = {
  id: "structure_breakout_retest_v1",
  configure(strategyId, raw, factorStore) {
    const params = normalize(raw)
    return { strategy: buildStrategy(strategyId, params, factorStore), rewardRisk: params.rewardRisk, params: toJSON(params) }
  },
}

function normalize(raw: JSONRecord): Params {
  return {
    side: readSide(raw.side),
    lookbackBars: readPositiveInteger(raw.lookback_bars ?? raw.lookbackBars, 80),
    breakoutBufferAtr: readNonNegativeNumber(raw.breakout_buffer_atr ?? raw.breakoutBufferAtr, 0.1),
    retestToleranceAtr: readPositiveNumber(raw.retest_tolerance_atr ?? raw.retestToleranceAtr, 0.5),
    stopAtr: readPositiveNumber(raw.stop_atr ?? raw.stopAtr, 0.5),
    maxRiskAtr: readPositiveNumber(raw.max_risk_atr ?? raw.maxRiskAtr, 1.5),
    rewardRisk: readPositiveNumber(raw.reward_risk ?? raw.rewardRisk, 2),
    factorConditions: readFactorConditions(raw.factor_conditions ?? raw.factorConditions ?? raw.indicator_filters ?? raw.indicatorFilters),
  }
}

function toJSON(params: Params): JSONRecord {
  return {
    side: params.side, lookbackBars: params.lookbackBars, breakoutBufferAtr: params.breakoutBufferAtr,
    retestToleranceAtr: params.retestToleranceAtr, stopAtr: params.stopAtr, maxRiskAtr: params.maxRiskAtr,
    rewardRisk: params.rewardRisk, factorConditions: factorConditionsToJson(params.factorConditions),
  }
}

function buildStrategy(strategyId: string, params: Params, factorStore: FactorFeatureStore): ReplayStrategy {
  return {
    strategy_id: strategyId,
    default_timeframe: "4h",
    warmup_bars: Math.max(20, params.lookbackBars + 2),
    generateSignal({ candles, indicators, index, options }) {
      const breakoutIndex = index - 1
      const breakout = candles[breakoutIndex]
      const retest = candles[index]
      const next = candles[index + 1]
      const breakoutAtr = indicators.atr14[breakoutIndex]
      const retestAtr = indicators.atr14[index]
      if (!breakout || !retest || !next || !Number.isFinite(breakoutAtr) || !Number.isFinite(retestAtr) || breakoutAtr <= 0 || retestAtr <= 0) return null
      if (!passesFactorConditions(params.factorConditions, factorStore, options.timeframe || "4h", retest.date)) return null
      const structure = candles.slice(Math.max(0, breakoutIndex - params.lookbackBars), breakoutIndex)
      if (structure.length < params.lookbackBars) return null
      const resistance = Math.max(...structure.map((candle) => candle.high))
      const support = Math.min(...structure.map((candle) => candle.low))

      if (params.side === "long" || params.side === "both") {
        const broken = breakout.close > resistance + params.breakoutBufferAtr * breakoutAtr
        const tested = retest.low <= resistance + params.retestToleranceAtr * retestAtr && retest.low >= resistance - params.retestToleranceAtr * retestAtr
        if (broken && tested && retest.close >= resistance) return buildSignal("long", resistance, retest, index, next.open, retestAtr, params)
      }
      if (params.side === "short" || params.side === "both") {
        const broken = breakout.close < support - params.breakoutBufferAtr * breakoutAtr
        const tested = retest.high >= support - params.retestToleranceAtr * retestAtr && retest.high <= support + params.retestToleranceAtr * retestAtr
        if (broken && tested && retest.close <= support) return buildSignal("short", support, retest, index, next.open, retestAtr, params)
      }
      return null
    },
  }
}

function buildSignal(side: "long" | "short", level: number, retest: Candle, index: number, entry: number, atr: number, params: Params): ReplaySignal | null {
  if (side === "long") {
    const stop = Math.min(retest.low, level) - params.stopAtr * atr
    const risk = entry - stop
    if (risk <= 0 || risk > params.maxRiskAtr * atr) return null
    return { side, signal_index: index, entry_index: index + 1, entry, stop, target: entry + risk * params.rewardRisk, reason: "rnd structure breakout retest long", meta: { ...toJSON(params), structureLevel: round(level) } }
  }
  const stop = Math.max(retest.high, level) + params.stopAtr * atr
  const risk = stop - entry
  if (risk <= 0 || risk > params.maxRiskAtr * atr) return null
  return { side, signal_index: index, entry_index: index + 1, entry, stop, target: entry - risk * params.rewardRisk, reason: "rnd structure breakout retest short", meta: { ...toJSON(params), structureLevel: round(level) } }
}

export default family
