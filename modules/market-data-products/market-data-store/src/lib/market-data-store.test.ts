import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import test from "node:test"
import {
  buildCanonicalCandles,
  buildFeatureManifest,
  buildFundingEvents,
  buildMarketManifest,
  ensureMarketDataSchema,
  listFeatureManifests,
  readFeatureManifest,
  readFundingEvents,
  readMarketManifest,
  upsertCanonicalCandles,
  upsertFeatureManifest,
  upsertFundingEvents,
  upsertMarketManifest,
} from "./market-data-store"

test("market data store records manifests and canonical rows", () => {
  const db = new Database(":memory:")
  ensureMarketDataSchema(db)
  try {
    upsertMarketManifest(db, buildMarketManifest({
      manifest_id: "ohlcv-btc-4h",
      dataset_kind: "ohlcv",
      source: "binance_klines",
      symbol: "BTCUSDT",
      timeframe: "4h",
      rows: 2,
      content_hash: "sha256:abc",
      manifest_path: "data/ohlcv/BTCUSDT-4h.manifest.json",
      freshness: { status: "fresh" },
    }))
    const inserted = upsertCanonicalCandles(db, buildCanonicalCandles([
      {
        manifest_id: "ohlcv-btc-4h",
        symbol: "BTCUSDT",
        timeframe: "4h",
        open_time: 1,
        close_time: 2,
        open: 10,
        high: 11,
        low: 9,
        close: 10.5,
        volume: 100,
      },
    ]))
    assert.equal(inserted, 1)
    const manifest = readMarketManifest(db, "ohlcv-btc-4h")
    assert.equal(manifest?.symbol, "BTCUSDT")
    assert.equal(manifest?.freshness_json?.status, "fresh")
    const candle = db.query("SELECT close FROM canonical_candle WHERE symbol='BTCUSDT'").get() as { close: number }
    assert.equal(candle.close, 10.5)
  } finally {
    db.close()
  }
})

test("market data store records funding events and feature manifests", () => {
  const db = new Database(":memory:")
  ensureMarketDataSchema(db)
  try {
    assert.equal(upsertFundingEvents(db, buildFundingEvents([
      {
        manifest_id: "funding-btc",
        symbol: "BTCUSDT",
        funding_time: 100,
        funding_rate: 0.0001,
        mark_price: 65000,
      },
    ])), 1)
    upsertFeatureManifest(db, buildFeatureManifest({
      feature_manifest_id: "features-btc-4h",
      source_manifest_id: "ohlcv-btc-4h",
      feature_set_id: "trend-v1",
      symbol: "BTCUSDT",
      timeframe: "4h",
      content_hash: "sha256:def",
      manifest_path: "data/features/BTCUSDT-4h-trend-v1.json",
    }))
    const funding = db.query("SELECT funding_rate FROM funding_event WHERE symbol='BTCUSDT'").get() as { funding_rate: number }
    assert.equal(funding.funding_rate, 0.0001)
    const feature = db.query("SELECT feature_set_id FROM feature_manifest WHERE feature_manifest_id='features-btc-4h'").get() as { feature_set_id: string }
    assert.equal(feature.feature_set_id, "trend-v1")

    const events = readFundingEvents(db, { symbol: "BTCUSDT", since_ts: 50, until_ts: 150 })
    assert.equal(events.length, 1)
    assert.equal(events[0].mark_price, 65000)
    assert.equal(readFeatureManifest(db, "features-btc-4h")?.manifest_path, "data/features/BTCUSDT-4h-trend-v1.json")
    assert.equal(listFeatureManifests(db, { symbol: "BTCUSDT", timeframe: "4h" }).length, 1)
  } finally {
    db.close()
  }
})
