import assert from "node:assert/strict"
import test from "node:test"
import { buildMarketDataDemandV2, reconcileMarketDataDemands } from "../../../../contracts/market-data-demand-contract/src/market-data-demand-contract"
import { buildFundingCoverageAudit } from "../../../../contracts/market-data-demand-contract/src/funding-coverage-contract"
import { buildFundingCoverageTargets, buildFundingDemandSyncPlan } from "./funding-demand-plan"

test("funding targets require exact v2 windows and complete owner evidence emits a fact", () => {
  const source = sourcePlan()
  const { targets } = buildFundingCoverageTargets(source)
  assert.equal(targets.length, 1)
  const target = targets[0]!
  const audit = buildFundingCoverageAudit({
    venue: "binance_usdm",
    symbol: target.symbol,
    coverage: {
      start_at: target.coverage_start,
      end_at: target.coverage_end,
      completeness: "provider_page_exhaustion",
    },
    source: {
      capability: "binance_usdm_rest_funding_rate",
      ref: "funding-archive:BTCUSDT:a",
      content_hash: "a".repeat(64),
      page_receipts: [{
        page_ordinal: 0,
        requested_start_ms: Date.parse(target.coverage_start),
        requested_end_ms: Date.parse(target.coverage_end) - 1,
        row_count: 0,
        first_event_ms: null,
        last_event_ms: null,
        response_hash: "b".repeat(64),
      }],
      event_count: 0,
      events_hash: "c".repeat(64),
      external_authenticity: "not_verified",
    },
    audited_at: "2026-07-23T08:00:01.000Z",
  })
  const complete = buildFundingDemandSyncPlan({
    source_plan: source,
    resolutions: [{
      status: "ready",
      audit,
      candidate_archive_ids: [audit.source.ref],
    }],
  })
  assert.equal(complete.completed_facts[0]?.product, "funding_events")
  assert.equal(complete.completed_facts[0]?.domain_authority, "none")
  assert.equal(complete.fetch_jobs.length, 0)

  const missing = buildFundingDemandSyncPlan({
    source_plan: source,
    resolutions: [{ status: "missing", audit: null, candidate_archive_ids: [] }],
  })
  assert.equal(missing.fetch_jobs.length, 1)
  assert.equal(missing.fetch_jobs[0]?.lifecycle_authority, "proposal_only")
})

export function sourcePlan() {
  const demand = buildMarketDataDemandV2({
    demand_id: "rd-forward-funding-btc",
    consumer_owner: "rd-forward",
    consumer_kind: "research",
    subject_ref: "forward:source-1",
    venue: "binance_usdm",
    symbol: "BTCUSDT",
    priority: "research",
    requirements: [{
      product: "funding_events",
      timeframe: null,
      indicator_set_ref: null,
      coverage_start: "2026-07-22T00:00:00.000Z",
      coverage_end: "2026-07-23T08:00:00.000Z",
      max_freshness_ms: 60_000,
      minimum_depth: null,
    }],
    lease: {
      issued_at: "2026-07-23T00:00:00.000Z",
      expires_at: "2026-07-24T00:00:00.000Z",
      renewal_grace_ms: 0,
    },
  })
  return reconcileMarketDataDemands({
    demands: [demand],
    observed_at: "2026-07-23T08:00:00.000Z",
    max_symbols: 20,
  })
}
