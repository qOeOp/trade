import assert from "node:assert/strict"
import test from "node:test"
import {
  buildMarketDataDemand,
  reconcileMarketDataDemands,
} from "../../../../contracts/market-data-demand-contract/src/market-data-demand-contract"
import { buildOhlcvCoverageAuditFixture } from "../../../../contracts/market-data-demand-contract/src/ohlcv-coverage-test-fixtures"
import { runIndicatorDemandCycle } from "./worker-cycle"

test("indicator cycle computes and admits only after exact zero-gap source audit", async () => {
  const observedAt = "2026-07-23T10:30:00.000Z"
  const sourcePlan = plan(observedAt)
  let admittedHash = ""
  const result = await runIndicatorDemandCycle({
    observed_at: observedAt,
    max_jobs: 2,
    max_bars: 100,
  }, {
      read_subscription_plan: async () => sourcePlan,
      audit_coverage: async (target) => buildOhlcvCoverageAuditFixture(target, observedAt, true),
      export_slice: async (target) => ({
        slice_ref: `market-data://candle-slice/${"a".repeat(64)}`,
        content_sha256: "a".repeat(64),
        symbol: target.symbol,
        timeframe: target.timeframe,
        first_open_time: target.start_open_time,
        last_open_time: target.end_open_time,
        manifest_path: "data/artifacts/market-data/candle-slices/a/manifest.json",
      }),
      read_existing_feature: async () => null,
      run_provider: async (_target, _source, args) => {
        assert.deepEqual(args, ["--indicators", "all"])
        return {
          symbol: "BTC/USDT:USDT",
          selected_indicators: { ema: { function: "ema" } },
          timeframes: { "1h": { trend: "up", indicators: { ema: 1 } } },
          summary: { bias: "bullish" },
          generated_at: "ignored",
          source_manifest: "/ignored",
          summary_markdown: "ignored",
        }
      },
      admit_artifact: async (_target, _source, artifact) => {
        admittedHash = artifact.content_hash
        return "created"
      },
  })
  assert.equal(result.status, "completed")
  assert.equal(result.computed_count, 1)
  assert.match(admittedHash, /^[a-f0-9]{64}$/)
  assert.equal(result.facts.length, 1)
  assert.equal(result.facts[0]?.product, "indicator_set")
  assert.deepEqual(result.facts[0]?.consumer_binding.demand_ids, ["features-btc"])
  assert.equal(result.facts[0]?.source.content_hash, admittedHash)
})

test("indicator cycle does not invoke compute on incomplete source", async () => {
  const observedAt = "2026-07-23T10:30:00.000Z"
  let computed = false
  const result = await runIndicatorDemandCycle({
    observed_at: observedAt,
    max_jobs: 1,
    max_bars: 100,
  }, {
      read_subscription_plan: async () => plan(observedAt),
      audit_coverage: async (target) => buildOhlcvCoverageAuditFixture(target, observedAt),
      export_slice: async () => { throw new Error("must not export") },
      read_existing_feature: async () => null,
      run_provider: async () => { computed = true; return {} },
      admit_artifact: async () => "created",
  })
  assert.equal(result.source_incomplete_count, 1)
  assert.equal(computed, false)
  assert.equal(result.facts.length, 0)
})

test("indicator cycle binds an existing admitted artifact to the same consumer fact contract", async () => {
  const observedAt = "2026-07-23T10:30:00.000Z"
  let computed = false
  const result = await runIndicatorDemandCycle({
    observed_at: observedAt,
    max_jobs: 1,
    max_bars: 100,
  }, {
    read_subscription_plan: async () => plan(observedAt),
    audit_coverage: async (target) => buildOhlcvCoverageAuditFixture(target, observedAt, true),
    export_slice: async (target) => ({
      slice_ref: `market-data://candle-slice/${"a".repeat(64)}`,
      content_sha256: "a".repeat(64),
      symbol: target.symbol,
      timeframe: target.timeframe,
      first_open_time: target.start_open_time,
      last_open_time: target.end_open_time,
      manifest_path: "data/artifacts/market-data/candle-slices/a/manifest.json",
    }),
    read_existing_feature: async () => ({
      content_hash: "b".repeat(64),
      source_ref: "market-feature://indicator-feature:existing",
    }),
    run_provider: async () => {
      computed = true
      return {}
    },
    admit_artifact: async () => "created",
  })
  assert.equal(computed, false)
  assert.equal(result.existing_count, 1)
  assert.equal(result.facts[0]?.source.content_hash, "b".repeat(64))
})

function plan(observedAt: string) {
  const common = {
    timeframe: "1h",
    coverage_start: "2026-07-23T08:00:00.000Z",
    coverage_end: null,
    max_freshness_ms: 60_000,
    minimum_depth: null,
  }
  return reconcileMarketDataDemands({
    demands: [buildMarketDataDemand({
      demand_id: "features-btc",
      consumer_owner: "runtime-features",
      consumer_kind: "runtime",
      subject_ref: "market-watch:symbol/BTCUSDT",
      venue: "binance_usdm",
      symbol: "BTCUSDT",
      priority: "active_plan",
      requirements: [
        { product: "ohlcv", indicator_set_ref: null, ...common },
        { product: "indicator_set", indicator_set_ref: "indicator-set:technical-default-v1", ...common },
      ],
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
