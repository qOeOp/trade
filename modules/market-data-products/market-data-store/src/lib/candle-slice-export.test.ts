import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"
import { Database } from "bun:sqlite"
import { resolveRepoPath } from "../../../../contracts/runtime-core/src/paths"
import { ensureOhlcvSchema, upsertCanonicalCandles } from "./market-data-store"
import { exportCanonicalCandleSlice } from "./candle-slice-export"

test("market-data owner exports a content-addressed immutable candle slice", () => {
  const root = resolveRepoPath("tmp/test-runs")
  mkdirSync(root, { recursive: true })
  const dir = mkdtempSync(join(root, "market-candle-slice-"))
  const db = new Database(":memory:")
  try {
    ensureOhlcvSchema(db)
    upsertCanonicalCandles(db, Array.from({ length: 3 }, (_, index) => ({
      manifest_id: "manifest-1",
      exchange: "binanceusdm",
      symbol: "BTCUSDT",
      timeframe: "4h",
      open_time: 1_700_000_000_000 + index * 14_400_000,
      close_time: 1_700_000_000_000 + (index + 1) * 14_400_000 - 1,
      open: 100 + index,
      high: 102 + index,
      low: 98 + index,
      close: 101 + index,
      volume: 1_000 + index,
    })))
    const first = exportCanonicalCandleSlice(db, {
      exchange: "binanceusdm",
      symbol: "BTCUSDT",
      timeframe: "4h",
      output_root: dir,
      generated_at: "2026-07-23T00:00:00Z",
    })
    const second = exportCanonicalCandleSlice(db, {
      exchange: "binanceusdm",
      symbol: "BTCUSDT",
      timeframe: "4h",
      output_root: dir,
      generated_at: "2026-07-23T00:01:00Z",
    })
    assert.equal(first.slice_ref, second.slice_ref)
    assert.equal(first.rows, 3)
    assert.match(first.content_sha256, /^[a-f0-9]{64}$/)
    const manifest = JSON.parse(readFileSync(resolveRepoPath(first.manifest_path), "utf8")) as {
      source: { owner_ref: string }
      timeframes: Record<string, { rows: number; content_sha256: string }>
    }
    assert.equal(manifest.source.owner_ref, "market-data.store")
    assert.equal(manifest.timeframes["4h"]?.rows, 3)
    assert.equal(manifest.timeframes["4h"]?.content_sha256, first.content_sha256)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
