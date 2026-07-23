import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import test from "node:test"
import { buildMarketDataDemand } from "../../../../contracts/market-data-demand-contract/src/market-data-demand-contract"
import {
  MARKET_DATA_DEMAND_RELEASE_SCHEMA,
  ensureMarketDataDemandRegistrySchema,
  readMarketDataDemand,
  reconcileRegisteredMarketDataDemands,
  registerMarketDataDemand,
  releaseMarketDataDemand,
} from "./market-data-demand-registry"

test("registry creates or reuses exact demand and rejects identity drift", () => {
  const db = new Database(":memory:")
  ensureMarketDataDemandRegistrySchema(db)
  const demand = fixture()
  try {
    assert.equal(registerMarketDataDemand(db, demand, "2026-07-23T00:00:01.000Z"), "created")
    assert.equal(registerMarketDataDemand(db, demand, "2026-07-23T00:00:02.000Z"), "existing")
    const conflicting = fixture({ subject_ref: "setup:other" })
    assert.throws(() => registerMarketDataDemand(db, conflicting), /different content/)
    assert.equal(readMarketDataDemand(db, demand.demand_id)?.status, "active")
  } finally {
    db.close()
  }
})

test("registry releases only exact demand hash and cannot reactivate terminal identity", () => {
  const db = new Database(":memory:")
  ensureMarketDataDemandRegistrySchema(db)
  const demand = fixture()
  const release = {
    schema_version: MARKET_DATA_DEMAND_RELEASE_SCHEMA,
    demand_id: demand.demand_id,
    demand_hash: demand.demand_hash,
    released_at: "2026-07-23T00:30:00.000Z",
    reason: "subject_cancelled" as const,
  }
  try {
    registerMarketDataDemand(db, demand, "2026-07-23T00:00:01.000Z")
    assert.throws(() => releaseMarketDataDemand(db, { ...release, demand_hash: "0".repeat(64) }), /hash mismatch/)
    assert.equal(releaseMarketDataDemand(db, release), "released")
    assert.equal(releaseMarketDataDemand(db, release), "existing")
    assert.throws(() => releaseMarketDataDemand(db, { ...release, reason: "superseded" }), /different terminal/)
    assert.equal(readMarketDataDemand(db, demand.demand_id)?.release?.reason, "subject_cancelled")
    assert.equal(registerMarketDataDemand(db, demand), "existing")
  } finally {
    db.close()
  }
})

test("owner reconciliation excludes released demand and returns deterministic no-authority plan", () => {
  const db = new Database(":memory:")
  ensureMarketDataDemandRegistrySchema(db)
  const btc = fixture()
  const eth = fixture({ demand_id: "research-eth", symbol: "ETHUSDT", priority: "research", consumer_kind: "research" })
  try {
    registerMarketDataDemand(db, btc, "2026-07-23T00:00:01.000Z")
    registerMarketDataDemand(db, eth, "2026-07-23T00:00:01.000Z")
    releaseMarketDataDemand(db, {
      schema_version: MARKET_DATA_DEMAND_RELEASE_SCHEMA,
      demand_id: eth.demand_id,
      demand_hash: eth.demand_hash,
      released_at: "2026-07-23T00:05:00.000Z",
      reason: "consumer_completed",
    })
    const first = reconcileRegisteredMarketDataDemands(db, {
      observed_at: "2026-07-23T00:10:00.000Z",
      max_symbols: 1,
    })
    const second = reconcileRegisteredMarketDataDemands(db, {
      observed_at: "2026-07-23T00:10:00.000Z",
      max_symbols: 1,
    })
    assert.equal(first.plan_hash, second.plan_hash)
    assert.deepEqual(first.active_demand_ids, [btc.demand_id])
    assert.deepEqual(first.selected_symbols, ["BTCUSDT"])
    assert.equal(first.lifecycle_authority, "none")
  } finally {
    db.close()
  }
})

function fixture(overrides: Record<string, unknown> = {}) {
  return buildMarketDataDemand({
    demand_id: "runtime-btc",
    consumer_owner: "trade-flow",
    consumer_kind: "runtime",
    subject_ref: "setup:btc",
    venue: "binance_usdm",
    symbol: "BTCUSDT",
    priority: "active_plan",
    requirements: [{
      product: "l2_book",
      timeframe: null,
      indicator_set_ref: null,
      coverage_start: null,
      coverage_end: null,
      max_freshness_ms: 1_000,
      minimum_depth: 20,
    }],
    lease: {
      issued_at: "2026-07-23T00:00:00.000Z",
      expires_at: "2026-07-23T01:00:00.000Z",
      renewal_grace_ms: 0,
    },
    ...overrides,
  } as Parameters<typeof buildMarketDataDemand>[0])
}
