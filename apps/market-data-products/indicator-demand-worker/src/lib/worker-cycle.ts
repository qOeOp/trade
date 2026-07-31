import { canonicalHash } from "../../../../contracts/runtime-core/src/canonical-json"
import {
  buildIndicatorFeatureArtifact,
  indicatorProviderArgs,
  type IndicatorFeatureArtifact,
} from "../../../../contracts/market-data-demand-contract/src/indicator-feature-contract"
import {
  compileOhlcvCoverageAudit,
  timeframeMilliseconds,
} from "../../../../contracts/market-data-demand-contract/src/ohlcv-coverage-contract"
import {
  buildMarketDataFactRef,
  type MarketDataFactRef,
} from "../../../../contracts/market-data-demand-contract/src/market-data-fact-contract"
import { buildIndicatorDemandTargets, type IndicatorDemandTarget } from "./indicator-demand-plan"

export type IndicatorSourceSlice = IndicatorFeatureArtifact["source"] & { manifest_path: string }

export interface IndicatorDemandWorkerDependencies {
  read_subscription_plan: (observedAt: string) => Promise<unknown>
  audit_coverage: (target: IndicatorDemandTarget, observedAt: string) => Promise<unknown>
  export_slice: (target: IndicatorDemandTarget, observedAt: string) => Promise<IndicatorSourceSlice>
  read_existing_feature: (
    target: IndicatorDemandTarget,
    source: IndicatorSourceSlice,
  ) => Promise<{ content_hash: string; source_ref: string } | null>
  run_provider: (target: IndicatorDemandTarget, source: IndicatorSourceSlice, args: string[]) => Promise<unknown>
  admit_artifact: (
    target: IndicatorDemandTarget,
    source: IndicatorSourceSlice,
    artifact: IndicatorFeatureArtifact,
    observedAt: string,
  ) => Promise<"created" | "existing">
}

export interface IndicatorDemandCycleResult {
  schema_version: "trade.indicator-demand-cycle-result.v1"
  observed_at: string
  status: "completed" | "degraded"
  source_plan_hash: string
  cycle_plan_hash: string
  target_count: number
  source_incomplete_count: number
  computed_count: number
  existing_count: number
  failed_count: number
  deferred_count: number
  facts: MarketDataFactRef[]
  outcomes: Array<{
    target_id: string
    status: "source_incomplete" | "created" | "existing" | "failed"
    artifact_hash: string
    reason: string
  }>
  lifecycle_authority: "market_data_owner"
}

export async function runIndicatorDemandCycle(
  input: { observed_at: string; max_jobs: number; max_bars: number },
  dependencies: IndicatorDemandWorkerDependencies,
): Promise<IndicatorDemandCycleResult> {
  canonicalTime(input.observed_at)
  integer(input.max_jobs, 1, 20, "max_jobs")
  integer(input.max_bars, 1, 50_000, "max_bars")
  const sourceValue = await dependencies.read_subscription_plan(input.observed_at)
  const { source, targets } = buildIndicatorDemandTargets(sourceValue)
  const outcomes: IndicatorDemandCycleResult["outcomes"] = []
  const facts: MarketDataFactRef[] = []
  const ready: IndicatorDemandTarget[] = []
  for (const target of targets) {
    const audit = compileOhlcvCoverageAudit(await dependencies.audit_coverage(target, input.observed_at))
    const expectedCount = ((target.end_open_time - target.start_open_time) / audit.timeframe_ms) + 1
    if (audit.observed_at !== input.observed_at
      || audit.symbol !== target.symbol
      || audit.timeframe !== target.timeframe
      || audit.requested_open_range.start_open_time !== target.start_open_time
      || audit.requested_open_range.end_open_time !== target.end_open_time) {
      throw new Error(`indicator source audit target drifted: ${target.target_id}`)
    }
    if (!audit.complete || expectedCount > input.max_bars) {
      outcomes.push({
        target_id: target.target_id,
        status: "source_incomplete",
        artifact_hash: "",
        reason: expectedCount > input.max_bars ? "source_range_exceeds_max_bars" : "source_coverage_incomplete",
      })
      continue
    }
    ready.push(target)
  }
  const selected = ready.slice(0, input.max_jobs)
  for (const target of selected) {
    try {
      const sourceSlice = await dependencies.export_slice(target, input.observed_at)
      validateSourceSlice(target, sourceSlice)
      const existing = await dependencies.read_existing_feature(target, sourceSlice)
      if (existing != null) {
        outcomes.push({
          target_id: target.target_id,
          status: "existing",
          artifact_hash: existing.content_hash,
          reason: "same_source_and_feature_set_already_admitted",
        })
        facts.push(buildFeatureFact(target, source.plan_hash, existing.source_ref, existing.content_hash, input.observed_at))
        continue
      }
      const providerReport = await dependencies.run_provider(
        target,
        sourceSlice,
        indicatorProviderArgs(target.feature_set_ref),
      )
      const {
        manifest_path: _manifestPath,
        ...artifactSource
      } = sourceSlice
      const artifact = buildIndicatorFeatureArtifact({
        feature_set_ref: target.feature_set_ref,
        source: artifactSource,
        provider_report: providerReport,
      })
      const admitted = await dependencies.admit_artifact(target, sourceSlice, artifact, input.observed_at)
      outcomes.push({
        target_id: target.target_id,
        status: admitted,
        artifact_hash: artifact.content_hash,
        reason: "deterministic_feature_artifact_admitted",
      })
      facts.push(buildFeatureFact(
        target,
        source.plan_hash,
        `market-feature://indicator-feature:${artifact.content_hash}`,
        artifact.content_hash,
        input.observed_at,
      ))
    } catch (error) {
      outcomes.push({
        target_id: target.target_id,
        status: "failed",
        artifact_hash: "",
        reason: classifyFailure(error),
      })
    }
  }
  const failedCount = outcomes.filter((outcome) => outcome.status === "failed").length
  const sourceIncompleteCount = outcomes.filter((outcome) => outcome.status === "source_incomplete").length
  const cyclePlanHash = canonicalHash({
    observed_at: input.observed_at,
    source_plan_hash: source.plan_hash,
    targets,
    selected_target_ids: selected.map((target) => target.target_id),
  })
  return {
    schema_version: "trade.indicator-demand-cycle-result.v1",
    observed_at: input.observed_at,
    status: failedCount === 0 ? "completed" : "degraded",
    source_plan_hash: source.plan_hash,
    cycle_plan_hash: cyclePlanHash,
    target_count: targets.length,
    source_incomplete_count: sourceIncompleteCount,
    computed_count: outcomes.filter((outcome) => outcome.status === "created").length,
    existing_count: outcomes.filter((outcome) => outcome.status === "existing").length,
    failed_count: failedCount,
    deferred_count: Math.max(0, ready.length - selected.length),
    facts: facts.sort((left, right) => left.fact_hash.localeCompare(right.fact_hash)),
    outcomes,
    lifecycle_authority: "market_data_owner",
  }
}

function buildFeatureFact(
  target: IndicatorDemandTarget,
  sourcePlanHash: string,
  sourceRef: string,
  contentHash: string,
  observedAt: string,
): MarketDataFactRef {
  const endExclusive = target.end_open_time + timeframeMilliseconds(target.timeframe)
  return buildMarketDataFactRef({
    product: "indicator_set",
    venue: "binance_usdm",
    symbol: target.symbol,
    requirement: {
      timeframe: target.timeframe,
      indicator_set_ref: target.feature_set_ref,
      minimum_depth: null,
    },
    consumer_binding: {
      demand_ids: target.demand_ids,
      source_plan_hash: sourcePlanHash,
    },
    source: {
      ref: sourceRef,
      content_hash: contentHash,
    },
    coverage: {
      kind: "half_open",
      start_at: new Date(target.start_open_time).toISOString(),
      end_at: new Date(endExclusive).toISOString(),
      completeness: "complete",
    },
    freshness: {
      kind: "immutable",
      as_of: new Date(endExclusive).toISOString(),
      observed_at: observedAt,
      max_freshness_ms: null,
      status: "not_applicable",
    },
  })
}

function validateSourceSlice(target: IndicatorDemandTarget, source: IndicatorSourceSlice): void {
  if (source.symbol !== target.symbol || source.timeframe !== target.timeframe
    || source.first_open_time !== target.start_open_time || source.last_open_time !== target.end_open_time
    || source.slice_ref !== `market-data://candle-slice/${source.content_sha256}`
    || !/^[a-f0-9]{64}$/.test(source.content_sha256)
    || source.manifest_path.startsWith("/") || source.manifest_path.includes("../")) {
    throw new Error("indicator source slice identity drifted")
  }
}

function classifyFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/provider/i.test(message)) return "indicator_provider_failed"
  if (/artifact|content_hash|admit/i.test(message)) return "feature_artifact_failed"
  if (/slice|source/i.test(message)) return "source_slice_failed"
  return "feature_worker_failed"
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
