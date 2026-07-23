import assert from "node:assert/strict"
import test from "node:test"
import {
  buildMarketDataDemand,
  reconcileMarketDataDemands,
} from "../../../../contracts/market-data-demand-contract/src/market-data-demand-contract"
import { buildOhlcvCoverageAuditFixture } from "../../../../contracts/market-data-demand-contract/src/ohlcv-coverage-test-fixtures"
import { runOhlcvDemandCycle } from "./worker-cycle"

test("OHLCV demand cycle audits before issuing one bounded gap fill", async () => {
  const observedAt = "2026-07-23T10:30:00.000Z"
  const source = plan(observedAt)
  const calls: string[] = []
  const result = await runOhlcvDemandCycle({
    observed_at: observedAt,
    max_jobs: 1,
    max_rows_per_job: 2,
  }, {
    read_subscription_plan: async () => source,
    audit_coverage: async (target) => {
      calls.push(`audit:${target.target_id}`)
      return buildOhlcvCoverageAuditFixture(target, observedAt)
    },
    fetch_gap: async (job) => {
      calls.push(`fetch:${job.symbol}:${job.timeframe}:${job.limit}`)
      return { ok: true, reason: "owner_fetch_completed" }
    },
  })
  assert.equal(result.status, "completed")
  assert.equal(result.planned_job_count, 1)
  assert.equal(result.executed_job_count, 1)
  assert.equal(result.failed_job_count, 0)
  assert.deepEqual(calls, ["audit:ohlcv:BTCUSDT:1h", "fetch:BTCUSDT:1h:2"])
})

test("OHLCV demand cycle surfaces owner fetch failure without advancing coverage", async () => {
  const observedAt = "2026-07-23T10:30:00.000Z"
  const source = plan(observedAt)
  const result = await runOhlcvDemandCycle({
    observed_at: observedAt,
    max_jobs: 1,
    max_rows_per_job: 10,
  }, {
    read_subscription_plan: async () => source,
    audit_coverage: async (target) => buildOhlcvCoverageAuditFixture(target, observedAt),
    fetch_gap: async () => ({ ok: false, reason: "public_api_timeout" }),
  })
  assert.equal(result.status, "degraded")
  assert.equal(result.failed_job_count, 1)
  assert.equal(result.lifecycle_authority, "market_data_owner")
})

test("OHLCV demand cycle emits an owner-audited fact only after exact coverage closes", async () => {
  const observedAt = "2026-07-23T10:30:00.000Z"
  const source = plan(observedAt)
  const result = await runOhlcvDemandCycle({
    observed_at: observedAt,
    max_jobs: 1,
    max_rows_per_job: 10,
  }, {
    read_subscription_plan: async () => source,
    audit_coverage: async (target) => buildOhlcvCoverageAuditFixture(target, observedAt, true),
    fetch_gap: async () => {
      throw new Error("complete coverage must not fetch")
    },
  })
  assert.equal(result.complete_target_count, 1)
  assert.equal(result.facts.length, 1)
  assert.equal(result.facts[0]?.product, "ohlcv")
  assert.deepEqual(result.facts[0]?.consumer_binding.demand_ids, ["research-btc-rolling"])
})

function plan(observedAt: string) {
  return reconcileMarketDataDemands({
    demands: [buildMarketDataDemand({
      demand_id: "research-btc-rolling",
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
        coverage_start: "2026-07-23T05:00:00.000Z",
        coverage_end: null,
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
