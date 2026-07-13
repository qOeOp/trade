import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import assert from "node:assert/strict"
import test from "node:test"
import { Database } from "bun:sqlite"
import { run } from "../scripts/main"
import { resolveRepoPath } from "../../../../contracts/runtime-core/src/paths"
import { runStrategyDataSplit, strategyDataSplitInputFromJson } from "./strategy-data-split"

test("strategy data split writes discovery validation and locked holdout manifests with embargo gaps", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-data-split-"))
  try {
    const manifestPath = writeManifest(join(dir, "source"), "ALTUSDT", 600)
    const report = runStrategyDataSplit({
      splitId: "split-test",
      hypothesisId: "h-test",
      timeframe: "4h",
      outputRoot: join(dir, "splits"),
      maxHoldBars: 12,
      datasets: [{ datasetId: "ALTUSDT", manifestPath }],
    })
    assert.equal(report.schema_version, "trade-flow.strategy-data-split.v1")
    assert.equal(report.guardrails.locked_holdout_reserved, true)
    assert.equal(report.datasets.length, 1)
    const segments = report.datasets[0].segments
    assert.deepEqual(segments.map((segment) => segment.segment), ["discovery", "validation", "locked_holdout"])
    assert.equal(segments.every((segment) => existsSync(resolveRepoPath(segment.manifest_path))), true)
    assert.ok(segments[1].first_open_ts - segments[0].last_open_ts > report.embargo.milliseconds)
    assert.ok(segments[2].first_open_ts - segments[1].last_open_ts > report.embargo.milliseconds)

    const holdoutManifest = readJsonFile(segments[2].manifest_path)
    const holdoutCsv = readFileSync(join(dirname(resolveRepoPath(segments[2].manifest_path)), "4h.csv"), "utf8")
    const holdoutCandles = holdoutCsv.trim().split(/\r?\n/).slice(1)
    assert.equal(holdoutCandles.length, segments[2].rows)
    assert.equal(holdoutManifest.closed_candles_only, true)
    assert.equal(asRecord(holdoutManifest.split).segment, "locked_holdout")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("strategy data split can persist and catalog the split report", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-data-split-report-"))
  try {
    const manifestPath = writeManifest(join(dir, "source"), "ALTUSDT", 600)
    const reportPath = join(dir, "artifacts", "split-report.json")
    const catalogDbPath = join(dir, "catalog.db")
    const report = runStrategyDataSplit({
      splitId: "split-report",
      hypothesisId: "h-report",
      timeframe: "4h",
      outputRoot: join(dir, "splits"),
      reportPath,
      catalogDbPath,
      maxHoldBars: 12,
      datasets: [{ datasetId: "ALTUSDT", manifestPath }],
    })

    assert.equal(report.report_path?.endsWith("split-report.json"), true)
    assert.equal(report.catalog_db_path?.endsWith("catalog.db"), true)
    assert.ok(report.artifact_id)
    assert.equal(existsSync(reportPath), true)
    const saved = JSON.parse(readFileSync(reportPath, "utf8")) as { schema_version: string; report_path: string }
    assert.equal(saved.schema_version, "trade-flow.strategy-data-split.v1")
    assert.equal(saved.report_path.endsWith("split-report.json"), true)

    const db = new Database(catalogDbPath)
    try {
      const ref = db.query("SELECT referrer_type, referrer_id, role FROM artifact_ref").get() as {
        referrer_type: string
        referrer_id: string
        role: string
      }
      assert.deepEqual(ref, {
        referrer_type: "strategy_data_split",
        referrer_id: "split-report",
        role: "report",
      })
    } finally {
      db.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("strategy data split can read OHLCV directly from the database", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-data-split-db-"))
  try {
    const ohlcvDbPath = join(dir, "ohlcv.db")
    const db = new Database(ohlcvDbPath)
    try {
      createOhlcvTestSchema(db)
      const insert = db.query(`
        INSERT INTO canonical_candle(
          manifest_id, exchange, symbol, timeframe, open_time, close_time, open, high, low, close, volume
        )
        VALUES ($manifest_id, $exchange, $symbol, $timeframe, $open_time, $close_time, $open, $high, $low, $close, $volume)
      `)
      for (const item of Array.from({ length: 600 }, (_, index) => {
        const openTime = 1_700_000_000_000 + index * 4 * 60 * 60 * 1000
        return {
          $manifest_id: "ohlcv-db-test",
          $exchange: "binanceusdm",
          $symbol: "ALTUSDT",
          $timeframe: "4h",
          $open_time: openTime,
          $close_time: openTime + 4 * 60 * 60 * 1000,
          $open: 100 + index,
          $high: 102 + index,
          $low: 98 + index,
          $close: 101 + index,
          $volume: 1000 + index,
        }
      })) {
        insert.run(item)
      }
    } finally {
      db.close()
    }

    const report = runStrategyDataSplit({
      splitId: "split-db",
      timeframe: "4h",
      outputRoot: join(dir, "splits"),
      maxHoldBars: 12,
      datasets: [{
        datasetId: "ALTUSDT",
        ohlcvDbPath,
        exchange: "binanceusdm",
        symbol: "ALTUSDT",
      }],
    })

    assert.equal(report.datasets[0].source_manifest_path, "ohlcv_store:canonical_candle/binanceusdm/ALTUSDT/4h")
    assert.equal(report.datasets[0].source_rows, 600)
    assert.equal(report.datasets[0].segments.every((segment) => existsSync(resolveRepoPath(segment.manifest_path))), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("strategy data split rejects mismatched dataset and split timeframes", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-data-split-timeframe-"))
  try {
    const ohlcvDbPath = join(dir, "ohlcv.db")
    const db = new Database(ohlcvDbPath)
    try {
      createOhlcvTestSchema(db)
    } finally {
      db.close()
    }

    assert.throws(() => runStrategyDataSplit({
      splitId: "split-timeframe-mismatch",
      timeframe: "4h",
      outputRoot: join(dir, "splits"),
      maxHoldBars: 1,
      datasets: [{
        datasetId: "ALTUSDT",
        ohlcvDbPath,
        exchange: "binanceusdm",
        symbol: "ALTUSDT",
        timeframe: "1h",
      }],
    }), /does not match split timeframe/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("strategy data split reports missing OHLCV schema as a domain error", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-data-split-missing-schema-"))
  try {
    const ohlcvDbPath = join(dir, "ohlcv.db")
    const db = new Database(ohlcvDbPath)
    db.close()

    assert.throws(() => runStrategyDataSplit({
      splitId: "split-missing-schema",
      timeframe: "4h",
      outputRoot: join(dir, "splits"),
      maxHoldBars: 1,
      datasets: [{
        datasetId: "ALTUSDT",
        ohlcvDbPath,
        exchange: "binanceusdm",
        symbol: "ALTUSDT",
      }],
    }), /ohlcv store schema is missing canonical_candle/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("strategy data split CLI stays read-only to trade DB and returns stable shell", async () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-data-split-cli-"))
  const runtimeDir = makeRuntimeDir("strategy-data-split-cli-")
  try {
    const manifestPath = writeManifest(join(dir, "source"), "ALTUSDT", 600)
    const dbPath = join(runtimeDir, "should-not-exist", "trade.db")
    const result = await run([
      "--json",
      JSON.stringify({
        split_id: "split-cli",
        timeframe: "4h",
        output_root: join(runtimeDir, "splits"),
        max_hold_bars: 8,
        datasets: [{ dataset_id: "ALTUSDT", manifest_path: manifestPath }],
      }),
    ])
    assert.equal(result.ok, true)
    const data = (result as { ok: true; data: { schema_version: string; dataset_count: number } }).data
    assert.equal(data.schema_version, "trade-flow.strategy-data-split.v1")
    assert.equal(data.dataset_count, 1)
    assert.equal(existsSync(dbPath), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("strategy data split output schema matches stable report shell", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-data-split-schema-"))
  try {
    const manifestPath = writeManifest(join(dir, "source"), "ALTUSDT", 600)
    const report = runStrategyDataSplit({
      splitId: "split-schema",
      outputRoot: join(dir, "split-output"),
      maxHoldBars: 4,
      datasets: [{ datasetId: "ALTUSDT", manifestPath }],
    }) as unknown as Record<string, unknown>
    const schema = readJsonFile("modules/research-strategy-development/data-split/src/schemas/strategy-data-split-result.schema.json")
    assert.equal(schema.$id, "trade-flow.strategy-data-split-result.v1")
    assert.equal(report.schema_version, "trade-flow.strategy-data-split.v1")
    assert.equal(report.dataset_count, 1)
    assertSchemaRequired(schema, report)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("strategy data split rejects lowering the research sample floor", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-data-split-floor-"))
  try {
    const manifestPath = writeManifest(join(dir, "source"), "ALTUSDT", 600)
    assert.throws(() => runStrategyDataSplit({
      splitId: "split-floor",
      outputRoot: join(dir, "split-output"),
      minSegmentRows: 60,
      datasets: [{ datasetId: "ALTUSDT", manifestPath }],
    }), /DATA-SPLIT-SAMPLE-FLOOR/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("strategy data split parser ignores camel-case aliases", () => {
  const input = strategyDataSplitInputFromJson({
    splitId: "bad",
    outputRoot: "/tmp/out",
    maxHoldBars: 12,
    datasets: [{ datasetId: "ALT", manifestPath: "/tmp/manifest.json" }],
  })
  assert.equal(input.splitId, undefined)
  assert.equal(input.outputRoot, undefined)
  assert.equal(input.maxHoldBars, undefined)
  assert.equal(input.datasets[0].datasetId, "")
  assert.equal(input.datasets[0].manifestPath, undefined)
})

function writeManifest(dir: string, symbol: string, rows: number): string {
  mkdirSync(dir, { recursive: true })
  const start = 1_700_000_000_000
  const csv = [
    "date,timestamp,open,high,low,close,volume",
    ...Array.from({ length: rows }, (_, index) => {
      const timestamp = start + index * 4 * 60 * 60 * 1000
      const open = 100 + index
      return [new Date(timestamp).toISOString(), timestamp, open, open + 2, open - 2, open + 1, 1000 + index].join(",")
    }),
  ].join("\n") + "\n"
  writeFileSync(join(dir, "4h.csv"), csv)
  const manifestPath = join(dir, "manifest.json")
  writeFileSync(manifestPath, JSON.stringify({
    schema_version: 2,
    source: { provider: "test" },
    closed_candles_only: true,
    symbol,
    requested_symbol: symbol,
    columns: ["date", "timestamp", "open", "high", "low", "close", "volume"],
    dedupe_key: "timestamp",
    timeframes: {
      "4h": {
        file: "4h.csv",
        rows,
        first_open_ts: start,
        last_open_ts: start + (rows - 1) * 4 * 60 * 60 * 1000,
      },
    },
  }))
  return manifestPath
}

function createOhlcvTestSchema(db: Database): void {
  db.run(`
    CREATE TABLE canonical_candle (
      manifest_id TEXT NOT NULL,
      exchange    TEXT NOT NULL,
      symbol      TEXT NOT NULL,
      timeframe   TEXT NOT NULL,
      open_time   BIGINT NOT NULL,
      close_time  BIGINT NOT NULL,
      open        DOUBLE NOT NULL,
      high        DOUBLE NOT NULL,
      low         DOUBLE NOT NULL,
      close       DOUBLE NOT NULL,
      volume      DOUBLE,
      quote_volume DOUBLE,
      PRIMARY KEY (exchange, symbol, timeframe, open_time)
    )
  `)
}

function makeRuntimeDir(prefix: string): string {
  const root = resolveRepoPath("tmp/test-runs")
  mkdirSync(root, { recursive: true })
  return mkdtempSync(join(root, prefix))
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function readJsonFile(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolveRepoPath(path), "utf8")) as Record<string, unknown>
}

function assertSchemaRequired(schema: Record<string, unknown>, value: Record<string, unknown>): void {
  for (const field of asArray(schema.required)) {
    assert.ok(Object.prototype.hasOwnProperty.call(value, field), `missing ${field}`)
  }
}

function asArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : []
}
