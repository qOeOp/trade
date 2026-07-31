import {
  buildFundingCoverageTargets,
  buildFundingDemandSyncPlan,
  type FundingCoverageResolution,
  type FundingCoverageTarget,
  type FundingFetchJob,
} from "./funding-demand-plan"
import type { MarketDataFactRef } from "../../../../contracts/market-data-demand-contract/src/market-data-fact-contract"

export interface FundingDemandWorkerDependencies {
  read_subscription_plan: (observedAt: string) => Promise<unknown>
  resolve_coverage: (target: FundingCoverageTarget) => Promise<FundingCoverageResolution>
  fetch_window: (job: FundingFetchJob) => Promise<{ ok: boolean; reason: string }>
}

export interface FundingDemandCycleResult {
  schema_version: "trade.funding-demand-cycle-result.v1"
  observed_at: string
  status: "completed" | "degraded"
  source_plan_hash: string
  sync_plan_hash: string
  target_count: number
  complete_target_count: number
  planned_job_count: number
  executed_job_count: number
  failed_job_count: number
  conflict_target_count: number
  deferred_job_count: number
  facts: MarketDataFactRef[]
  outcomes: Array<{ job_id: string; symbol: string; ok: boolean; reason: string }>
  lifecycle_authority: "market_data_owner"
}

export async function runFundingDemandCycle(
  input: { observed_at: string; max_jobs: number },
  dependencies: FundingDemandWorkerDependencies,
): Promise<FundingDemandCycleResult> {
  canonicalTime(input.observed_at)
  integer(input.max_jobs, 1, 100, "max_jobs")
  const sourcePlan = await dependencies.read_subscription_plan(input.observed_at)
  const { source, targets } = buildFundingCoverageTargets(sourcePlan)
  if (source.status !== "ready") throw new Error("funding demand source capacity is blocked")
  const resolutions = await Promise.all(targets.map(dependencies.resolve_coverage))
  const sync = buildFundingDemandSyncPlan({ source_plan: source, resolutions })
  const selected = sync.fetch_jobs.slice(0, input.max_jobs)
  const outcomes: FundingDemandCycleResult["outcomes"] = []
  for (const job of selected) {
    const result = await dependencies.fetch_window(job)
    outcomes.push({
      job_id: job.job_id,
      symbol: job.target.symbol,
      ok: result.ok,
      reason: result.reason,
    })
  }
  const failed = outcomes.filter((outcome) => !outcome.ok).length
  return {
    schema_version: "trade.funding-demand-cycle-result.v1",
    observed_at: input.observed_at,
    status: failed === 0 && sync.conflict_target_ids.length === 0 ? "completed" : "degraded",
    source_plan_hash: source.plan_hash,
    sync_plan_hash: sync.plan_hash,
    target_count: targets.length,
    complete_target_count: sync.completed_target_ids.length,
    planned_job_count: sync.fetch_jobs.length,
    executed_job_count: outcomes.length,
    failed_job_count: failed,
    conflict_target_count: sync.conflict_target_ids.length,
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
