import { canonicalHash } from "../../../../contracts/runtime-core/src/canonical-json"
import {
  compileMarketDataSubscriptionPlan,
  type MarketDataSubscriptionPlan,
} from "../../../../contracts/market-data-demand-contract/src/market-data-demand-contract"
import {
  compileFundingCoverageAudit,
  type FundingCoverageAudit,
} from "../../../../contracts/market-data-demand-contract/src/funding-coverage-contract"
import {
  buildMarketDataFactRefV2,
  type MarketDataFactRef,
} from "../../../../contracts/market-data-demand-contract/src/market-data-fact-contract"

export const FUNDING_DEMAND_SYNC_PLAN_SCHEMA = "trade.funding-demand-sync-plan.v1" as const

export interface FundingCoverageTarget {
  target_id: string
  symbol: string
  coverage_start: string
  coverage_end: string
  demand_ids: string[]
}

export interface FundingCoverageResolution {
  status: "missing" | "ready" | "conflict"
  audit: FundingCoverageAudit | null
  candidate_archive_ids: string[]
}

export interface FundingFetchJob {
  job_id: string
  target: FundingCoverageTarget
  lifecycle_authority: "proposal_only"
}

export interface FundingDemandSyncPlan {
  schema_version: typeof FUNDING_DEMAND_SYNC_PLAN_SCHEMA
  observed_at: string
  source_plan_hash: string
  targets: FundingCoverageTarget[]
  completed_target_ids: string[]
  completed_facts: MarketDataFactRef[]
  fetch_jobs: FundingFetchJob[]
  conflict_target_ids: string[]
  lifecycle_authority: "proposal_only"
  plan_hash: string
}

export interface FundingDemandEvidenceResolution {
  status:
    | "ready"
    | "missing"
    | "conflict"
    | "capacity_deferred"
    | "expired"
    | "not_active"
  source_plan_hash: string
  target: FundingCoverageTarget | null
  resolution: FundingCoverageResolution | null
  fact: MarketDataFactRef | null
}

export function buildFundingCoverageTargets(
  sourceValue: unknown,
): { source: MarketDataSubscriptionPlan; targets: FundingCoverageTarget[] } {
  const source = compileMarketDataSubscriptionPlan(sourceValue)
  const targets = source.subscriptions
    .filter((subscription) => subscription.product === "funding_events")
    .map((subscription) => {
      if (subscription.coverage_start == null || subscription.coverage_end == null) {
        throw new Error("funding subscription has no exact coverage window")
      }
      const targetBody = {
        symbol: subscription.symbol,
        coverage_start: subscription.coverage_start,
        coverage_end: subscription.coverage_end,
        demand_ids: subscription.demand_ids,
      }
      return {
        target_id: `funding:${subscription.symbol}:${canonicalHash(targetBody).slice(0, 32)}`,
        ...targetBody,
      }
    })
    .sort((left, right) => left.target_id.localeCompare(right.target_id))
  if (new Set(targets.map((target) => target.target_id)).size !== targets.length) {
    throw new Error("funding coverage targets are not unique")
  }
  return { source, targets }
}

export function buildFundingDemandSyncPlan(input: {
  source_plan: unknown
  resolutions: unknown[]
}): FundingDemandSyncPlan {
  const { source, targets } = buildFundingCoverageTargets(input.source_plan)
  const resolutions = input.resolutions.map(compileResolution)
  if (resolutions.length !== targets.length) throw new Error("funding resolution count does not match targets")
  const completedTargetIds: string[] = []
  const completedFacts: MarketDataFactRef[] = []
  const fetchJobs: FundingFetchJob[] = []
  const conflictTargetIds: string[] = []
  for (const [index, target] of targets.entries()) {
    const resolution = resolutions[index]!
    if (resolution.status === "conflict") {
      conflictTargetIds.push(target.target_id)
      continue
    }
    if (resolution.status === "missing") {
      const body = { target, lifecycle_authority: "proposal_only" as const }
      fetchJobs.push({
        job_id: `funding-fetch:${canonicalHash(body).slice(0, 32)}`,
        ...body,
      })
      continue
    }
    const audit = resolution.audit!
    if (audit.symbol !== target.symbol
      || audit.coverage.start_at !== target.coverage_start
      || audit.coverage.end_at !== target.coverage_end) {
      throw new Error(`funding coverage resolution drifted: ${target.target_id}`)
    }
    completedTargetIds.push(target.target_id)
    completedFacts.push(buildFundingFact(source, target, audit))
  }
  const body = {
    schema_version: FUNDING_DEMAND_SYNC_PLAN_SCHEMA,
    observed_at: source.observed_at,
    source_plan_hash: source.plan_hash,
    targets,
    completed_target_ids: completedTargetIds,
    completed_facts: completedFacts,
    fetch_jobs: fetchJobs,
    conflict_target_ids: conflictTargetIds,
    lifecycle_authority: "proposal_only" as const,
  }
  return { ...body, plan_hash: canonicalHash(body) }
}

export function resolveFundingDemandEvidence(input: {
  source_plan: unknown
  demand_id: string
  resolution: unknown
}): FundingDemandEvidenceResolution {
  const { source, targets } = buildFundingCoverageTargets(input.source_plan)
  const demandId = identifier(input.demand_id, "demand_id")
  const target = targets.find((item) => item.demand_ids.includes(demandId))
  if (target == null) {
    return {
      status: source.deferred_demand_ids.includes(demandId)
        ? "capacity_deferred"
        : source.expired_demand_ids.includes(demandId)
          ? "expired"
          : "not_active",
      source_plan_hash: source.plan_hash,
      target: null,
      resolution: null,
      fact: null,
    }
  }
  const resolution = compileResolution(input.resolution)
  return {
    status: resolution.status,
    source_plan_hash: source.plan_hash,
    target,
    resolution,
    fact: resolution.status === "ready"
      ? buildFundingFact(source, target, resolution.audit!)
      : null,
  }
}

function buildFundingFact(
  source: MarketDataSubscriptionPlan,
  target: FundingCoverageTarget,
  audit: FundingCoverageAudit,
): MarketDataFactRef {
  if (audit.symbol !== target.symbol
      || audit.coverage.start_at !== target.coverage_start
      || audit.coverage.end_at !== target.coverage_end) {
    throw new Error(`funding coverage resolution drifted: ${target.target_id}`)
  }
  return buildMarketDataFactRefV2({
    product: "funding_events",
    venue: "binance_usdm",
    symbol: target.symbol,
    requirement: {
      timeframe: null,
      indicator_set_ref: null,
      minimum_depth: null,
    },
    consumer_binding: {
      demand_ids: target.demand_ids,
      source_plan_hash: source.plan_hash,
    },
    source: {
      ref: audit.source.ref,
      content_hash: audit.source.events_hash,
    },
    coverage: {
      kind: "half_open",
      start_at: target.coverage_start,
      end_at: target.coverage_end,
      completeness: "complete",
    },
    freshness: {
      kind: "immutable",
      as_of: target.coverage_end,
      observed_at: audit.audited_at,
      max_freshness_ms: null,
      status: "not_applicable",
    },
  })
}

function compileResolution(value: unknown): FundingCoverageResolution {
  const input = record(value, "funding coverage resolution")
  const status = oneOf(input.status, ["missing", "ready", "conflict"] as const, "status")
  const candidateIds = sortedUniqueStrings(input.candidate_archive_ids, "candidate_archive_ids")
  const audit = input.audit == null ? null : compileFundingCoverageAudit(input.audit)
  if (status === "missing" && (audit != null || candidateIds.length !== 0)) {
    throw new Error("missing funding resolution carries evidence")
  }
  if (status === "ready" && (audit == null || candidateIds.length !== 1 || candidateIds[0] !== audit.source.ref)) {
    throw new Error("ready funding resolution is incomplete")
  }
  if (status === "conflict" && (audit != null || candidateIds.length < 2)) {
    throw new Error("conflict funding resolution is incomplete")
  }
  return { status, audit, candidate_archive_ids: candidateIds }
}

function identifier(value: unknown, field: string): string {
  if (typeof value !== "string"
      || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,255}$/.test(value)) {
    throw new Error(`${field} is invalid`)
  }
  return value
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object`)
  return value as Record<string, unknown>
}

function oneOf<const T extends readonly string[]>(value: unknown, allowed: T, field: string): T[number] {
  if (typeof value !== "string" || !allowed.includes(value as T[number])) throw new Error(`${field} is unsupported`)
  return value as T[number]
}

function sortedUniqueStrings(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length > 3) throw new Error(`${field} must be a bounded array`)
  const values = value.map((item) => {
    if (typeof item !== "string" || item.length < 1 || item.length > 256) throw new Error(`${field} is invalid`)
    return item
  })
  if (new Set(values).size !== values.length || values.some((item, index) => index > 0 && values[index - 1]! > item)) {
    throw new Error(`${field} must be sorted and unique`)
  }
  return values
}
