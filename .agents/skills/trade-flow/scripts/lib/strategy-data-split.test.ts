import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import assert from "node:assert/strict"
import test from "node:test"
import { run } from "../main"
import { loadCandlesFromManifest, loadManifest } from "./replay-core"
import { runStrategyDataSplit, strategyDataSplitInputFromJson } from "./strategy-data-split"

test("strategy data split writes discovery validation and locked holdout manifests with embargo gaps", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-data-split-"))
  try {
    const manifestPath = writeManifest(join(dir, "source"), "ALTUSDT", 300)
    const report = runStrategyDataSplit({
      splitId: "split-test",
      hypothesisId: "h-test",
      timeframe: "4h",
      outputRoot: join(dir, "splits"),
      maxHoldBars: 12,
      minSegmentRows: 30,
      datasets: [{ datasetId: "ALTUSDT", manifestPath }],
    })
    assert.equal(report.schema_version, "trade-flow.strategy-data-split.v1")
    assert.equal(report.guardrails.locked_holdout_reserved, true)
    assert.equal(report.datasets.length, 1)
    const segments = report.datasets[0].segments
    assert.deepEqual(segments.map((segment) => segment.segment), ["discovery", "validation", "locked_holdout"])
    assert.equal(segments.every((segment) => existsSync(segment.manifest_path)), true)
    assert.ok(segments[1].first_open_ts - segments[0].last_open_ts > report.embargo.milliseconds)
    assert.ok(segments[2].first_open_ts - segments[1].last_open_ts > report.embargo.milliseconds)

    const holdoutManifest = loadManifest(segments[2].manifest_path)
    const holdoutCandles = loadCandlesFromManifest(segments[2].manifest_path, holdoutManifest, "4h")
    assert.equal(holdoutCandles.length, segments[2].rows)
    assert.equal(holdoutManifest.closed_candles_only, true)
    assert.equal(asRecord(holdoutManifest.split).segment, "locked_holdout")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("strategy data split CLI stays read-only to trade DB and returns stable shell", async () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-data-split-cli-"))
  try {
    const manifestPath = writeManifest(join(dir, "source"), "ALTUSDT", 240)
    const dbPath = join(dir, "should-not-exist", "trade.db")
    const result = await run([
      "--db",
      dbPath,
      "--strategy-data-split",
      "--json",
      JSON.stringify({
        split_id: "split-cli",
        timeframe: "4h",
        output_root: join(dir, "splits"),
        max_hold_bars: 8,
        min_segment_rows: 20,
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
  assert.equal(input.datasets[0].manifestPath, "")
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
