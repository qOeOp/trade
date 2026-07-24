import assert from "node:assert/strict"
import test from "node:test"
import {
  buildMarketDataDemand,
  buildMarketDataDemandV2,
  compileMarketDataDemand,
  compileMarketDataSubscriptionPlan,
  reconcileMarketDataDemands,
  type MarketDataDemand,
} from "./market-data-demand-contract"

test("demand is closed-world, self-hashed, bounded, and grants no domain authority", () => {
  const demand = buildDemand()
  assert.equal(compileMarketDataDemand(demand).demand_hash, demand.demand_hash)
  assert.equal(demand.domain_authority, "none")
  assert.throws(() => compileMarketDataDemand({ ...demand, endpoint: "ws://override" }), /does not allow/)
  assert.throws(() => compileMarketDataDemand({ ...demand, demand_hash: "0".repeat(64) }), /hash mismatch/)
  assert.throws(() => buildDemand({
    priority: "research",
    consumer_kind: "execution_defense",
  }), /defensive_exposure priority requires/)
  assert.throws(() => buildDemand({
    priority: "research",
    consumer_kind: "research",
    lease: {
      issued_at: "2026-07-23T00:00:00.000Z",
      expires_at: "2026-07-23T01:00:00.000Z",
      renewal_grace_ms: 1,
    },
  }), /only defensive_exposure/)
  const rolling = buildDemand({
    requirements: [{
      product: "ohlcv",
      timeframe: "1h",
      indicator_set_ref: null,
      coverage_start: null,
      coverage_end: null,
      max_freshness_ms: 60_000,
      minimum_depth: null,
    }],
  })
  assert.equal(rolling.requirements[0]?.coverage_start, null)
  const rollingFrom = buildDemand({
    requirements: [{
      product: "ohlcv",
      timeframe: "1h",
      indicator_set_ref: null,
      coverage_start: "2026-01-01T00:00:00.000Z",
      coverage_end: null,
      max_freshness_ms: 60_000,
      minimum_depth: null,
    }],
  })
  assert.equal(rollingFrom.requirements[0]?.coverage_end, null)
  assert.throws(() => buildDemand({
    requirements: [ohlcv("1h", null as unknown as string, "2026-01-02T00:00:00.000Z", 60_000)],
  }), /historical product shape/)
})

test("reconciliation merges strict requirements and prioritizes active exposure under capacity", () => {
  const research = buildDemand({
    demand_id: "research-eth",
    symbol: "ETHUSDT",
    priority: "research",
    consumer_kind: "research",
    requirements: [ohlcv("4h", "2026-01-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z", 60_000)],
  })
  const candidate = buildDemand({
    demand_id: "candidate-btc",
    priority: "opportunity_candidate",
    requirements: [ohlcv("4h", "2025-01-01T00:00:00.000Z", "2026-07-10T00:00:00.000Z", 30_000)],
  })
  const defensive = buildDemand({
    demand_id: "defensive-btc",
    priority: "defensive_exposure",
    consumer_kind: "execution_defense",
    subject_ref: "flow:btc-live",
    requirements: [ohlcv("4h", "2026-01-01T00:00:00.000Z", "2026-07-20T00:00:00.000Z", 5_000)],
    lease: {
      issued_at: "2026-07-23T00:00:00.000Z",
      expires_at: "2026-07-23T00:30:00.000Z",
      renewal_grace_ms: 600_000,
    },
  })
  const plan = reconcileMarketDataDemands({
    demands: [research, candidate, defensive],
    observed_at: "2026-07-23T00:10:00.000Z",
    max_symbols: 1,
  })
  assert.equal(plan.status, "ready")
  assert.deepEqual(plan.selected_symbols, ["BTCUSDT"])
  assert.deepEqual(plan.deferred_demand_ids, ["research-eth"])
  const subscription = plan.subscriptions[0]!
  assert.equal(subscription.priority, "defensive_exposure")
  assert.equal(subscription.coverage_start, "2025-01-01T00:00:00.000Z")
  assert.equal(subscription.coverage_end, "2026-07-20T00:00:00.000Z")
  assert.equal(subscription.max_freshness_ms, 5_000)
  assert.deepEqual(subscription.demand_ids, ["candidate-btc", "defensive-btc"])
  assert.equal(plan.lifecycle_authority, "none")
})

test("defensive expiry enters bounded grace and defensive over-capacity fails closed", () => {
  const grace = buildDemand({
    demand_id: "defensive-btc",
    priority: "defensive_exposure",
    consumer_kind: "execution_defense",
    lease: {
      issued_at: "2026-07-23T00:00:00.000Z",
      expires_at: "2026-07-23T00:10:00.000Z",
      renewal_grace_ms: 600_000,
    },
  })
  const second = buildDemand({
    demand_id: "defensive-eth",
    symbol: "ETHUSDT",
    priority: "defensive_exposure",
    consumer_kind: "execution_defense",
    lease: {
      issued_at: "2026-07-23T00:00:00.000Z",
      expires_at: "2026-07-23T00:30:00.000Z",
      renewal_grace_ms: 600_000,
    },
  })
  const blocked = reconcileMarketDataDemands({
    demands: [second, grace],
    observed_at: "2026-07-23T00:15:00.000Z",
    max_symbols: 1,
  })
  assert.equal(blocked.status, "capacity_blocked")
  assert.deepEqual(blocked.selected_symbols, [])
  assert.deepEqual(blocked.grace_demand_ids, ["defensive-btc"])
  assert.equal(blocked.attentions.some((item) => item.reason === "defensive_lease_expired_in_grace"), true)
  assert.equal(blocked.attentions.filter((item) => item.reason === "defensive_capacity_insufficient").length, 2)

  const expired = reconcileMarketDataDemands({
    demands: [grace],
    observed_at: "2026-07-23T00:21:00.001Z",
    max_symbols: 1,
  })
  assert.deepEqual(expired.expired_demand_ids, ["defensive-btc"])
  assert.deepEqual(expired.subscriptions, [])
})

test("same demand identity is idempotent but conflicting content fails closed", () => {
  const demand = buildDemand()
  assert.deepEqual(
    reconcileMarketDataDemands({
      demands: [demand, demand],
      observed_at: "2026-07-23T00:10:00.000Z",
      max_symbols: 1,
    }).active_demand_ids,
    [demand.demand_id],
  )
  const conflicting = buildDemand({ requirements: [l2(50)] })
  assert.throws(() => reconcileMarketDataDemands({
    demands: [demand, conflicting],
    observed_at: "2026-07-23T00:10:00.000Z",
    max_symbols: 1,
  }), /identity conflict/)
})

test("subscription plan is self-authenticating and rejects authority or lifecycle-set drift", () => {
  const plan = reconcileMarketDataDemands({
    demands: [buildDemand()],
    observed_at: "2026-07-23T00:10:00.000Z",
    max_symbols: 1,
  })
  assert.equal(compileMarketDataSubscriptionPlan(plan).plan_hash, plan.plan_hash)
  assert.throws(() => compileMarketDataSubscriptionPlan({
    ...plan,
    lifecycle_authority: "start_process",
  }), /must not grant lifecycle authority/)
  assert.throws(() => compileMarketDataSubscriptionPlan({
    ...plan,
    active_demand_ids: [],
  }), /not eligible/)
  assert.throws(() => compileMarketDataSubscriptionPlan({
    ...plan,
    plan_hash: "0".repeat(64),
  }), /plan_hash mismatch/)
})

test("v2 adds exact-window funding demand without rewriting v1", () => {
  const funding = buildMarketDataDemandV2({
    demand_id: "research-btc-funding",
    consumer_owner: "rd-forward",
    consumer_kind: "research",
    subject_ref: "forward:btc-1",
    venue: "binance_usdm",
    symbol: "BTCUSDT",
    priority: "research",
    requirements: [{
      product: "funding_events",
      timeframe: null,
      indicator_set_ref: null,
      coverage_start: "2026-07-01T00:00:00.000Z",
      coverage_end: "2026-07-23T00:00:00.000Z",
      max_freshness_ms: 60_000,
      minimum_depth: null,
    }],
    lease: {
      issued_at: "2026-07-23T00:00:00.000Z",
      expires_at: "2026-07-23T01:00:00.000Z",
      renewal_grace_ms: 0,
    },
  })
  const plan = reconcileMarketDataDemands({
    demands: [funding],
    observed_at: "2026-07-23T00:10:00.000Z",
    max_symbols: 1,
  })
  assert.equal(funding.schema_version, "trade.market-data-demand.v2")
  assert.equal(plan.schema_version, "trade.market-data-subscription-plan.v2")
  assert.equal(plan.subscriptions[0]?.product, "funding_events")
  assert.equal(compileMarketDataSubscriptionPlan(plan).plan_hash, plan.plan_hash)
  assert.throws(() => compileMarketDataDemand({
    ...funding,
    schema_version: "trade.market-data-demand.v1",
  }), /product is unsupported/)
})

function buildDemand(overrides: Partial<Omit<MarketDataDemand, "schema_version" | "domain_authority" | "demand_hash">> = {}) {
  return buildMarketDataDemand({
    demand_id: "runtime-btc",
    consumer_owner: "trade-flow",
    consumer_kind: "runtime",
    subject_ref: "setup:btc-1",
    venue: "binance_usdm",
    symbol: "BTCUSDT",
    priority: "active_plan",
    requirements: [l2(20)],
    lease: {
      issued_at: "2026-07-23T00:00:00.000Z",
      expires_at: "2026-07-23T01:00:00.000Z",
      renewal_grace_ms: 0,
    },
    ...overrides,
  })
}

function l2(depth: number) {
  return {
    product: "l2_book" as const,
    timeframe: null,
    indicator_set_ref: null,
    coverage_start: null,
    coverage_end: null,
    max_freshness_ms: 1_000,
    minimum_depth: depth,
  }
}

function ohlcv(timeframe: string, start: string, end: string, freshness: number) {
  return {
    product: "ohlcv" as const,
    timeframe,
    indicator_set_ref: null,
    coverage_start: start,
    coverage_end: end,
    max_freshness_ms: freshness,
    minimum_depth: null,
  }
}
