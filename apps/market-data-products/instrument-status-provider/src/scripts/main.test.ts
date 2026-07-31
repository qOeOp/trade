import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
  commitInstrumentStatusAcquisitionReceipt,
  commitInstrumentStatusArchive,
  createInstrumentStatusAcquisitionAttempt,
  createInstrumentStatusAcquisitionReceipt,
  createInstrumentStatusArchive,
  createInstrumentStatusSourceBatchFromAcquisition,
  ensureMarketDataSchema,
  instrumentStatusPayloadHash,
} from "../../../market-data-store/src/lib/market-data-store"
import { INSTRUMENT_STATUS_PROVIDER_CAPABILITY } from "../lib/instrument-status-provider"
import { CURRENT_INSTRUMENT_SNAPSHOT_PROVIDER_CAPABILITY } from "../lib/current-instrument-snapshot-provider"
import { parseArgs, run } from "./main"

test("instrument-status provider CLI reads one immutable archive without mutating the store", () => {
  const dir = mkdtempSync(join(tmpdir(), "instrument-status-provider-"))
  const dbPath = join(dir, "market-data.db")
  const db = new Database(dbPath)
  try {
    ensureMarketDataSchema(db)
    const payload = '{"records":[{"status":"TRADING"}]}'
    const payloadRef = "market-data-store:instrument-status-source-payload:status-cli-acquisition:1"
    const attempt = createInstrumentStatusAcquisitionAttempt({
      attempt_ordinal: 1,
      started_at: "2026-07-02T00:01:00Z",
      completed_at: "2026-07-02T00:01:00Z",
      outcome: "succeeded",
      failure_class: null,
      retryable: false,
      http_status: 200,
      response_payload_ref: payloadRef,
      response_hash: instrumentStatusPayloadHash(payload),
      response_bytes: new TextEncoder().encode(payload).byteLength,
      response_record_count: 1,
    })
    const acquisition = createInstrumentStatusAcquisitionReceipt({
      acquisition_id: "status-cli-acquisition",
      venue_id: "binance-usdm",
      symbol: "BTCUSDT",
      source_capability: "historical_event_archive",
      transport: "offline_import",
      method: "offline_import",
      endpoint: "offline-import:status-cli",
      request_params_hash: "c".repeat(64),
      requested_coverage_start: "2026-07-01T00:00:00Z",
      requested_coverage_end: "2026-07-02T00:00:00Z",
      source_observed_through: "2026-07-02T00:00:00Z",
      requested_at: "2026-07-02T00:01:00Z",
      completed_at: "2026-07-02T00:01:00Z",
      terminal_status: "succeeded",
      attempts: [attempt],
    })
    const batch = createInstrumentStatusSourceBatchFromAcquisition({
      receipt: acquisition,
      batch_id: "status-cli-batch",
      batch_sequence: 1,
      source_ref: "venue-batch:status-cli",
      previous_batch_hash: null,
    })
    commitInstrumentStatusAcquisitionReceipt(db, acquisition, { [payloadRef]: payload })
    const archive = createInstrumentStatusArchive({
      archive_id: "status-cli",
      venue_id: "binance-usdm",
      symbol: "BTCUSDT",
      source_owner: "binance-usdm",
      source_kind: "venue_status_event_archive",
      completeness: "complete_history",
      coverage_start: "2026-07-01T00:00:00Z",
      coverage_end: "2026-07-02T00:00:00Z",
      source_observed_through: "2026-07-02T00:00:00Z",
      source_ref: "venue-archive:status-cli",
      imported_at: "2026-07-02T00:01:00Z",
      source_batches: [batch],
      events: [{ event_id: "status-1", event_sequence: 1, status: "trading", effective_at: "2026-07-01T00:00:00Z", observed_at: "2026-07-01T00:00:01Z", source_ref: "venue-event:status-1", source_hash: "a".repeat(64), source_batch_id: batch.batch_id }],
    })
    commitInstrumentStatusArchive(db, archive)
    const result = run(parseArgs(["--db", dbPath, "--json", JSON.stringify({
      archive_id: archive.archive_id,
      replay_start: "2026-07-01T04:00:00Z",
      replay_end: "2026-07-01T20:00:00Z",
      produced_at: "2026-07-02T00:02:00Z",
      provider_certification: {
        certification_ref: "certification://status-provider/v1",
        certification_hash: "d".repeat(64),
        provider_capability_hash: INSTRUMENT_STATUS_PROVIDER_CAPABILITY.capability_hash,
      },
    })])) as { evidence: { archive_hash: string; status_epochs: unknown[] } }
    assert.equal(result.evidence.archive_hash, archive.archive_hash)
    assert.equal(result.evidence.status_epochs.length, 1)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("instrument-status provider CLI reads one current snapshot into status and spec evidence", () => {
  const dir = mkdtempSync(join(tmpdir(), "current-instrument-provider-"))
  const dbPath = join(dir, "market-data.db")
  const db = new Database(dbPath)
  try {
    ensureMarketDataSchema(db)
    const observedAt = "2026-07-23T04:00:00.000Z"
    const payload = JSON.stringify({ symbols: [{
      symbol: "BTCUSDT",
      status: "TRADING",
      onboardDate: Date.parse("2019-09-08T00:00:00.000Z"),
      baseAsset: "BTC",
      quoteAsset: "USDT",
      marginAsset: "USDT",
      quotePrecision: 8,
      filters: [
        { filterType: "PRICE_FILTER", tickSize: "0.10" },
        { filterType: "LOT_SIZE", stepSize: "0.001" },
      ],
    }] })
    const payloadRef =
      "market-data-store:instrument-status-source-payload:current-cli:1"
    const attempt = createInstrumentStatusAcquisitionAttempt({
      attempt_ordinal: 1,
      started_at: observedAt,
      completed_at: observedAt,
      outcome: "succeeded",
      failure_class: null,
      retryable: false,
      http_status: 200,
      response_payload_ref: payloadRef,
      response_hash: instrumentStatusPayloadHash(payload),
      response_bytes: new TextEncoder().encode(payload).byteLength,
      response_record_count: 1,
    })
    const acquisition = createInstrumentStatusAcquisitionReceipt({
      acquisition_id: "current-cli",
      venue_id: "binance-usdm",
      symbol: "BTCUSDT",
      source_capability: "current_snapshot_only",
      transport: "binance_usdm_rest",
      method: "GET",
      endpoint: "https://fapi.binance.com/fapi/v1/exchangeInfo",
      request_params_hash: "c".repeat(64),
      requested_coverage_start: null,
      requested_coverage_end: null,
      source_observed_through: observedAt,
      requested_at: observedAt,
      completed_at: observedAt,
      terminal_status: "succeeded",
      attempts: [attempt],
    })
    commitInstrumentStatusAcquisitionReceipt(db, acquisition, {
      [payloadRef]: payload,
    })
    const result = run(parseArgs([
      "--db", dbPath,
      "--action", "current_snapshot",
      "--json", JSON.stringify({
        acquisition_id: acquisition.acquisition_id,
        produced_at: observedAt,
        provider_certification: {
          certification_ref:
            "certification://current-instrument-provider/v1",
          certification_hash: "d".repeat(64),
          provider_capability_hash:
            CURRENT_INSTRUMENT_SNAPSHOT_PROVIDER_CAPABILITY.capability_hash,
        },
      }),
    ])) as { evidence: { symbol: string; accounting: { price_increment: string } } }
    assert.equal(result.evidence.symbol, "BTCUSDT")
    assert.equal(result.evidence.accounting.price_increment, "0.1")
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
