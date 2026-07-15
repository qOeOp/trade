import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import test from "node:test"
import {
  buildCanonicalCandles,
  buildFeatureManifest,
  buildFundingEvents,
  commitInstrumentStatusArchive,
  createInstrumentStatusArchive,
  buildMarketManifest,
  ensureMarketDataSchema,
  ensureOhlcvSchema,
  listFeatureManifests,
  readFeatureManifest,
  readFundingEvents,
  readInstrumentStatusArchive,
  readMarketManifest,
  upsertCanonicalCandles,
  upsertFeatureManifest,
  upsertFundingEvents,
  upsertMarketManifest,
} from "./market-data-store"

test("market data store records manifests and canonical rows", () => {
  const db = new Database(":memory:")
  ensureMarketDataSchema(db)
  ensureOhlcvSchema(db)
  try {
    upsertMarketManifest(db, buildMarketManifest({
      manifest_id: "ohlcv-btc-4h",
      dataset_kind: "ohlcv",
      source: "binance_klines",
      symbol: "BTCUSDT",
      timeframe: "4h",
      rows: 2,
      content_hash: "sha256:abc",
      manifest_path: "tmp/market/BTCUSDT-4h.manifest.json",
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

test("market data store commits one immutable finalized instrument-status archive", () => {
  const db = new Database(":memory:")
  ensureMarketDataSchema(db)
  const archive = createInstrumentStatusArchive({
    archive_id: "binance-usdm-btc-status-2026-07",
    venue_id: "binance-usdm",
    symbol: "BTCUSDT",
    source_owner: "binance-usdm",
    source_kind: "venue_status_event_archive",
    completeness: "complete_history",
    coverage_start: "2026-07-01T00:00:00Z",
    coverage_end: "2026-07-15T00:00:00Z",
    source_observed_through: "2026-07-15T00:00:00Z",
    source_ref: "venue-archive:binance-usdm:BTCUSDT:2026-07",
    imported_at: "2026-07-15T00:01:00Z",
    events: [{
      event_id: "status-1",
      event_sequence: 1,
      status: "trading",
      effective_at: "2026-07-01T00:00:00Z",
      observed_at: "2026-07-01T00:00:01Z",
      source_ref: "venue-event:status-1",
      source_hash: "a".repeat(64),
    }],
  })
  try {
    assert.equal(commitInstrumentStatusArchive(db, archive), "created")
    assert.equal(commitInstrumentStatusArchive(db, archive), "existing")
    assert.deepEqual(readInstrumentStatusArchive(db, archive.archive_id), archive)
    const conflictingArchive = createInstrumentStatusArchive({
      archive_id: archive.archive_id,
      venue_id: archive.venue_id,
      symbol: archive.symbol,
      source_owner: archive.source_owner,
      source_kind: archive.source_kind,
      completeness: archive.completeness,
      coverage_start: archive.coverage_start,
      coverage_end: archive.coverage_end,
      source_observed_through: archive.source_observed_through,
      source_ref: "venue-archive:mutated",
      imported_at: archive.imported_at,
      events: archive.events,
    })
    assert.throws(() => commitInstrumentStatusArchive(db, conflictingArchive), /different content/)
  } finally {
    db.close()
  }
})

test("instrument-status archive rejects unfinalized coverage and redundant observations", () => {
  const base = {
    archive_id: "status-archive",
    venue_id: "binance-usdm",
    symbol: "BTCUSDT",
    source_owner: "binance-usdm",
    source_kind: "venue_status_event_archive" as const,
    completeness: "complete_history" as const,
    coverage_start: "2026-07-01T00:00:00Z",
    coverage_end: "2026-07-15T00:00:00Z",
    source_observed_through: "2026-07-14T23:59:59Z",
    source_ref: "venue-archive:status",
    imported_at: "2026-07-15T00:01:00Z",
    events: [{ event_id: "one", event_sequence: 1, status: "trading" as const, effective_at: "2026-07-01T00:00:00Z", observed_at: "2026-07-01T00:00:01Z", source_ref: "event:one", source_hash: "a".repeat(64) }],
  }
  assert.throws(() => createInstrumentStatusArchive(base), /finality watermark/)
  assert.throws(() => createInstrumentStatusArchive({
    ...base,
    source_observed_through: "2026-07-15T00:00:00Z",
    imported_at: "",
  }), /imported_at is required/)
  assert.throws(() => createInstrumentStatusArchive({
    ...base,
    source_observed_through: "2026-07-15T00:00:00Z",
    events: [
      base.events[0],
      { ...base.events[0], event_id: "two", event_sequence: 2, effective_at: "2026-07-02T00:00:00Z", observed_at: "2026-07-02T00:00:01Z" },
    ],
  }), /state transitions/)
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
      manifest_path: "tmp/features/BTCUSDT-4h-trend-v1.json",
    }))
    const funding = db.query("SELECT funding_rate FROM funding_event WHERE symbol='BTCUSDT'").get() as { funding_rate: number }
    assert.equal(funding.funding_rate, 0.0001)
    const feature = db.query("SELECT feature_set_id FROM feature_manifest WHERE feature_manifest_id='features-btc-4h'").get() as { feature_set_id: string }
    assert.equal(feature.feature_set_id, "trend-v1")

    const events = readFundingEvents(db, { symbol: "BTCUSDT", since_ts: 50, until_ts: 150 })
    assert.equal(events.length, 1)
    assert.equal(events[0].mark_price, 65000)
    assert.equal(readFeatureManifest(db, "features-btc-4h")?.manifest_path, "tmp/features/BTCUSDT-4h-trend-v1.json")
    assert.equal(listFeatureManifests(db, { symbol: "BTCUSDT", timeframe: "4h" }).length, 1)
  } finally {
    db.close()
  }
})
