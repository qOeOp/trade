import { factorConditionsToJson, passesFactorConditions, readFactorConditions, type FactorCondition, type FactorFeatureStore } from "../factor-engine"
import type { Candle, ReplaySignal, ReplayStrategy } from "../../../../../../replay-execution-plane/compatibility/replay-engine/src/lib/replay-core"
import { trailingFundingAverage } from "../../../../../../replay-execution-plane/compatibility/replay-engine/src/lib/funding-events"
import type { RndFamilyModule } from "../rnd-family"
import { readNonNegativeNumber, readPositiveInteger, readPositiveNumber, readSide, round, type JSONRecord, type SideFilter } from "../rnd-family-helpers"

interface Params {
  side: SideFilter
  fundingLookbackEvents: number
  minAbsFundingRate: number
  stopAtr: number
  maxRiskAtr: number
  rewardRisk: number
  breakEvenAfterR: number
  breakEvenOffsetR: number
  factorConditions: FactorCondition[]
}

const family: RndFamilyModule = {
  id: "funding_carry_v1",
  configure(strategyId, raw, store) {
    const params = normalize(raw)
    return { strategy: strategy(strategyId, params, store), rewardRisk: params.rewardRisk, params: json(params) }
  },
}

function normalize(raw: JSONRecord): Params {
  return {
    side: readSide(raw.side),
    fundingLookbackEvents: readPositiveInteger(raw.funding_lookback_events, 3),
    minAbsFundingRate: readPositiveNumber(raw.min_abs_funding_rate, 0.0001),
    stopAtr: readPositiveNumber(raw.stop_atr, 1),
    maxRiskAtr: readPositiveNumber(raw.max_risk_atr, 2.5),
    rewardRisk: readPositiveNumber(raw.reward_risk, 1.5),
    breakEvenAfterR: readNonNegativeNumber(raw.break_even_after_r, 0),
    breakEvenOffsetR: readNonNegativeNumber(raw.break_even_offset_r, 0),
    factorConditions: readFactorConditions(raw.factor_conditions),
  }
}

function json(params: Params): JSONRecord {
  return {
    side: params.side,
    funding_lookback_events: params.fundingLookbackEvents,
    min_abs_funding_rate: params.minAbsFundingRate,
    stop_atr: params.stopAtr,
    max_risk_atr: params.maxRiskAtr,
    reward_risk: params.rewardRisk,
    break_even_after_r: params.breakEvenAfterR,
    break_even_offset_r: params.breakEvenOffsetR,
    factor_conditions: factorConditionsToJson(params.factorConditions),
  }
}

function strategy(id: string, params: Params, store: FactorFeatureStore): ReplayStrategy {
  return {
    strategy_id: id,
    default_timeframe: "4h",
    warmup_bars: 200,
    generateSignal({ candles, indicators, index, entryIndex, decisionPrice, options }) {
      const candle = candles[index]
      if (!passesFactorConditions(params.factorConditions, store, options.timeframe || "4h", candle.date)) return null
      const funding = trailingFundingAverage(options.fundingEvents || [], candles[index].timestamp, params.fundingLookbackEvents)
      if (!funding) return null
      const avgFundingRate = funding.average
      const atr = indicators.atr14[index]
      if (!Number.isFinite(avgFundingRate) || !Number.isFinite(atr) || atr <= 0) return null
      if (avgFundingRate >= params.minAbsFundingRate && (params.side === "short" || params.side === "both")) {
        return signal("short", candles[index], index, entryIndex, decisionPrice, atr, avgFundingRate, funding.count, params)
      }
      if (avgFundingRate <= -params.minAbsFundingRate && (params.side === "long" || params.side === "both")) {
        return signal("long", candles[index], index, entryIndex, decisionPrice, atr, avgFundingRate, funding.count, params)
      }
      return null
    },
  }
}

function signal(side: "long" | "short", candle: Candle, index: number, entryIndex: number, entry: number, atr: number, avgFundingRate: number, fundingEventsUsed: number, params: Params): ReplaySignal | null {
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
    entry_risk_limit: params.maxRiskAtr * atr,
    ...(params.breakEvenAfterR > 0 ? { break_even_after_r: params.breakEvenAfterR, break_even_offset_r: params.breakEvenOffsetR } : {}),
    reason: `rnd funding carry ${side}`,
    meta: { ...json(params), avg_funding_rate: round(avgFundingRate), funding_events_used: fundingEventsUsed },
  }
}

export default family
