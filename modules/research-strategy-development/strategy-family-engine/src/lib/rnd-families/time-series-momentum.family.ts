import { factorConditionsToJson, passesFactorConditions, readFactorConditions, type FactorCondition, type FactorFeatureStore } from "../factor-engine"
import type { Candle, ReplaySignal, ReplayStrategy } from "../../../../replay-engine/src/lib/replay-core"
import type { RndFamilyModule } from "../rnd-family"
import { readNonNegativeNumber, readPositiveInteger, readPositiveNumber, readSide, type JSONRecord, type SideFilter } from "../rnd-family-helpers"

interface Params {
  side: SideFilter
  lookbackBars: number
  thresholdAtr: number
  stopAtr: number
  maxRiskAtr: number
  rewardRisk: number
  breakEvenAfterR: number
  breakEvenOffsetR: number
  factorConditions: FactorCondition[]
}

const family: RndFamilyModule = {
  id: "time_series_momentum_v1",
  configure(strategyId, raw, store) {
    const params = normalize(raw)
    return { strategy: strategy(strategyId, params, store), rewardRisk: params.rewardRisk, params: json(params) }
  },
}

function normalize(raw: JSONRecord): Params {
  return {
    side: readSide(raw.side),
    lookbackBars: readPositiveInteger(raw.lookback_bars, 126),
    thresholdAtr: readPositiveNumber(raw.threshold_atr, 2),
    stopAtr: readPositiveNumber(raw.stop_atr, 1),
    maxRiskAtr: readPositiveNumber(raw.max_risk_atr, 2.5),
    rewardRisk: readPositiveNumber(raw.reward_risk, 2),
    breakEvenAfterR: readNonNegativeNumber(raw.break_even_after_r, 0),
    breakEvenOffsetR: readNonNegativeNumber(raw.break_even_offset_r, 0),
    factorConditions: readFactorConditions(raw.factor_conditions),
  }
}

function json(params: Params): JSONRecord {
  return { side: params.side, lookback_bars: params.lookbackBars, threshold_atr: params.thresholdAtr, stop_atr: params.stopAtr, max_risk_atr: params.maxRiskAtr, reward_risk: params.rewardRisk, break_even_after_r: params.breakEvenAfterR, break_even_offset_r: params.breakEvenOffsetR, factor_conditions: factorConditionsToJson(params.factorConditions) }
}

function strategy(id: string, params: Params, store: FactorFeatureStore): ReplayStrategy {
  return {
    strategy_id: id,
    default_timeframe: "4h",
    warmup_bars: Math.max(200, params.lookbackBars + 1),
    generateSignal({ candles, indicators, index, entryIndex, entryPrice, options }) {
      const candle = candles[index]
      const prior = candles[index - params.lookbackBars]
      const atr = indicators.atr14[index]
      if (!prior || !Number.isFinite(atr) || atr <= 0 || !passesFactorConditions(params.factorConditions, store, options.timeframe || "4h", candle.date)) return null
      const momentum = (candle.close - prior.close) / atr
      if ((params.side === "long" || params.side === "both") && momentum >= params.thresholdAtr) return signal("long", candle, index, entryIndex, entryPrice, atr, params)
      if ((params.side === "short" || params.side === "both") && momentum <= -params.thresholdAtr) return signal("short", candle, index, entryIndex, entryPrice, atr, params)
      return null
    },
  }
}

function signal(side: "long" | "short", candle: Candle, index: number, entryIndex: number, entry: number, atr: number, params: Params): ReplaySignal | null {
  const stop = side === "long" ? candle.low - params.stopAtr * atr : candle.high + params.stopAtr * atr
  const risk = Math.abs(entry - stop)
  if (risk <= 0 || risk > params.maxRiskAtr * atr) return null
  return {
    side,
    signal_index: index,
    entry_index: entryIndex,
    entry,
    stop,
    target: side === "long" ? entry + risk * params.rewardRisk : entry - risk * params.rewardRisk,
    ...(params.breakEvenAfterR > 0 ? { break_even_after_r: params.breakEvenAfterR, break_even_offset_r: params.breakEvenOffsetR } : {}),
    reason: `rnd time-series momentum ${side}`,
    meta: json(params),
  }
}

export default family
