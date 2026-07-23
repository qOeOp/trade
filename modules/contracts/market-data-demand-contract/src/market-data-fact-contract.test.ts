import assert from "node:assert/strict"
import test from "node:test"
import { buildMarketDataFactRef, compileMarketDataFactRef } from "./market-data-fact-contract"

const HASH = "a".repeat(64)

test("market data fact ref binds exact consumer demands, source, coverage, and freshness without authority", () => {
  const fact = buildMarketDataFactRef({
    product: "l2_book",
    venue: "binance_usdm",
    symbol: "BTCUSDT",
    requirement: { timeframe: null, indicator_set_ref: null, minimum_depth: 20 },
    consumer_binding: { demand_ids: ["demand-a", "demand-b"], source_plan_hash: HASH },
    source: { ref: "l2-book://BTCUSDT/epoch-1/42", content_hash: "b".repeat(64) },
    coverage: {
      kind: "point",
      start_at: "2026-07-23T10:00:00.000Z",
      end_at: null,
      completeness: "live_point",
    },
    freshness: {
      kind: "live",
      as_of: "2026-07-23T10:00:00.000Z",
      observed_at: "2026-07-23T10:00:00.500Z",
      max_freshness_ms: 1_000,
      status: "fresh",
    },
  })
  assert.deepEqual(compileMarketDataFactRef(fact), fact)
  assert.equal(fact.domain_authority, "none")
  assert.match(fact.fact_hash, /^[a-f0-9]{64}$/)
})

test("historical market data fact requires immutable complete half-open coverage", () => {
  const fact = buildMarketDataFactRef({
    product: "indicator_set",
    venue: "binance_usdm",
    symbol: "ETHUSDT",
    requirement: {
      timeframe: "1h",
      indicator_set_ref: "indicator-set:technical-default-v1",
      minimum_depth: null,
    },
    consumer_binding: { demand_ids: ["research-1"], source_plan_hash: HASH },
    source: { ref: "market-feature://artifact", content_hash: "c".repeat(64) },
    coverage: {
      kind: "half_open",
      start_at: "2026-07-01T00:00:00.000Z",
      end_at: "2026-07-02T00:00:00.000Z",
      completeness: "complete",
    },
    freshness: {
      kind: "immutable",
      as_of: "2026-07-02T00:00:00.000Z",
      observed_at: "2026-07-23T10:00:00.000Z",
      max_freshness_ms: null,
      status: "not_applicable",
    },
  })
  assert.deepEqual(compileMarketDataFactRef(fact), fact)
  assert.throws(() => compileMarketDataFactRef({
    ...fact,
    consumer_binding: { ...fact.consumer_binding, demand_ids: ["z", "a"] },
  }), /sorted and unique/)
  assert.throws(() => compileMarketDataFactRef({
    ...fact,
    freshness: { ...fact.freshness, kind: "live", max_freshness_ms: 1_000, status: "fresh" },
  }), /exceeds|historical/)
  assert.throws(() => compileMarketDataFactRef({ ...fact, fact_hash: "d".repeat(64) }), /hash drifted/)
})
