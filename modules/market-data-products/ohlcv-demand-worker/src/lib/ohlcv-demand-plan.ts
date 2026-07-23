import { canonicalHash } from "../../../../contracts/runtime-core/src/canonical-json"
import {
  compileMarketDataSubscriptionPlan,
  type MarketDataSubscriptionPlan,
} from "../../../../contracts/market-data-demand-contract/src/market-data-demand-contract"
import {
  compileOhlcvCoverageAudit,
  timeframeMilliseconds,
  type OhlcvCoverageAudit,
} from "../../../../contracts/market-data-demand-contract/src/ohlcv-coverage-contract"
import {
  buildMarketDataFactRef,
  type MarketDataFactRef,
} from "../../../../contracts/market-data-demand-contract/src/market-data-fact-contract"

export const OHLCV_DEMAND_SYNC_PLAN_SCHEMA = "trade.ohlcv-demand-sync-plan.v1" as const

export interface OhlcvCoverageTarget {
  target_id: string
  symbol: string
  timeframe: string
  start_open_time: number
  end_open_time: number
  max_freshness_ms: number
  demand_ids: string[]
}

export interface OhlcvFetchJob {
  job_id: string
  target_id: string
  symbol: string
  timeframe: string
  since_ts: number
  limit: number
  source_audit_hash: string
  lifecycle_authority: "proposal_only"
}

export interface OhlcvDemandSyncPlan {
  schema_version: typeof OHLCV_DEMAND_SYNC_PLAN_SCHEMA
  observed_at: string
  source_plan_hash: string
  targets: OhlcvCoverageTarget[]
  completed_target_ids: string[]
  completed_facts: MarketDataFactRef[]
  fetch_jobs: OhlcvFetchJob[]
  lifecycle_authority: "proposal_only"
  plan_hash: string
}

export function buildOhlcvCoverageTargets(
  sourceValue: unknown,
): { source: MarketDataSubscriptionPlan; targets: OhlcvCoverageTarget[] } {
  const source = compileMarketDataSubscriptionPlan(sourceValue)
  const observedAtMs = Date.parse(source.observed_at)
  const targets = source.subscriptions
    .filter((subscription) => subscription.product === "ohlcv")
    .map((subscription) => {
      if (subscription.timeframe == null) throw new Error("OHLCV subscription has no timeframe")
      const timeframeMs = timeframeMilliseconds(subscription.timeframe)
      const latestClosedOpen = Math.floor(observedAtMs / timeframeMs) * timeframeMs - timeframeMs
      const requestedEnd = subscription.coverage_end == null
        ? latestClosedOpen
        : Math.floor((Date.parse(subscription.coverage_end) - 1) / timeframeMs) * timeframeMs
      const requestedStart = subscription.coverage_start == null
        ? requestedEnd
        : Math.ceil(Date.parse(subscription.coverage_start) / timeframeMs) * timeframeMs
      if (requestedEnd < 0 || requestedStart < 0 || requestedEnd < requestedStart) return null
      return {
        target_id: `ohlcv:${subscription.symbol}:${subscription.timeframe}`,
        symbol: subscription.symbol,
        timeframe: subscription.timeframe,
        start_open_time: requestedStart,
        end_open_time: requestedEnd,
        max_freshness_ms: subscription.max_freshness_ms,
        demand_ids: subscription.demand_ids,
      }
    })
    .filter((target): target is OhlcvCoverageTarget => target != null)
    .sort((left, right) => left.target_id.localeCompare(right.target_id))
  if (new Set(targets.map((target) => target.target_id)).size !== targets.length) {
    throw new Error("OHLCV demand targets are not unique")
  }
  return { source, targets }
}

export function buildOhlcvDemandSyncPlan(input: {
  source_plan: unknown
  coverage_audits: unknown[]
  max_rows_per_job?: number
}): OhlcvDemandSyncPlan {
  const { source, targets } = buildOhlcvCoverageTargets(input.source_plan)
  const maxRows = integer(input.max_rows_per_job ?? 10_000, 1, 100_000, "max_rows_per_job")
  const audits = input.coverage_audits.map(compileOhlcvCoverageAudit)
  const byTarget = new Map<string, OhlcvCoverageAudit>()
  for (const audit of audits) {
    const targetId = `ohlcv:${audit.symbol}:${audit.timeframe}`
    if (byTarget.has(targetId)) throw new Error(`duplicate OHLCV coverage audit: ${targetId}`)
    byTarget.set(targetId, audit)
  }
  const completedTargetIds: string[] = []
  const completedFacts: MarketDataFactRef[] = []
  const fetchJobs: OhlcvFetchJob[] = []
  for (const target of targets) {
    const audit = byTarget.get(target.target_id)
    if (audit == null) throw new Error(`missing OHLCV coverage audit: ${target.target_id}`)
    if (audit.observed_at !== source.observed_at
      || audit.exchange !== "binanceusdm"
      || audit.requested_open_range.start_open_time !== target.start_open_time
      || audit.requested_open_range.end_open_time !== target.end_open_time) {
      throw new Error(`OHLCV coverage audit target drifted: ${target.target_id}`)
    }
    if (audit.complete) {
      completedTargetIds.push(target.target_id)
      completedFacts.push(buildMarketDataFactRef({
        product: "ohlcv",
        venue: "binance_usdm",
        symbol: target.symbol,
        requirement: {
          timeframe: target.timeframe,
          indicator_set_ref: null,
          minimum_depth: null,
        },
        consumer_binding: {
          demand_ids: target.demand_ids,
          source_plan_hash: source.plan_hash,
        },
        source: {
          ref: audit.source_ref,
          content_hash: audit.audit_hash,
        },
        coverage: {
          kind: "half_open",
          start_at: new Date(target.start_open_time).toISOString(),
          end_at: new Date(target.end_open_time + audit.timeframe_ms).toISOString(),
          completeness: "complete",
        },
        freshness: {
          kind: "immutable",
          as_of: new Date(target.end_open_time + audit.timeframe_ms).toISOString(),
          observed_at: audit.observed_at,
          max_freshness_ms: null,
          status: "not_applicable",
        },
      }))
      continue
    }
    const gap = audit.gap_ranges[0]
    if (gap == null) throw new Error(`OHLCV incomplete audit has no actionable gap: ${target.target_id}`)
    const limit = Math.min(maxRows, gap.missing_count)
    const jobWithoutId = {
      target_id: target.target_id,
      symbol: target.symbol,
      timeframe: target.timeframe,
      since_ts: gap.start_open_time,
      limit,
      source_audit_hash: audit.audit_hash,
      lifecycle_authority: "proposal_only" as const,
    }
    fetchJobs.push({
      job_id: `ohlcv-gap:${canonicalHash(jobWithoutId).slice(0, 32)}`,
      ...jobWithoutId,
    })
  }
  const withoutHash = {
    schema_version: OHLCV_DEMAND_SYNC_PLAN_SCHEMA,
    observed_at: source.observed_at,
    source_plan_hash: source.plan_hash,
    targets,
    completed_target_ids: completedTargetIds.sort(),
    completed_facts: completedFacts.sort((left, right) => left.fact_hash.localeCompare(right.fact_hash)),
    fetch_jobs: fetchJobs,
    lifecycle_authority: "proposal_only" as const,
  }
  return { ...withoutHash, plan_hash: canonicalHash(withoutHash) }
}

function integer(value: number, minimum: number, maximum: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${field} must be an integer between ${minimum} and ${maximum}`)
  }
  return value
}
