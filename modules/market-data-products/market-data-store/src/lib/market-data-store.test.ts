import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import test from "node:test"
import {
  buildCanonicalCandles,
  buildFeatureManifest,
  buildFundingEvents,
  assertInstrumentStatusArchive,
  commitInstrumentStatusArchive,
  commitInstrumentStatusAcquisitionReceipt,
  createInstrumentStatusAcquisitionAttempt,
  createInstrumentStatusAcquisitionReceipt,
  createInstrumentStatusArchive,
  createInstrumentStatusSourceBatchFromAcquisition,
  createInstrumentStatusSourceBatchManifest,
  instrumentStatusPayloadHash,
  buildMarketManifest,
  ensureMarketDataSchema,
  ensureOhlcvSchema,
  listFeatureManifests,
  readFeatureManifest,
  readFundingEvents,
  readInstrumentStatusAcquisitionPayload,
  readInstrumentStatusAcquisitionReceipt,
  readInstrumentStatusArchive,
  readMarketManifest,
  upsertCanonicalCandles,
  upsertFeatureManifest,
  upsertFundingEvents,
  upsertMarketManifest,
} from "./market-data-store"

function statusBatch(input: {
  batch_id?: string
  batch_sequence?: number
  coverage_start?: string
  coverage_end?: string
  source_observed_through?: string
  retrieved_at?: string
  raw_record_count?: number
  previous_batch_hash?: string | null
  raw_payload?: string
} = {}) {
  return statusSource(input).batch
}

function statusSource(input: {
  batch_id?: string
  batch_sequence?: number
  coverage_start?: string
  coverage_end?: string
  source_observed_through?: string
  retrieved_at?: string
  raw_record_count?: number
  previous_batch_hash?: string | null
  raw_payload?: string
} = {}) {
  const batchId = input.batch_id ?? "status-batch-1"
  const coverageStart = input.coverage_start ?? "2026-07-01T00:00:00Z"
  const coverageEnd = input.coverage_end ?? "2026-07-15T00:00:00Z"
  const observedThrough = input.source_observed_through ?? coverageEnd
  const retrievedAt = input.retrieved_at ?? "2026-07-15T00:01:00Z"
  const recordCount = input.raw_record_count ?? 1
  const payload = input.raw_payload ?? JSON.stringify({ batch_id: batchId, records: Array.from({ length: recordCount }, (_, index) => index + 1) })
  const acquisitionId = `acquisition-${batchId}`
  const payloadRef = `market-data-store:instrument-status-source-payload:${acquisitionId}:1`
  const attempt = createInstrumentStatusAcquisitionAttempt({
    attempt_ordinal: 1,
    started_at: retrievedAt,
    completed_at: retrievedAt,
    outcome: "succeeded",
    failure_class: null,
    retryable: false,
    http_status: 200,
    response_payload_ref: payloadRef,
    response_hash: instrumentStatusPayloadHash(payload),
    response_bytes: new TextEncoder().encode(payload).byteLength,
    response_record_count: recordCount,
  })
  const receipt = createInstrumentStatusAcquisitionReceipt({
    acquisition_id: acquisitionId,
    venue_id: "binance-usdm",
    symbol: "BTCUSDT",
    source_capability: "historical_event_archive",
    transport: "offline_import",
    method: "offline_import",
    endpoint: `offline-import:${batchId}`,
    request_params_hash: "c".repeat(64),
    requested_coverage_start: coverageStart,
    requested_coverage_end: coverageEnd,
    source_observed_through: observedThrough,
    requested_at: retrievedAt,
    completed_at: retrievedAt,
    terminal_status: "succeeded",
    attempts: [attempt],
  })
  const batch = createInstrumentStatusSourceBatchFromAcquisition({
    receipt,
    batch_id: batchId,
    batch_sequence: input.batch_sequence ?? 1,
    source_ref: `venue-batch:${batchId}`,
    previous_batch_hash: input.previous_batch_hash ?? null,
  })
  return { batch, receipt, payload, payload_ref: payloadRef }
}

function commitStatusSource(db: Database, source: ReturnType<typeof statusSource>): void {
  assert.equal(commitInstrumentStatusAcquisitionReceipt(db, source.receipt, { [source.payload_ref]: source.payload }), "created")
}

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
  const source = statusSource()
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
    source_batches: [source.batch],
    events: [{
      event_id: "status-1",
      event_sequence: 1,
      status: "trading",
      effective_at: "2026-07-01T00:00:00Z",
      observed_at: "2026-07-01T00:00:01Z",
      source_ref: "venue-event:status-1",
      source_hash: "a".repeat(64),
      source_batch_id: "status-batch-1",
    }],
  })
  try {
    assert.throws(() => commitInstrumentStatusArchive(db, archive), /acquisition receipt is missing/)
    commitStatusSource(db, source)
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
      source_batches: archive.source_batches,
      events: archive.events,
    })
    assert.throws(() => commitInstrumentStatusArchive(db, conflictingArchive), /different content/)
    db.query("DELETE FROM instrument_status_source_payload WHERE payload_ref = $payload_ref").run({ $payload_ref: source.payload_ref })
    assert.throws(() => readInstrumentStatusArchive(db, archive.archive_id), /acquisition payload is missing/)
  } finally {
    db.close()
  }
})

test("market data store preserves acquisition retries and exact response payload bytes", () => {
  const db = new Database(":memory:")
  ensureMarketDataSchema(db)
  const firstPayload = '{"code":-1003}'
  const finalPayload = '{"records":[{"status":"TRADING"}]}'
  const firstRef = "market-data-store:instrument-status-source-payload:acquisition-retry:1"
  const finalRef = "market-data-store:instrument-status-source-payload:acquisition-retry:2"
  const attempts = [
    createInstrumentStatusAcquisitionAttempt({
      attempt_ordinal: 1,
      started_at: "2026-07-15T00:01:00Z",
      completed_at: "2026-07-15T00:01:01Z",
      outcome: "failed",
      failure_class: "rate_limited",
      retryable: true,
      http_status: 429,
      response_payload_ref: firstRef,
      response_hash: instrumentStatusPayloadHash(firstPayload),
      response_bytes: new TextEncoder().encode(firstPayload).byteLength,
      response_record_count: null,
    }),
    createInstrumentStatusAcquisitionAttempt({
      attempt_ordinal: 2,
      started_at: "2026-07-15T00:01:02Z",
      completed_at: "2026-07-15T00:01:03Z",
      outcome: "succeeded",
      failure_class: null,
      retryable: false,
      http_status: 200,
      response_payload_ref: finalRef,
      response_hash: instrumentStatusPayloadHash(finalPayload),
      response_bytes: new TextEncoder().encode(finalPayload).byteLength,
      response_record_count: 1,
    }),
  ]
  const receipt = createInstrumentStatusAcquisitionReceipt({
    acquisition_id: "acquisition-retry",
    venue_id: "binance-usdm",
    symbol: "BTCUSDT",
    source_capability: "historical_event_archive",
    transport: "offline_import",
    method: "offline_import",
    endpoint: "offline-import:retry-fixture",
    request_params_hash: "c".repeat(64),
    requested_coverage_start: "2026-07-01T00:00:00Z",
    requested_coverage_end: "2026-07-15T00:00:00Z",
    source_observed_through: "2026-07-15T00:00:00Z",
    requested_at: "2026-07-15T00:01:00Z",
    completed_at: "2026-07-15T00:01:03Z",
    terminal_status: "succeeded",
    attempts,
  })
  const payloads = { [firstRef]: firstPayload, [finalRef]: finalPayload }
  try {
    assert.equal(commitInstrumentStatusAcquisitionReceipt(db, receipt, payloads), "created")
    assert.equal(commitInstrumentStatusAcquisitionReceipt(db, receipt, payloads), "existing")
    assert.deepEqual(readInstrumentStatusAcquisitionReceipt(db, receipt.acquisition_id), receipt)
    assert.equal(new TextDecoder().decode(readInstrumentStatusAcquisitionPayload(db, finalRef)?.payload), finalPayload)
    assert.throws(() => commitInstrumentStatusAcquisitionReceipt(db, receipt, {
      ...payloads,
      [finalRef]: "tampered",
    }), /payload hash or byte count mismatch/)
    const conflicting = createInstrumentStatusAcquisitionReceipt({
      ...Object.fromEntries(Object.entries(receipt).filter(([key]) => key !== "receipt_hash")),
      endpoint: "offline-import:changed",
    } as Omit<typeof receipt, "receipt_hash" | "schema_version" | "external_authenticity">)
    assert.throws(() => commitInstrumentStatusAcquisitionReceipt(db, conflicting, payloads), /different content/)
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
    source_batches: [statusBatch()],
    events: [{ event_id: "one", event_sequence: 1, status: "trading" as const, effective_at: "2026-07-01T00:00:00Z", observed_at: "2026-07-01T00:00:01Z", source_ref: "event:one", source_hash: "a".repeat(64), source_batch_id: "status-batch-1" }],
  }
  assert.throws(() => createInstrumentStatusArchive(base), /finality watermark/)
  assert.throws(() => createInstrumentStatusArchive({
    ...base,
    source_observed_through: "2026-07-15T00:00:00Z",
    imported_at: "",
  }), /required/)
  assert.throws(() => createInstrumentStatusArchive({
    ...base,
    source_observed_through: "2026-07-15T00:00:00Z",
    source_batches: [statusBatch({ raw_record_count: 2 })],
    events: [
      base.events[0],
      { ...base.events[0], event_id: "two", event_sequence: 2, effective_at: "2026-07-02T00:00:00Z", observed_at: "2026-07-02T00:00:01Z" },
    ],
  }), /state transitions/)
})

test("instrument-status source batches require contiguous windows, hash links, and non-overclaiming audit", () => {
  const first = statusBatch({ coverage_end: "2026-07-08T00:00:00Z", source_observed_through: "2026-07-08T00:00:00Z", retrieved_at: "2026-07-08T00:01:00Z" })
  const second = statusBatch({
    batch_id: "status-batch-2",
    batch_sequence: 2,
    coverage_start: first.coverage_end,
    raw_payload: "second source batch payload",
    previous_batch_hash: first.batch_hash,
  })
  const archive = createInstrumentStatusArchive({
    archive_id: "status-two-batches",
    venue_id: "binance-usdm",
    symbol: "BTCUSDT",
    source_owner: "binance-usdm",
    source_kind: "venue_status_event_archive",
    completeness: "complete_history",
    coverage_start: "2026-07-01T00:00:00Z",
    coverage_end: "2026-07-15T00:00:00Z",
    source_observed_through: "2026-07-15T00:00:00Z",
    source_ref: "venue-archive:two-batches",
    imported_at: "2026-07-15T00:01:00Z",
    source_batches: [first, second],
    events: [
      { event_id: "one", event_sequence: 1, status: "trading", effective_at: "2026-07-01T00:00:00Z", observed_at: "2026-07-01T00:00:01Z", source_ref: "event:one", source_hash: "a".repeat(64), source_batch_id: first.batch_id },
      { event_id: "two", event_sequence: 2, status: "halted", effective_at: "2026-07-10T00:00:00Z", observed_at: "2026-07-10T00:00:01Z", source_ref: "event:two", source_hash: "b".repeat(64), source_batch_id: second.batch_id },
    ],
  })
  assert.equal(archive.completeness_audit.external_completeness, "not_verified")
  assert.equal(archive.completeness_audit.batch_count, 2)
  const { batch_hash: _batchHash, ...secondBody } = second
  assert.throws(() => createInstrumentStatusArchive({
    ...archive,
    archive_id: "status-gap",
    source_batches: [first, createInstrumentStatusSourceBatchManifest({
      ...secondBody,
      coverage_start: "2026-07-09T00:00:00Z",
    })],
  }), /gap, overlap, or broken hash link/)
  const overclaim = {
    ...archive,
    completeness_audit: { ...archive.completeness_audit, external_completeness: "verified" },
  }
  assert.throws(() => assertInstrumentStatusArchive(overclaim as typeof archive), /overclaims/)
})

test("instrument-status archive corrections form an append-only single-successor chain", () => {
  const db = new Database(":memory:")
  ensureMarketDataSchema(db)
  const predecessorSource = statusSource()
  const predecessor = createInstrumentStatusArchive({
    archive_id: "status-original",
    venue_id: "binance-usdm",
    symbol: "BTCUSDT",
    source_owner: "binance-usdm",
    source_kind: "venue_status_event_archive",
    completeness: "complete_history",
    coverage_start: "2026-07-01T00:00:00Z",
    coverage_end: "2026-07-15T00:00:00Z",
    source_observed_through: "2026-07-15T00:00:00Z",
    source_ref: "venue-archive:original",
    imported_at: "2026-07-15T00:01:00Z",
    source_batches: [predecessorSource.batch],
    events: [{ event_id: "one", event_sequence: 1, status: "trading", effective_at: "2026-07-01T00:00:00Z", observed_at: "2026-07-01T00:00:01Z", source_ref: "event:one", source_hash: "a".repeat(64), source_batch_id: "status-batch-1" }],
  })
  const correctedSource = statusSource({ batch_id: "status-batch-corrected", raw_payload: "corrected source batch payload" })
  const correctedBatch = correctedSource.batch
  const corrected = createInstrumentStatusArchive({
    ...predecessor,
    archive_id: "status-corrected",
    source_ref: "venue-archive:corrected",
    source_batches: [correctedBatch],
    supersedes_archive_hash: predecessor.archive_hash,
    correction_reason: "upstream status record correction",
    events: [{ ...predecessor.events[0], source_hash: "b".repeat(64), source_batch_id: correctedBatch.batch_id }],
  })
  try {
    commitStatusSource(db, predecessorSource)
    commitStatusSource(db, correctedSource)
    assert.equal(commitInstrumentStatusArchive(db, predecessor), "created")
    assert.equal(commitInstrumentStatusArchive(db, corrected), "created")
    assert.equal(readInstrumentStatusArchive(db, predecessor.archive_id)?.archive_hash, predecessor.archive_hash)
    assert.equal(readInstrumentStatusArchive(db, corrected.archive_id)?.supersedes_archive_hash, predecessor.archive_hash)
    const branch = createInstrumentStatusArchive({ ...corrected, archive_id: "status-corrected-branch", source_ref: "venue-archive:branch" })
    assert.throws(() => commitInstrumentStatusArchive(db, branch), /UNIQUE constraint failed/)
    const orphan = createInstrumentStatusArchive({ ...corrected, archive_id: "status-orphan", supersedes_archive_hash: "9".repeat(64) })
    assert.throws(() => commitInstrumentStatusArchive(db, orphan), /predecessor does not exist/)
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
