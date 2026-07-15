import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { commitInstrumentStatusArchive, createInstrumentStatusArchive, createInstrumentStatusSourceBatchManifest, ensureMarketDataSchema } from "../../../market-data-store/src/lib/market-data-store"
import { INSTRUMENT_STATUS_PROVIDER_CAPABILITY } from "../lib/instrument-status-provider"
import { parseArgs, run } from "./main"

test("instrument-status provider CLI reads one immutable archive without mutating the store", () => {
  const dir = mkdtempSync(join(tmpdir(), "instrument-status-provider-"))
  const dbPath = join(dir, "market-data.db")
  const db = new Database(dbPath)
  try {
    ensureMarketDataSchema(db)
    const batch = createInstrumentStatusSourceBatchManifest({
      batch_id: "status-cli-batch",
      batch_sequence: 1,
      venue_id: "binance-usdm",
      symbol: "BTCUSDT",
      coverage_start: "2026-07-01T00:00:00Z",
      coverage_end: "2026-07-02T00:00:00Z",
      source_observed_through: "2026-07-02T00:00:00Z",
      retrieved_at: "2026-07-02T00:01:00Z",
      source_ref: "venue-batch:status-cli",
      raw_content_hash: "b".repeat(64),
      raw_record_count: 1,
      previous_batch_hash: null,
    })
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
