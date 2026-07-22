import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { loadCandlesFromManifest, loadManifest, parseCsvCandles } from "./legacy-research-data"

const csv = "date,timestamp,open,high,low,close,volume\n2026-01-01T00:00:00Z,1767225600000,1,2,0.5,1.5,10\n"

test("preserves legacy candle parsing", () => {
  assert.deepEqual(parseCsvCandles(csv), [{
    date: "2026-01-01T00:00:00Z",
    timestamp: 1767225600000,
    open: 1,
    high: 2,
    low: 0.5,
    close: 1.5,
    volume: 10,
  }])
})

test("loads one timeframe relative to its manifest", () => {
  const dir = mkdtempSync(join(tmpdir(), "legacy-research-data-"))
  const manifestPath = join(dir, "manifest.json")
  writeFileSync(join(dir, "BTCUSDT-4h.csv"), csv)
  writeFileSync(manifestPath, JSON.stringify({ timeframes: { "4h": { file: "BTCUSDT-4h.csv" } } }))
  const manifest = loadManifest(manifestPath)
  assert.equal(loadCandlesFromManifest(manifestPath, manifest, "4h").length, 1)
  assert.throws(() => loadCandlesFromManifest(manifestPath, manifest, "1h"), /missing timeframe/)
})
