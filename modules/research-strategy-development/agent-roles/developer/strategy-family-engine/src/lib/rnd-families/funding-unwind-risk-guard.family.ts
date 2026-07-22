import { factorConditionsToJson, passesFactorConditions, readFactorConditions, type FactorCondition, type FactorFeatureStore } from "../factor-engine"
import type { ReplaySignal, ReplayStrategy } from "../../../../../../replay-execution-plane/compatibility/legacy-research-contracts/src/lib/legacy-research-contracts"
import type { Candle } from "../../../../../../replay-execution-plane/compatibility/legacy-research-data/src/lib/legacy-research-data"
import { trailingFundingAverage } from "../../../../../../replay-execution-plane/compatibility/legacy-research-data/src/lib/funding-events"
import type { RndFamilyModule } from "../rnd-family"
import { readNonNegativeInteger, readPositiveInteger, readPositiveNumber, readSide, round, type JSONRecord, type SideFilter } from "../rnd-family-helpers"

interface Params {
  side: SideFilter
  fundingLookbackEvents: number
  minAbsFundingRate: number
  stopAtr: number
  maxRiskAtr: number
  rewardRisk: number
  vfiWeakMax: number
  chopinessMin: number
  cooldownBars: number
  adverseLookbackBars: number
  maxAdverseMoveAtr: number
  maxShortCloseLocation: number
  minLongCloseLocation: number
  factorConditions: FactorCondition[]
}

const family: RndFamilyModule = {
  id: "funding_unwind_risk_guard_v1",
  configure(strategyId, raw, store) {
    const params = normalize(raw)
    return { strategy: strategy(strategyId, params, store), rewardRisk: params.rewardRisk, params: json(params) }
  },
}

function normalize(raw: JSONRecord): Params {
  return {
    side: readSide(raw.side),
    fundingLookbackEvents: readPositiveInteger(raw.funding_lookback_events, 3),
    minAbsFundingRate: readPositiveNumber(raw.min_abs_funding_rate, 0.00005),
    stopAtr: readPositiveNumber(raw.stop_atr, 0.85),
    maxRiskAtr: readPositiveNumber(raw.max_risk_atr, 1.8),
    rewardRisk: readPositiveNumber(raw.reward_risk, 1),
    vfiWeakMax: readNumber(raw.vfi_weak_max, 0),
    chopinessMin: readNumber(raw.chopiness_min, 50),
    cooldownBars: readNonNegativeInteger(raw.cooldown_bars, 12),
    adverseLookbackBars: readPositiveInteger(raw.adverse_lookback_bars, 6),
    maxAdverseMoveAtr: readPositiveNumber(raw.max_adverse_move_atr, 2.5),
    maxShortCloseLocation: readNumber(raw.max_short_close_location, 0.8),
    minLongCloseLocation: readNumber(raw.min_long_close_location, 0.2),
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
    vfi_weak_max: params.vfiWeakMax,
    chopiness_min: params.chopinessMin,
    cooldown_bars: params.cooldownBars,
    adverse_lookback_bars: params.adverseLookbackBars,
    max_adverse_move_atr: params.maxAdverseMoveAtr,
    max_short_close_location: params.maxShortCloseLocation,
    min_long_close_location: params.minLongCloseLocation,
    factor_conditions: factorConditionsToJson(params.factorConditions),
  }
}

function strategy(id: string, params: Params, store: FactorFeatureStore): ReplayStrategy {
  return {
    strategy_id: id,
    default_timeframe: "4h",
    warmup_bars: Math.max(200, params.adverseLookbackBars + params.cooldownBars + 1),
    generateSignal({ candles, indicators, index, entryIndex, decisionPrice, options }) {
      const setup = setupAt(candles, indicators.atr14, index, options.timeframe || "4h", options.fundingEvents || [], params, store)
      if (!setup) return null
      if (params.cooldownBars > 0 && index % (params.cooldownBars + 1) !== 0) return null
      return signal(setup.side, candles[index], index, entryIndex, decisionPrice, setup.atr, setup.avgFundingRate, setup.fundingEventsUsed, setup.vfi, setup.chopiness, params)
    },
  }
}

function setupAt(
  candles: Candle[],
  atr14: number[],
  index: number,
  timeframe: string,
  fundingEvents: Array<{ timestamp: string; value: number }>,
  params: Params,
  store: FactorFeatureStore,
): { side: "long" | "short"; atr: number; avgFundingRate: number; fundingEventsUsed: number; vfi: number; chopiness: number } | null {
  const candle = candles[index]
  if (!candle) return null
  if (!passesFactorConditions(params.factorConditions, store, timeframe, candle.date)) return null
  const funding = trailingFundingAverage(fundingEvents, candle.timestamp, params.fundingLookbackEvents)
  if (!funding) return null
  const atr = atr14[index]
  if (!Number.isFinite(atr) || atr <= 0) return null
  const vfi = store.read(timeframe, "vfi.value", candle.date, "level", 1)
  const chopiness = store.read(timeframe, "chopiness.value", candle.date, "level", 1)
  if (!Number.isFinite(vfi) || !Number.isFinite(chopiness) || Number(chopiness) < params.chopinessMin) return null
  const avgFundingRate = funding.average
  if (avgFundingRate >= params.minAbsFundingRate && (params.side === "short" || params.side === "both")) {
    if (Number(vfi) > params.vfiWeakMax || recentMoveAtr(candles, index, params.adverseLookbackBars, atr) > params.maxAdverseMoveAtr || closeLocation(candle) > params.maxShortCloseLocation) return null
    return { side: "short", atr, avgFundingRate, fundingEventsUsed: funding.count, vfi: Number(vfi), chopiness: Number(chopiness) }
  }
  if (avgFundingRate <= -params.minAbsFundingRate && (params.side === "long" || params.side === "both")) {
    if (Number(vfi) < -params.vfiWeakMax || recentMoveAtr(candles, index, params.adverseLookbackBars, atr) < -params.maxAdverseMoveAtr || closeLocation(candle) < params.minLongCloseLocation) return null
    return { side: "long", atr, avgFundingRate, fundingEventsUsed: funding.count, vfi: Number(vfi), chopiness: Number(chopiness) }
  }
  return null
}

function signal(side: "long" | "short", candle: Candle, index: number, entryIndex: number, entry: number, atr: number, avgFundingRate: number, fundingEventsUsed: number, vfi: number, chopiness: number, params: Params): ReplaySignal | null {
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
    reason: `rnd funding unwind risk guard ${side}`,
    meta: { ...json(params), avg_funding_rate: round(avgFundingRate), funding_events_used: fundingEventsUsed, vfi: round(vfi), chopiness: round(chopiness) },
  }
}

function recentMoveAtr(candles: Candle[], index: number, lookbackBars: number, atr: number): number {
  const prior = candles[index - lookbackBars]
  const candle = candles[index]
  if (!prior || !candle || !Number.isFinite(atr) || atr <= 0) return 0
  return (candle.close - prior.close) / atr
}

function closeLocation(candle: Candle): number {
  const range = candle.high - candle.low
  return range > 0 ? (candle.close - candle.low) / range : 0.5
}

function readNumber(value: unknown, fallback: number): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

export default family
