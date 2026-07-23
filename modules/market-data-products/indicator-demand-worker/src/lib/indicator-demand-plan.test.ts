import assert from "node:assert/strict"
import test from "node:test"
import {
  buildMarketDataDemand,
  reconcileMarketDataDemands,
  type MarketDataRequirement,
} from "../../../../contracts/market-data-demand-contract/src/market-data-demand-contract"
import { buildIndicatorDemandTargets } from "./indicator-demand-plan"

test("indicator target requires and binds a compatible explicit OHLCV demand", () => {
  const result = buildIndicatorDemandTargets(plan([ohlcv(), indicator()]))
  assert.equal(result.targets.length, 1)
  assert.equal(result.targets[0]?.feature_set_ref, "indicator-set:technical-default-v1")
  assert.equal(new Date(result.targets[0]!.end_open_time).toISOString(), "2026-07-23T09:00:00.000Z")
  assert.throws(() => buildIndicatorDemandTargets(plan([indicator()])), /no compatible OHLCV demand/)
})

function plan(requirements: MarketDataRequirement[]) {
  return reconcileMarketDataDemands({
    demands: [buildMarketDataDemand({
      demand_id: "features-btc",
      consumer_owner: "runtime-features",
      consumer_kind: "runtime",
      subject_ref: "market-watch:symbol/BTCUSDT",
      venue: "binance_usdm",
      symbol: "BTCUSDT",
      priority: "active_plan",
      requirements,
      lease: {
        issued_at: "2026-07-23T00:00:00.000Z",
        expires_at: "2026-07-24T00:00:00.000Z",
        renewal_grace_ms: 0,
      },
    })],
    observed_at: "2026-07-23T10:30:00.000Z",
    max_symbols: 20,
  })
}

function ohlcv(): MarketDataRequirement {
  return {
    product: "ohlcv",
    timeframe: "1h",
    indicator_set_ref: null,
    coverage_start: "2026-07-20T00:00:00.000Z",
    coverage_end: null,
    max_freshness_ms: 60_000,
    minimum_depth: null,
  }
}

function indicator(): MarketDataRequirement {
  return {
    product: "indicator_set",
    timeframe: "1h",
    indicator_set_ref: "indicator-set:technical-default-v1",
    coverage_start: "2026-07-20T00:00:00.000Z",
    coverage_end: null,
    max_freshness_ms: 60_000,
    minimum_depth: null,
  }
}
