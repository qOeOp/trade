import { buildOhlcvCoverageTargets, buildOhlcvDemandSyncPlan, type OhlcvCoverageTarget, type OhlcvFetchJob } from "./ohlcv-demand-plan"
import type { MarketDataFactRef } from "../../../../contracts/market-data-demand-contract/src/market-data-fact-contract"

export interface OhlcvDemandWorkerDependencies {
  read_subscription_plan: (observedAt: string) => Promise<unknown>
  audit_coverage: (target: OhlcvCoverageTarget, observedAt: string) => Promise<unknown>
  fetch_gap: (job: OhlcvFetchJob) => Promise<{ ok: boolean; reason: string }>
}

export interface OhlcvDemandCycleResult {
  schema_version: "trade.ohlcv-demand-cycle-result.v1"
  observed_at: string
  status: "completed" | "degraded"
  source_plan_hash: string
  sync_plan_hash: string
  target_count: number
  complete_target_count: number
  planned_job_count: number
  executed_job_count: number
  failed_job_count: number
  deferred_job_count: number
  facts: MarketDataFactRef[]
  outcomes: Array<{ job_id: string; symbol: string; timeframe: string; ok: boolean; reason: string }>
  lifecycle_authority: "market_data_owner"
}

export async function runOhlcvDemandCycle(
  input: { observed_at: string; max_jobs: number; max_rows_per_job: number },
  dependencies: OhlcvDemandWorkerDependencies,
): Promise<OhlcvDemandCycleResult> {
  canonicalTime(input.observed_at)
  integer(input.max_jobs, 1, 100, "max_jobs")
  integer(input.max_rows_per_job, 1, 100_000, "max_rows_per_job")
  const sourcePlan = await dependencies.read_subscription_plan(input.observed_at)
  const { source, targets } = buildOhlcvCoverageTargets(sourcePlan)
  if (source.status !== "ready") throw new Error("OHLCV demand source capacity is blocked")
  const audits = await Promise.all(targets.map((target) => dependencies.audit_coverage(target, input.observed_at)))
  const sync = buildOhlcvDemandSyncPlan({
    source_plan: source,
    coverage_audits: audits,
    max_rows_per_job: input.max_rows_per_job,
  })
  const selected = sync.fetch_jobs.slice(0, input.max_jobs)
  const outcomes: OhlcvDemandCycleResult["outcomes"] = []
  for (const job of selected) {
    const result = await dependencies.fetch_gap(job)
    outcomes.push({
      job_id: job.job_id,
      symbol: job.symbol,
      timeframe: job.timeframe,
      ok: result.ok,
      reason: result.reason,
    })
  }
  const failed = outcomes.filter((outcome) => !outcome.ok).length
  return {
    schema_version: "trade.ohlcv-demand-cycle-result.v1",
    observed_at: input.observed_at,
    status: failed === 0 ? "completed" : "degraded",
    source_plan_hash: source.plan_hash,
    sync_plan_hash: sync.plan_hash,
    target_count: targets.length,
    complete_target_count: sync.completed_target_ids.length,
    planned_job_count: sync.fetch_jobs.length,
    executed_job_count: outcomes.length,
    failed_job_count: failed,
    deferred_job_count: sync.fetch_jobs.length - outcomes.length,
    facts: sync.completed_facts,
    outcomes,
    lifecycle_authority: "market_data_owner",
  }
}

function integer(value: number, minimum: number, maximum: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${field} must be an integer between ${minimum} and ${maximum}`)
  }
  return value
}

function canonicalTime(value: string): void {
  if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error("observed_at must be canonical UTC time")
  }
}
