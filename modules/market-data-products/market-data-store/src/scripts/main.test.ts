import assert from "node:assert/strict"
import { Database } from "bun:sqlite"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test from "node:test"
import { canonicalJson } from "../../../../contracts/runtime-core/src/canonical-json"
import { repoRoot } from "../../../../contracts/runtime-core/src/paths"
import { buildIndicatorFeatureArtifact } from "../../../../contracts/market-data-demand-contract/src/indicator-feature-contract"
import { buildMarketDataDemand } from "../../../../contracts/market-data-demand-contract/src/market-data-demand-contract"
import {
  commitInstrumentStatusAcquisitionReceipt,
  createInstrumentStatusAcquisitionAttempt,
  createInstrumentStatusAcquisitionReceipt,
  createInstrumentStatusSourceBatchFromAcquisition,
  instrumentStatusPayloadHash,
} from "../lib/market-data-store"
import { parseArgs, run } from "./main"

test("feature admission and read verify the exact artifact bytes through the owner path", () => {
  const dir = mkdtempSync(join(tmpdir(), "market-data-feature-cli-"))
  const artifactDir = `tmp/test/market-data-feature-cli-${crypto.randomUUID()}`
  const artifactRoot = resolve(repoRoot(), artifactDir)
  mkdirSync(artifactRoot, { recursive: true })
  const artifact = buildIndicatorFeatureArtifact({
    feature_set_ref: "indicator-set:technical-default-v1",
    source: {
      slice_ref: `market-data://candle-slice/${"a".repeat(64)}`,
      content_sha256: "a".repeat(64),
      symbol: "BTCUSDT",
      timeframe: "1h",
      first_open_time: Date.parse("2026-07-23T08:00:00.000Z"),
      last_open_time: Date.parse("2026-07-23T09:00:00.000Z"),
    },
    provider_report: {
      symbol: "BTCUSDT",
      selected_indicators: { ema: { function: "ema" } },
      timeframes: { "1h": { indicators: { ema: 1 } } },
      summary: { bias: "neutral" },
    },
  })
  const artifactRef = `${artifactDir}/${artifact.content_hash}.json`
  writeFileSync(resolve(repoRoot(), artifactRef), `${canonicalJson(artifact)}\n`)
  try {
    const dbPath = join(dir, "market.db")
    const admission = run(parseArgs([
      "--db", dbPath,
      "--action", "admit_feature_manifest",
      "--json", JSON.stringify({
        feature_manifest_id: `indicator-feature:${artifact.content_hash}`,
        source_manifest_id: artifact.source.slice_ref,
        feature_set_id: artifact.feature_set_ref,
        symbol: artifact.source.symbol,
        timeframe: artifact.source.timeframe,
        content_hash: artifact.content_hash,
        manifest_path: artifactRef,
        generated_at: "2026-07-23T10:00:00.000Z",
      }),
    ])) as { artifact_hash: string }
    assert.equal(admission.artifact_hash, artifact.content_hash)
    const read = run(parseArgs([
      "--db", dbPath,
      "--action", "read_feature_artifact",
      "--json", JSON.stringify({ feature_manifest_id: `indicator-feature:${artifact.content_hash}` }),
    ])) as { artifact: { content_hash: string } }
    assert.equal(read.artifact.content_hash, artifact.content_hash)
    writeFileSync(resolve(repoRoot(), artifactRef), "{}\n")
    assert.throws(() => run(parseArgs([
      "--db", dbPath,
      "--action", "read_feature_artifact",
      "--json", JSON.stringify({ feature_manifest_id: `indicator-feature:${artifact.content_hash}` }),
    ])), /schema|shape/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(artifactRoot, { recursive: true, force: true })
  }
})

test("market data store CLI upserts and reads manifest", () => {
  const dir = mkdtempSync(join(tmpdir(), "market-data-store-"))
  const dbPath = join(dir, "market.duckdb")
  const ohlcvDbPath = join(dir, "ohlcv.db")
  try {
    run(parseArgs(["--db", dbPath, "--ohlcv-db", ohlcvDbPath, "--action", "init"]))
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

test("market data store CLI exposes only typed L2 referrer and retention-audit actions", () => {
  const dir = mkdtempSync(join(tmpdir(), "market-data-l2-referrer-cli-"))
  const dbPath = join(dir, "market.db")
  try {
    const missing = run(parseArgs([
      "--db", dbPath,
      "--action", "read_l2_experiment_attachment_referrer",
      "--json", JSON.stringify({ authority_snapshot_hash: "a".repeat(64) }),
    ])) as { receipt: unknown }
    assert.equal(missing.receipt, null)
    assert.throws(() => run(parseArgs([
      "--db", dbPath,
      "--action", "register_l2_experiment_attachment_referrer",
      "--json", JSON.stringify({ authority: {} }),
    ])), /field whitelist drift/)
    assert.throws(() => run(parseArgs([
      "--db", dbPath,
      "--action", "audit_l2_retention_reference_closure",
      "--json", JSON.stringify({ epoch_id: "missing-epoch" }),
    ])), /epoch is not registered/)
    const emptyPage = run(parseArgs([
      "--db", dbPath,
      "--action", "list_l2_retention_reference_audits",
      "--json", JSON.stringify({ limit: 10 }),
    ])) as { page: { page_count: number; deletion_candidates_produced: boolean } }
    assert.equal(emptyPage.page.page_count, 0)
    assert.equal(emptyPage.page.deletion_candidates_produced, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("market data store CLI creates, renews, reconciles, reads, and releases typed demands", () => {
  const dir = mkdtempSync(join(tmpdir(), "market-data-demand-cli-"))
  const dbPath = join(dir, "market.db")
  const demand = buildMarketDataDemand({
    demand_id: "runtime-btc-cli",
    consumer_owner: "trade-flow",
    consumer_kind: "runtime",
    subject_ref: "setup:btc-cli",
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
  })
  try {
    const registered = run(parseArgs([
      "--db", dbPath,
      "--action", "put_market_data_demand",
      "--json", JSON.stringify({ demand, committed_at: "2026-07-23T00:00:01.000Z" }),
    ])) as { commit_status: string }
    assert.equal(registered.commit_status, "created")
    const renewedDemand = buildMarketDataDemand({
      demand_id: demand.demand_id,
      consumer_owner: demand.consumer_owner,
      consumer_kind: demand.consumer_kind,
      subject_ref: demand.subject_ref,
      venue: demand.venue,
      symbol: demand.symbol,
      priority: demand.priority,
      requirements: demand.requirements,
      lease: {
        issued_at: "2026-07-23T00:01:00.000Z",
        expires_at: "2026-07-23T01:01:00.000Z",
        renewal_grace_ms: 0,
      },
    })
    const renewed = run(parseArgs([
      "--db", dbPath,
      "--action", "put_market_data_demand",
      "--json", JSON.stringify({ demand: renewedDemand, committed_at: "2026-07-23T00:01:01.000Z" }),
    ])) as { commit_status: string }
    assert.equal(renewed.commit_status, "renewed")
    const plan = run(parseArgs([
      "--db", dbPath,
      "--action", "reconcile_market_data_demands",
      "--json", JSON.stringify({ observed_at: "2026-07-23T00:10:00.000Z", max_symbols: 1 }),
    ])) as { plan: { selected_symbols: string[]; lifecycle_authority: string } }
    assert.deepEqual(plan.plan.selected_symbols, ["BTCUSDT"])
    assert.equal(plan.plan.lifecycle_authority, "none")
    const read = run(parseArgs([
      "--db", dbPath,
      "--action", "read_market_data_demand",
      "--json", JSON.stringify({ demand_id: demand.demand_id }),
    ])) as { record: { status: string } }
    assert.equal(read.record.status, "active")
    const released = run(parseArgs([
      "--db", dbPath,
      "--action", "release_market_data_demand",
      "--json", JSON.stringify({
        release: {
          schema_version: "trade.market-data-demand-release.v1",
          demand_id: demand.demand_id,
          demand_hash: renewedDemand.demand_hash,
          released_at: "2026-07-23T00:20:00.000Z",
          reason: "subject_cancelled",
        },
      }),
    ])) as { commit_status: string }
    assert.equal(released.commit_status, "released")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
