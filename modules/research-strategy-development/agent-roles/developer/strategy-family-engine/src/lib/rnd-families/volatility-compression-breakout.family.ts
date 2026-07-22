import { factorConditionsToJson, passesFactorConditions, readFactorConditions, type FactorCondition, type FactorFeatureStore } from "../factor-engine"
import type { ReplaySignal, ReplayStrategy } from "../../../../../../replay-execution-plane/compatibility/legacy-research-contracts/src/lib/legacy-research-contracts"
import type { Candle } from "../../../../../../replay-execution-plane/compatibility/legacy-research-data/src/lib/legacy-research-data"
import type { RndFamilyModule } from "../rnd-family"
import { readPositiveInteger, readPositiveNumber, readSide, type JSONRecord, type SideFilter } from "../rnd-family-helpers"

interface Params {
  side: SideFilter
  breakoutBars: number
  compressionBars: number
  compressionPercentile: number
  stopAtr: number
  maxRiskAtr: number
  rewardRisk: number
  factorConditions: FactorCondition[]
}

const family: RndFamilyModule = {
  id: "volatility_compression_breakout_v1",
  configure(strategyId, raw, store) {
    const params = normalize(raw)
    return { strategy: strategy(strategyId, params, store), rewardRisk: params.rewardRisk, params: json(params) }
  },
}

function normalize(raw: JSONRecord): Params {
  const percentile = readPositiveNumber(raw.compression_percentile, 0.25)
  return {
    side: readSide(raw.side),
    breakoutBars: readPositiveInteger(raw.breakout_bars, 40),
    compressionBars: readPositiveInteger(raw.compression_bars, 120),
    compressionPercentile: Math.min(percentile, 1),
    stopAtr: readPositiveNumber(raw.stop_atr, 0.75),
    maxRiskAtr: readPositiveNumber(raw.max_risk_atr, 2.5),
    rewardRisk: readPositiveNumber(raw.reward_risk, 2),
    factorConditions: readFactorConditions(raw.factor_conditions),
  }
}

function json(params: Params): JSONRecord {
  return { side: params.side, breakout_bars: params.breakoutBars, compression_bars: params.compressionBars, compression_percentile: params.compressionPercentile, stop_atr: params.stopAtr, max_risk_atr: params.maxRiskAtr, reward_risk: params.rewardRisk, factor_conditions: factorConditionsToJson(params.factorConditions) }
}

function strategy(id: string, params: Params, store: FactorFeatureStore): ReplayStrategy {
  return {
    strategy_id: id,
    default_timeframe: "4h",
    warmup_bars: Math.max(200, params.compressionBars + params.breakoutBars),
    generateSignal({ candles, indicators, index, entryIndex, decisionPrice, options }) {
      const candle = candles[index]
      if (!passesFactorConditions(params.factorConditions, store, options.timeframe || "4h", candle.date)) return null
      const ratios = candles.slice(index - params.compressionBars, index).map((item, offset) => indicators.atr14[index - params.compressionBars + offset] / item.close).filter(Number.isFinite).sort((a, b) => a - b)
      const priorRatio = indicators.atr14[index - 1] / candles[index - 1].close
      const threshold = ratios[Math.floor((ratios.length - 1) * params.compressionPercentile)]
      const atr = indicators.atr14[index]
      if (ratios.length < params.compressionBars || !Number.isFinite(priorRatio) || priorRatio > threshold || !Number.isFinite(atr) || atr <= 0) return null
      const range = candles.slice(index - params.breakoutBars, index)
      const high = Math.max(...range.map((item) => item.high))
      const low = Math.min(...range.map((item) => item.low))
      if ((params.side === "long" || params.side === "both") && candle.close > high) return signal("long", candle, index, entryIndex, decisionPrice, atr, params)
      if ((params.side === "short" || params.side === "both") && candle.close < low) return signal("short", candle, index, entryIndex, decisionPrice, atr, params)
      return null
    },
  }
}

function signal(side: "long" | "short", candle: Candle, index: number, entryIndex: number, entry: number, atr: number, params: Params): ReplaySignal | null {
  const stop = side === "long" ? candle.low - params.stopAtr * atr : candle.high + params.stopAtr * atr
  const risk = Math.abs(entry - stop)
  if (risk <= 0 || risk > params.maxRiskAtr * atr) return null
  return { side, signal_index: index, entry_index: entryIndex, entry, stop, target: side === "long" ? entry + risk * params.rewardRisk : entry - risk * params.rewardRisk, entry_risk_limit: params.maxRiskAtr * atr, reason: `rnd volatility compression breakout ${side}`, meta: json(params) }
}

export default family
