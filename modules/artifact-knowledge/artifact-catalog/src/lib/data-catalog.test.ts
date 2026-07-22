import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import test from "node:test"
import { repoRoot } from "../../../../contracts/runtime-core/src/paths"
import { initDataCatalog, listStaleCatalogArtifacts, queryDataCatalog, readCatalogArtifact, registerCatalogArtifact, scanDataCatalog } from "./data-catalog"

test("data catalog initializes schema and scans datasets, runs, artifacts, and ledgers", () => {
  const dir = mkdtempSync(join(tmpdir(), "data-catalog-"))
  try {
    const catalogDbPath = join(dir, "data_catalog.db")
    const root = join(dir, "data")
    const ohlcvDir = join(root, "ohlcv", "BTCUSDT")
    mkdirSync(ohlcvDir, { recursive: true })
    const csvPath = join(ohlcvDir, "4h.csv")
    writeFileSync(csvPath, "date,timestamp,open,high,low,close,volume\n2026-01-01T00:00:00Z,1,1,2,0,1,10\n")
    utimesSync(csvPath, new Date("2026-01-01T00:00:00.000Z"), new Date("2026-01-01T00:00:00.000Z"))
    writeFileSync(join(ohlcvDir, "manifest.json"), JSON.stringify({
      schema_version: 2,
      source: { provider: "binance" },
      symbol: "BTC/USDT:USDT",
      exchange: "binanceusdm",
      timeframes: {
        "4h": {
          file: "4h.csv",
          rows: 1,
          first_open_ts: 1,
          last_open_ts: 1,
          content_sha256: "abc123",
        },
      },
    }))
    writeFileSync(join(root, "slow-track-run-1.json"), JSON.stringify({
      run_id: "run-1",
      track: "slow",
      mode: "analysis-only",
      generated_at: "2026-01-01T00:00:00.000Z",
      active_flow_count: 0,
    }))
    writeFileSync(join(root, "cron.log"), `${JSON.stringify({
      run_id: "cron-1",
      track: "fast",
      triggered_at: "2026-01-01T00:05:00.000Z",
      duration_ms: 10,
      status: "completed",
      chains_processed: 0,
      actions_taken: [],
      errors: [],
    })}\n`)
    writeFileSync(join(root, "panel-manifest.json"), JSON.stringify({
      generated_at: "2026-01-01T00:10:00.000Z",
      purpose: "test_panel",
      timeframe: "4h",
      symbol_count: 1,
      datasets: [{
        dataset_id: "BTCUSDT",
        symbol: "BTCUSDT",
        manifest_path: join(ohlcvDir, "manifest.json"),
        rows: 1,
        first_open_ts: 1,
        last_open_ts: 1,
      }],
    }))
    writeFileSync(join(root, "features.json"), JSON.stringify({
      ok: true,
      data: {
        symbol: "BTC/USDT:USDT",
        exchange: "binanceusdm",
        generated_at: "2026-01-01T00:20:00.000Z",
        source_manifest: join(ohlcvDir, "manifest.json"),
        selected_indicators: { EMA: {}, RSI: {} },
        timeframes: { "4h": { features: { "price.close": { values: [] } } } },
        summary: { trend: "up" },
      },
    }))
    writeFileSync(join(root, "strategy-rnd-ledger.jsonl"), `${JSON.stringify({
      run_id: "rnd-1",
      created_at: "2026-01-02T00:00:00.000Z",
      candidate_source: "provided",
      outcome: "no_promote",
      accepted_count: 0,
      trial_count: 1,
      artifact_ref: "data/artifacts/rnd-1.json",
    })}\n`)
    writeFileSync(join(root, "strategy-evidence.jsonl"), `${JSON.stringify({
      evidence_id: "ev-1",
      created_at: "2026-01-03T00:00:00.000Z",
      strategy_id: "S-TEST",
      kind: "replay",
      source_ref: "data/artifacts/replay.json",
      stats: { sample_count: 1 },
    })}\n`)
    writeFileSync(join(root, "campaign.json"), JSON.stringify({
      campaign_id: "campaign-1",
      created_at: "2026-01-03T12:00:00.000Z",
      outcome: "no_validated_candidate",
      stop_reason: "locked_holdout_failed",
      trial_budget: 10,
      trials_used: 2,
      hypotheses_run: 1,
      holdout_evaluations: 1,
      validated_candidate: null,
    }))
    writeFileSync(join(root, "rd-shadow-tracker.json"), JSON.stringify({
      schema_version: 2,
      tracker_id: "tracker-1",
      created_at: "2026-01-03T13:00:00.000Z",
      updated_at: "2026-01-03T14:00:00.000Z",
      status: "open",
      summary: {
        position_count: 1,
        open_count: 1,
        closed_count: 0,
        event_count: 2,
      },
      paper_positions: [{
        position_id: "pos-1",
        events: [
          { behavior: "open_setup", backend: "rd_artifact" },
          { behavior: "observe_setup", backend: "rd_artifact" },
        ],
      }],
    }))
    touchTree(root, new Date("2026-01-01T00:00:00.000Z"))

    const init = initDataCatalog(catalogDbPath)
    assert.equal(init.initialized, true)
    assert.equal(init.catalog_db_path.endsWith("data_catalog.db"), true)
    const result = scanDataCatalog({
      catalogDbPath,
      roots: [root],
      now: "2026-01-04T00:00:00.000Z",
    })

    assert.equal(result.datasets_upserted, 2)
    assert.equal(result.runs_upserted, 3)
    assert.equal(result.strategy_rnd_runs_upserted, 1)
    assert.equal(result.strategy_evidence_upserted, 1)
    assert.equal(result.panels_upserted, 1)
    assert.equal(result.panel_members_upserted, 1)
    assert.equal(result.feature_reports_upserted, 1)
    assert.equal(result.research_reports_upserted, 2)
    assert.equal(result.cron_runs_upserted, 1)

    const db = new Database(catalogDbPath)
    try {
      assert.equal(count(db, "artifact"), 10)
      assert.equal(count(db, "dataset"), 2)
      assert.equal(count(db, "run"), 3)
      assert.equal(count(db, "strategy_rnd_run"), 1)
      assert.equal(count(db, "strategy_evidence"), 1)
      assert.equal(count(db, "artifact_ref"), 2)
      assert.equal(count(db, "panel"), 1)
      assert.equal(count(db, "panel_member"), 1)
      assert.equal(count(db, "feature_report"), 1)
      assert.equal(count(db, "research_report"), 2)
      assert.equal((db.query("SELECT version FROM schema_migration WHERE component='data_catalog'").get() as { version: number }).version, 3)
      const dataset = db.query("SELECT symbol, timeframe, rows, content_hash FROM dataset WHERE kind = 'ohlcv'").get() as {
        symbol: string
        timeframe: string
        rows: number
        content_hash: string
      }
      assert.deepEqual(dataset, {
        symbol: "BTC/USDT:USDT",
        timeframe: "4h",
        rows: 1,
        content_hash: "abc123",
      })
      const feature = db.query("SELECT symbol, source_manifest, indicator_count, timeframe_count FROM feature_report").get() as {
        symbol: string
        source_manifest: string
        indicator_count: number
        timeframe_count: number
      }
      assert.equal(feature.symbol, "BTC/USDT:USDT")
      assert.equal(feature.source_manifest.startsWith("/"), false)
      assert.equal(feature.source_manifest.endsWith(displaySuffix(join(ohlcvDir, "manifest.json"))), true)
      assert.equal(feature.indicator_count, 2)
      assert.equal(feature.timeframe_count, 1)
    } finally {
      db.close()
    }

    const query = queryDataCatalog({
      catalogDbPath,
      symbol: "BTCUSDT",
      limit: 10,
    })
    assert.ok(query.datasets.some((item) => item.symbol === "BTC/USDT:USDT"))
    assert.ok(query.feature_reports.some((item) => item.symbol === "BTC/USDT:USDT"))
    assert.ok(query.artifacts.some((item) => typeof item.path === "string" && item.path.endsWith("features.json")))

    const logQuery = queryDataCatalog({
      catalogDbPath,
      path: join(root, "cron.log"),
      limit: 10,
    })
    assert.ok(logQuery.refs.some((item) => item.role === "log"))
    const campaignQuery = queryDataCatalog({
      catalogDbPath,
      path: join(root, "campaign.json"),
      limit: 10,
    })
    assert.ok(campaignQuery.research_reports.some((item) => item.report_kind === "strategy_rnd_campaign"))
    const reportKindQuery = queryDataCatalog({
      catalogDbPath,
      reportKind: "strategy_rnd_campaign",
      limit: 10,
    })
    assert.equal(reportKindQuery.query.report_kind, "strategy_rnd_campaign")
    assert.ok(reportKindQuery.research_reports.length >= 1)
    assert.ok(reportKindQuery.research_reports.every((item) => item.report_kind === "strategy_rnd_campaign"))
    assert.ok(reportKindQuery.artifacts.every((item) => typeof item.path === "string" && item.path.endsWith("campaign.json")))
    assert.equal(reportKindQuery.datasets.length, 0)
    assert.equal(reportKindQuery.feature_reports.length, 0)
    assert.equal(reportKindQuery.panels.length, 0)
    const trackerQuery = queryDataCatalog({
      catalogDbPath,
      reportKind: "rd_shadow_tracker",
      limit: 10,
    })
    assert.ok(trackerQuery.research_reports.some((item) => item.report_kind === "rd_shadow_tracker"))

    const stale = listStaleCatalogArtifacts({
      catalogDbPath,
      roots: [root],
      now: "2026-02-01T00:00:00.000Z",
      retentionHours: 24,
      ephemeralRetentionHours: 12,
    })
    assert.equal(stale.mode, "dry-run")
    assert.ok(stale.candidates.some((item) => typeof item.path === "string" && item.path.endsWith("4h.csv")))
    assert.ok(stale.kept.some((item) => item.retention_class === "durable"))

    const generatedPath = join(root, "generated-loop.json")
    writeFileSync(generatedPath, JSON.stringify({
      run_id: "rnd-generated-1",
      created_at: "2026-01-04T00:00:00.000Z",
      stop_reason: "no_promote",
      batch: {
        batch_id: "batch-generated-1",
        hypothesis: "test",
        candidate_source: "provided",
        outcome: "no_promote",
        trial_count: 1,
        accepted_count: 0,
        winner: null,
      },
      ledger_record: {
        stage: "selection_validation",
      },
    }))
    const registered = registerCatalogArtifact({
      catalogDbPath,
      path: generatedPath,
      now: "2026-01-04T00:00:00.000Z",
      referrerType: "run",
      referrerID: "rnd-generated-1",
      role: "output",
    })
    assert.equal(registered.research_reports_upserted, 1)

    const gc = listStaleCatalogArtifacts({
      catalogDbPath,
      roots: [root],
      now: "2026-02-01T00:00:00.000Z",
      retentionHours: 24,
      ephemeralRetentionHours: 12,
      yes: true,
      limit: 50,
    })
    assert.equal(gc.mode, "delete")
    assert.ok(gc.deleted_count > 0)
    assert.equal(gc.deleted.some((item) => typeof item.path === "string" && item.path.endsWith("4h.csv")), true)
    const dbAfterGc = new Database(catalogDbPath)
    try {
      assert.equal(count(dbAfterGc, "dataset"), 0)
      assert.equal(count(dbAfterGc, "feature_report"), 0)
      assert.equal(count(dbAfterGc, "panel"), 0)
      assert.equal(count(dbAfterGc, "panel_member"), 0)
    } finally {
      dbAfterGc.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("data catalog classifies strategy data split reports without panel pollution", () => {
  const dir = mkdtempSync(join(tmpdir(), "data-catalog-split-report-"))
  try {
    const catalogDbPath = join(dir, "data_catalog.db")
    const reportPath = join(dir, "split-report.json")
    writeFileSync(reportPath, JSON.stringify({
      schema_version: "trade-flow.strategy-data-split.v1",
      split_id: "split-1",
      hypothesis_id: "h1",
      generated_at: "2026-01-05T00:00:00.000Z",
      timeframe: "4h",
      output_root: "tmp/panels/strategy-data-splits/split-1",
      ratios: { discovery: 0.6, validation: 0.2, locked_holdout: 0.2 },
      embargo: { bars: 24 },
      dataset_count: 1,
      datasets: [{ dataset_id: "BTCUSDT", segments: [] }],
      guardrails: { locked_holdout_reserved: true },
    }))

    const registered = registerCatalogArtifact({
      catalogDbPath,
      path: reportPath,
      now: "2026-01-05T00:00:00.000Z",
      referrerType: "strategy_data_split",
      referrerID: "split-1",
      role: "report",
    })
    assert.equal(registered.research_reports_upserted, 1)
    assert.equal(registered.datasets_upserted, 0)
    assert.equal(registered.panels_upserted, 0)

    const query = queryDataCatalog({ catalogDbPath, reportKind: "strategy_data_split", limit: 10 })
    assert.equal(query.research_reports.length, 1)
    assert.equal(query.research_reports[0].report_kind, "strategy_data_split")
    assert.equal(query.datasets.length, 0)
    assert.equal(query.panels.length, 0)

    const db = new Database(catalogDbPath)
    try {
      db.query("INSERT INTO dataset(dataset_id, kind, manifest_path, created_at) VALUES ('bad-dataset', 'panel', $path, '2026-01-05T00:00:00.000Z')").run({ $path: registered.path })
      db.query("INSERT INTO panel(panel_id, manifest_path, created_at) VALUES ('bad-panel', $path, '2026-01-05T00:00:00.000Z')").run({ $path: registered.path })
    } finally {
      db.close()
    }
    registerCatalogArtifact({
      catalogDbPath,
      path: reportPath,
      now: "2026-01-05T00:01:00.000Z",
      referrerType: "strategy_data_split",
      referrerID: "split-1",
      role: "report",
    })
    const cleaned = queryDataCatalog({ catalogDbPath, reportKind: "strategy_data_split", limit: 10 })
    assert.equal(cleaned.datasets.length, 0)
    assert.equal(cleaned.panels.length, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("data catalog does not classify panel R&D input drafts as reports", () => {
  const dir = mkdtempSync(join(tmpdir(), "data-catalog-panel-rnd-"))
  try {
    const catalogDbPath = join(dir, "data_catalog.db")
    const root = join(dir, "artifacts")
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, "panel-input.json"), JSON.stringify({
      panel_id: "panel-input",
      hypothesis: "input draft",
      datasets: [{ dataset_id: "BTC", manifest_path: "tmp/panels/btc/manifest.json" }],
      candidates: [{ candidate_id: "C-1", params: { side: "long" } }],
    }))
    writeFileSync(join(root, "panel-result.json"), JSON.stringify({
      panel_id: "panel-result",
      hypothesis: "complete result",
      diagnostic_mode: false,
      dataset_count: 3,
      trial_count: 1,
      outcome: "no_promote",
      candidates: [{
        candidate_id: "C-1",
        family: "structure_breakout_retest_v1",
        pooled: { sample_count: 101, avg_r: 0.01, total_r: 1, positive_assets: 1, asset_count: 3 },
        negative_controls: {},
        panel_negative_controls: {},
        catastrophic_assets: [],
        assets: [],
        gate: { accepted: false, blocked_by: [] },
      }],
    }))

    scanDataCatalog({ catalogDbPath, roots: [root], now: "2026-01-04T00:00:00.000Z" })
    const catalog = new Database(catalogDbPath)
    try {
      const rows = catalog.query("SELECT report_id FROM research_report WHERE report_kind='strategy_panel_rnd' ORDER BY report_id").all() as Array<{ report_id: string }>
      assert.deepEqual(rows.map((row) => row.report_id), ["panel-result"])
    } finally {
      catalog.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("catalog artifact read is bounded, path-scoped, and hash verified", () => {
  const root = join(repoRoot(), "tmp", `catalog-artifact-read-${Date.now()}`)
  const catalogDbPath = join(root, "data_catalog.db")
  const artifactPath = join(root, "report.json")
  try {
    mkdirSync(root, { recursive: true })
    writeFileSync(artifactPath, JSON.stringify({ report_kind: "artifact_read", value: "0123456789" }))
    initDataCatalog(catalogDbPath)
    const registered = registerCatalogArtifact({ catalogDbPath, path: artifactPath, now: "2026-07-22T00:00:00.000Z" })

    const read = readCatalogArtifact({ catalogDbPath, artifactID: registered.artifact_id, maxBytes: 12 })
    assert.equal(read.artifact_id, registered.artifact_id)
    assert.equal(read.returned_bytes, 12)
    assert.equal(read.truncated, true)
    assert.equal(read.path.startsWith("tmp/"), true)

    writeFileSync(artifactPath, JSON.stringify({ report_kind: "artifact_read", value: "changed" }))
    assert.throws(() => readCatalogArtifact({ catalogDbPath, artifactID: registered.artifact_id }), /content hash mismatch/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

function displaySuffix(path: string): string {
  return path.split("/").slice(-4).join("/")
}

function touchTree(path: string, date: Date): void {
  const stat = statSync(path)
  if (stat.isDirectory()) {
    for (const entry of readdirSync(path)) {
      touchTree(join(path, entry), date)
    }
    return
  }
  utimesSync(path, date, date)
}

function count(db: Database, table: string): number {
  const row = db.query(`SELECT count(*) AS count FROM ${table}`).get() as { count: number }
  return row.count
}
