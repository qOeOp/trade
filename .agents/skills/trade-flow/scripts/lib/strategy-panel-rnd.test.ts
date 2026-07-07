import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import assert from "node:assert/strict"
import test from "node:test"
import { runStrategyPanelRnd, strategyPanelRndInputFromJson } from "./strategy-panel-rnd"

test("panel R&D pools samples but keeps per-asset evidence", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-panel-rnd-"))
  try {
    const manifestPath = writeManifest(dir)
    const report = runStrategyPanelRnd({
      panelId: "panel-test",
      datasets: ["BTC", "ETH", "SOL"].map((datasetId) => ({ datasetId, manifestPath })),
      candidates: [{ candidateId: "PANEL-LONG", params: { side: "long" } }],
    })
    assert.equal(report.dataset_count, 3)
    assert.equal((report.candidates as Array<{ assets: unknown[] }>)[0].assets.length, 3)
    assert.ok(Number((report.candidates as Array<{ pooled: { sample_count: number } }>)[0].pooled.sample_count) > 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("panel parser requires real dataset identifiers downstream", () => {
  const input = strategyPanelRndInputFromJson({
    funding_bps_per_8h: 1,
    datasets: [{ dataset_id: "BTC", manifest_path: "/tmp/btc.json" }],
    candidates: [{ candidate_id: "C-1", family: "trend_pullback_v1", params: { side: "long" } }],
  })
  assert.equal(input.datasets[0].datasetId, "BTC")
  assert.equal(input.candidates[0].candidateId, "C-1")
  assert.equal(input.fundingBpsPer8h, 1)
})

function writeManifest(dir: string): string {
  let close = 100
  const rows = Array.from({ length: 280 }, (_, index) => {
    const open = close
    close += 0.25 + (index > 220 && index % 8 === 0 ? -3 : 0)
    const timestamp = 1_700_000_000_000 + index * 14_400_000
    return [new Date(timestamp).toISOString(), timestamp, open, Math.max(open, close) + 0.5, Math.min(open, close) - 0.5, close, 1000 + index].join(",")
  })
  writeFileSync(join(dir, "4h.csv"), ["date,timestamp,open,high,low,close,volume", ...rows].join("\n"))
  const path = join(dir, "manifest.json")
  writeFileSync(path, JSON.stringify({ symbol: "TEST", timeframes: { "4h": { file: "4h.csv" } } }))
  return path
}
