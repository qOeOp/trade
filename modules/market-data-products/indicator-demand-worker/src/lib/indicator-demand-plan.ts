import {
  compileMarketDataSubscriptionPlan,
  type MarketDataSubscriptionPlan,
} from "../../../../contracts/market-data-demand-contract/src/market-data-demand-contract"
import {
  SUPPORTED_INDICATOR_SET_REFS,
  type SupportedIndicatorSetRef,
} from "../../../../contracts/market-data-demand-contract/src/indicator-feature-contract"
import { timeframeMilliseconds } from "../../../../contracts/market-data-demand-contract/src/ohlcv-coverage-contract"

export interface IndicatorDemandTarget {
  target_id: string
  symbol: string
  timeframe: string
  feature_set_ref: SupportedIndicatorSetRef
  start_open_time: number
  end_open_time: number
  demand_ids: string[]
}

export function buildIndicatorDemandTargets(sourceValue: unknown): {
  source: MarketDataSubscriptionPlan
  targets: IndicatorDemandTarget[]
} {
  const source = compileMarketDataSubscriptionPlan(sourceValue)
  if (source.status !== "ready") throw new Error("indicator demand source capacity is blocked")
  const ohlcv = source.subscriptions.filter((subscription) => subscription.product === "ohlcv")
  const targets = source.subscriptions
    .filter((subscription) => subscription.product === "indicator_set")
    .map((subscription) => {
      if (subscription.timeframe == null || subscription.indicator_set_ref == null
        || !SUPPORTED_INDICATOR_SET_REFS.includes(subscription.indicator_set_ref as SupportedIndicatorSetRef)) {
        throw new Error("indicator demand target is unsupported")
      }
      const range = targetRange(
        source.observed_at,
        subscription.timeframe,
        subscription.coverage_start,
        subscription.coverage_end,
      )
      if (range == null) return null
      const compatible = ohlcv.find((item) => {
        if (item.symbol !== subscription.symbol || item.timeframe !== subscription.timeframe) return false
        const candidate = targetRange(source.observed_at, item.timeframe!, item.coverage_start, item.coverage_end)
        return candidate != null && candidate.start <= range.start && candidate.end >= range.end
      })
      if (compatible == null) {
        throw new Error(`indicator demand has no compatible OHLCV demand: ${subscription.symbol}:${subscription.timeframe}`)
      }
      return {
        target_id: `indicator:${subscription.symbol}:${subscription.timeframe}:${subscription.indicator_set_ref}`,
        symbol: subscription.symbol,
        timeframe: subscription.timeframe,
        feature_set_ref: subscription.indicator_set_ref as SupportedIndicatorSetRef,
        start_open_time: range.start,
        end_open_time: range.end,
        demand_ids: subscription.demand_ids,
      }
    })
    .filter((target): target is IndicatorDemandTarget => target != null)
    .sort((left, right) => left.target_id.localeCompare(right.target_id))
  if (new Set(targets.map((target) => target.target_id)).size !== targets.length) {
    throw new Error("indicator demand targets are not unique")
  }
  return { source, targets }
}

function targetRange(
  observedAt: string,
  timeframe: string,
  coverageStart: string | null,
  coverageEnd: string | null,
): { start: number; end: number } | null {
  const timeframeMs = timeframeMilliseconds(timeframe)
  const observedAtMs = Date.parse(observedAt)
  const latestClosedOpen = Math.floor(observedAtMs / timeframeMs) * timeframeMs - timeframeMs
  const end = coverageEnd == null
    ? latestClosedOpen
    : Math.floor((Date.parse(coverageEnd) - 1) / timeframeMs) * timeframeMs
  const start = coverageStart == null
    ? end
    : Math.ceil(Date.parse(coverageStart) / timeframeMs) * timeframeMs
  return end < 0 || start < 0 || end < start ? null : { start, end }
}
