import assert from "node:assert/strict"
import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
  commitInstrumentStatusAcquisitionReceipt,
  createInstrumentStatusAcquisitionAttempt,
  createInstrumentStatusAcquisitionReceipt,
  createInstrumentStatusSourceBatchFromAcquisition,
  instrumentStatusPayloadHash,
} from "../lib/market-data-store"
import { parseArgs, run } from "./main"

test("market data store CLI upserts and reads manifest", () => {
  const dir = mkdtempSync(join(tmpdir(), "market-data-store-"))
  const dbPath = join(dir, "market.duckdb")
  try {
    run(parseArgs(["--db", dbPath, "--action", "init"]))
    run(parseArgs([
      "--db",
      dbPath,
      "--action",
      "upsert_manifest",
      "--json",
      JSON.stringify({
        manifest_id: "manifest-cli",
        dataset_kind: "ohlcv",
        source: "binance_klines",
        exchange: "binance_usdm",
        content_hash: "sha256:cli",
        manifest_path: "data/ohlcv/manifest-cli.json",
      }),
    ]))
    const result = run(parseArgs([
      "--db",
      dbPath,
      "--action",
      "read_manifest",
      "--json",
      JSON.stringify({ manifest_id: "manifest-cli" }),
    ])) as { manifest: { source: string } }
    assert.equal(result.manifest.source, "binance_klines")

    run(parseArgs([
      "--db",
      dbPath,
      "--action",
      "upsert_funding",
      "--json",
      JSON.stringify({
        events: [
          { manifest_id: "funding-cli", exchange: "binanceusdm", symbol: "BTCUSDT", funding_time: 100, funding_rate: 0.0001 },
          { manifest_id: "funding-cli", exchange: "binanceusdm", symbol: "BTCUSDT", funding_time: 200, funding_rate: -0.0002 },
        ],
      }),
    ]))
    const funding = run(parseArgs([
      "--db",
      dbPath,
      "--action",
      "read_funding",
      "--json",
      JSON.stringify({ symbol: "BTCUSDT", since_ts: 150 }),
    ])) as { events: Array<{ funding_time: number; funding_rate: number }> }
    assert.deepEqual(funding.events.map((event) => event.funding_time), [200])

    run(parseArgs([
      "--db",
      dbPath,
      "--action",
      "upsert_feature_manifest",
      "--json",
      JSON.stringify({
        feature_manifest_id: "features-cli",
        source_manifest_id: "funding-cli",
        feature_set_id: "crypto-market-features.v1",
        symbol: "BTCUSDT",
        timeframe: "4h",
        content_hash: "sha256:features",
        manifest_path: "data/features/features-cli.json",
      }),
    ]))
    const feature = run(parseArgs([
      "--db",
      dbPath,
      "--action",
      "read_feature_manifest",
      "--json",
      JSON.stringify({ feature_manifest_id: "features-cli" }),
    ])) as { manifest: { feature_set_id: string } }
    const features = run(parseArgs([
      "--db",
      dbPath,
      "--action",
      "list_feature_manifests",
      "--json",
      JSON.stringify({ symbol: "BTCUSDT", feature_set_id: "crypto-market-features.v1" }),
    ])) as { manifests: Array<{ feature_manifest_id: string }> }
    assert.equal(feature.manifest.feature_set_id, "crypto-market-features.v1")
    assert.deepEqual(features.manifests.map((item) => item.feature_manifest_id), ["features-cli"])

    const rawPayload = '{"records":[{"status":"TRADING"}]}'
    const payloadRef = "market-data-store:instrument-status-source-payload:status-cli-acquisition:1"
    const acquisitionAttempt = createInstrumentStatusAcquisitionAttempt({
      attempt_ordinal: 1,
      started_at: "2026-07-15T00:01:00Z",
      completed_at: "2026-07-15T00:01:00Z",
      outcome: "succeeded",
      failure_class: null,
      retryable: false,
      http_status: 200,
      response_payload_ref: payloadRef,
      response_hash: instrumentStatusPayloadHash(rawPayload),
      response_bytes: new TextEncoder().encode(rawPayload).byteLength,
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
      requested_coverage_end: "2026-07-15T00:00:00Z",
      source_observed_through: "2026-07-15T00:00:00Z",
      requested_at: "2026-07-15T00:01:00Z",
      completed_at: "2026-07-15T00:01:00Z",
      terminal_status: "succeeded",
      attempts: [acquisitionAttempt],
    })
    const sourceBatch = createInstrumentStatusSourceBatchFromAcquisition({
      receipt: acquisition,
      batch_id: "status-cli-batch",
      batch_sequence: 1,
      source_ref: "venue-batch:status-cli",
      previous_batch_hash: null,
    })
    const db = new Database(dbPath)
    try {
      assert.equal(commitInstrumentStatusAcquisitionReceipt(db, acquisition, { [payloadRef]: rawPayload }), "created")
    } finally {
      db.close()
    }
    const storedAcquisition = run(parseArgs([
      "--db", dbPath,
      "--action", "read_instrument_status_acquisition_receipt",
      "--json", JSON.stringify({ acquisition_id: acquisition.acquisition_id }),
    ])) as { receipt: { receipt_hash: string } }
    assert.equal(storedAcquisition.receipt.receipt_hash, acquisition.receipt_hash)
    const archiveInput = {
      archive_id: "status-cli",
      venue_id: "binance-usdm",
      symbol: "BTCUSDT",
      source_owner: "binance-usdm",
      source_kind: "venue_status_event_archive",
      completeness: "complete_history",
      coverage_start: "2026-07-01T00:00:00Z",
      coverage_end: "2026-07-15T00:00:00Z",
      source_observed_through: "2026-07-15T00:00:00Z",
      source_ref: "venue-archive:status-cli",
      imported_at: "2026-07-15T00:01:00Z",
      source_batches: [sourceBatch],
      events: [{ event_id: "status-1", event_sequence: 1, status: "trading", effective_at: "2026-07-01T00:00:00Z", observed_at: "2026-07-01T00:00:01Z", source_ref: "venue-event:status-1", source_hash: "a".repeat(64), source_batch_id: "status-cli-batch" }],
    }
    const committed = run(parseArgs(["--db", dbPath, "--action", "commit_instrument_status_archive", "--json", JSON.stringify(archiveInput)])) as { commit_status: string; archive_hash: string }
    const statusArchive = run(parseArgs(["--db", dbPath, "--action", "read_instrument_status_archive", "--json", JSON.stringify({ archive_id: "status-cli" })])) as { archive: { archive_hash: string; events: unknown[] } }
    assert.equal(committed.commit_status, "created")
    assert.equal(statusArchive.archive.archive_hash, committed.archive_hash)
    assert.equal(statusArchive.archive.events.length, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
