import assert from "node:assert/strict"
import test from "node:test"
import {
  buildMarketDataDemand,
  reconcileMarketDataDemands,
} from "../../../../contracts/market-data-demand-contract/src/market-data-demand-contract"
import { buildOhlcvCoverageAuditFixture } from "../../../../contracts/market-data-demand-contract/src/ohlcv-coverage-test-fixtures"
import { buildOhlcvCoverageTargets, buildOhlcvDemandSyncPlan } from "./ohlcv-demand-plan"

test("OHLCV targets use half-open requested coverage and latest closed candle", () => {
  const historical = source("2026-07-23T10:30:00.000Z", "2026-07-20T00:00:00.000Z", "2026-07-23T08:00:00.000Z")
  const targets = buildOhlcvCoverageTargets(historical).targets
  assert.deepEqual(targets.map((target) => ({
    start: new Date(target.start_open_time).toISOString(),
    end: new Date(target.end_open_time).toISOString(),
  })), [{ start: "2026-07-20T00:00:00.000Z", end: "2026-07-23T07:00:00.000Z" }])

  const live = source("2026-07-23T10:30:00.000Z", null, null)
  const liveTarget = buildOhlcvCoverageTargets(live).targets[0]!
  assert.equal(new Date(liveTarget.start_open_time).toISOString(), "2026-07-23T09:00:00.000Z")
  assert.equal(liveTarget.start_open_time, liveTarget.end_open_time)
})

test("OHLCV plan fills the first exact owner-audited gap and skips complete targets", () => {
  const plan = source("2026-07-23T10:30:00.000Z", "2026-07-23T05:00:00.000Z", null)
  const target = buildOhlcvCoverageTargets(plan).targets[0]!
  const missing = buildOhlcvCoverageAuditFixture(target, plan.observed_at)
  const sync = buildOhlcvDemandSyncPlan({ source_plan: plan, coverage_audits: [missing], max_rows_per_job: 3 })
  assert.equal(sync.fetch_jobs.length, 1)
  assert.equal(sync.fetch_jobs[0]?.since_ts, target.start_open_time)
  assert.equal(sync.fetch_jobs[0]?.limit, 3)
  assert.equal(sync.fetch_jobs[0]?.lifecycle_authority, "proposal_only")
  assert.match(sync.plan_hash, /^[a-f0-9]{64}$/)
})

function source(observedAt: string, coverageStart: string | null, coverageEnd: string | null) {
  return reconcileMarketDataDemands({
    demands: [buildMarketDataDemand({
      demand_id: "research-btc-1h",
      consumer_owner: "rd-program",
      consumer_kind: "research",
      subject_ref: "research_state_store:rd_program/rd-program",
      venue: "binance_usdm",
      symbol: "BTCUSDT",
      priority: "research",
      requirements: [{
        product: "ohlcv",
        timeframe: "1h",
        indicator_set_ref: null,
        coverage_start: coverageStart,
        coverage_end: coverageEnd,
        max_freshness_ms: 60_000,
        minimum_depth: null,
      }],
      lease: {
        issued_at: "2026-07-23T00:00:00.000Z",
        expires_at: "2026-07-24T00:00:00.000Z",
        renewal_grace_ms: 0,
      },
    })],
    observed_at: observedAt,
    max_symbols: 20,
  })
}
