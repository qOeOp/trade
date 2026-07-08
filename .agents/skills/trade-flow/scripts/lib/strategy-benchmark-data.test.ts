import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import assert from "node:assert/strict"
import test from "node:test"
import {
  alignedPanel,
  datasetDataHash,
  historicalFundingDrag,
  panelFindings,
  panelFundingEvents,
} from "./strategy-benchmark-data"

test("benchmark data builds aligned panel diagnostics over common timestamps", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-benchmark-data-panel-"))
  try {
    const datasets = [
      { datasetId: "A", manifestPath: writeManifest(dir, "A", 0, 5) },
      { datasetId: "B", manifestPath: writeManifest(dir, "B", 2, 3) },
    ]
    const panel = alignedPanel(datasets, "4h")
    assert.equal(panel.timestamps.length, 3)
    assert.equal(panel.diagnostics.dataset_count, 2)
    assert.equal(panel.diagnostics.aligned_rows, 3)
    assert.equal(panel.diagnostics.min_raw_rows, 3)
    assert.equal(panel.diagnostics.min_aligned_ratio, 1)
    assert.equal(panel.diagnostics.schema_version_ok, true)
    assert.equal(panel.diagnostics.closed_candles_only, true)
    assert.match(datasetDataHash(datasets[0], "4h"), /^[a-f0-9]{64}$/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("benchmark data classifies funding coverage and computes historical drag", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-benchmark-data-funding-"))
  try {
    const first = 1_600_000_000_000
    const full = panelFundingEvents([
      { datasetId: "A", manifestPath: "/tmp/a.json", indicatorReportPath: writeFundingReport(dir, "A", 0.001, first, 3) },
      { datasetId: "B", manifestPath: "/tmp/b.json", indicatorReportPath: writeFundingReport(dir, "B", -0.002, first, 3) },
    ], first, first + 16 * 3_600_000)
    assert.equal(full.coverage.status, "full")
    assert.deepEqual(full.coverage.event_counts, { A: 3, B: 3 })
    assert.equal(full.coverage.max_gap_hours, 8)
    assert.equal(historicalFundingDrag([1, -0.5], full.eventsByAsset, [0, 0], first - 1, first), 0.002)

    const partial = panelFundingEvents([
      { datasetId: "A", manifestPath: "/tmp/a.json", indicatorReportPath: writeFundingReport(dir, "A2", 0.001, first, 3) },
      { datasetId: "B", manifestPath: "/tmp/b.json" },
    ], first, first + 16 * 3_600_000)
    assert.equal(partial.coverage.status, "partial")
    assert.deepEqual(partial.coverage.missing_dataset_ids, ["B"])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("benchmark data panel findings stay deterministic", () => {
  assert.deepEqual(panelFindings({
    schema_version_ok: false,
    closed_candles_only: true,
    min_aligned_ratio: 0.5,
    aligned_rows: 10,
    min_raw_rows: 30,
  }).map((finding) => finding.check_id), [
    "CAL-PANEL-SCHEMA",
    "CAL-PANEL-ALIGNMENT",
  ])
})

function writeManifest(root: string, id: string, startIndex: number, length: number): string {
  const dir = join(root, id)
  mkdirSync(dir, { recursive: true })
  const csv = [
    "date,timestamp,open,high,low,close,volume",
    ...Array.from({ length }, (_, index) => {
      const actual = startIndex + index
      const timestamp = 1_600_000_000_000 + actual * 14_400_000
      const close = 100 + actual
      return [new Date(timestamp).toISOString(), timestamp, close - 1, close + 1, close - 2, close, 1000].join(",")
    }),
  ].join("\n")
  writeFileSync(join(dir, "4h.csv"), csv)
  const path = join(dir, "manifest.json")
  writeFileSync(path, JSON.stringify({
    schema_version: 2,
    source: { provider: "fixture", market: "synthetic" },
    closed_candles_only: true,
    symbol: id,
    timeframes: {
      "4h": {
        file: "4h.csv",
        content_sha256: createHash("sha256").update(csv).digest("hex"),
      },
    },
  }))
  return path
}

function writeFundingReport(root: string, id: string, value: number, first: number, count: number): string {
  const dir = join(root, id)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, "factors.json")
  writeFileSync(path, JSON.stringify({
    data: {
      market_events: {
        funding: Array.from({ length: count }, (_, index) => ({
          timestamp: new Date(first + index * 8 * 3_600_000).toISOString(),
          value,
        })),
      },
    },
  }))
  return path
}
