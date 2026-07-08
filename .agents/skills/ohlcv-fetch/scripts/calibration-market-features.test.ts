import assert from "node:assert/strict"
import test from "node:test"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseArgs, runCalibrationMarketFeatures } from "./calibration-market-features"

test("calibration market features parser requires panel manifest", () => {
  assert.throws(() => parseArgs([]), /--panel-manifest is required/)
})

test("calibration market features writes funding-aware suite input", async () => {
  const dir = mkdtempSync(join(tmpdir(), "calibration-market-features-"))
  const panelManifestPath = join(dir, "panel-manifest.json")
  const btcDir = join(dir, "btcusdt")
  const ethDir = join(dir, "ethusdt")
  mkdirSync(btcDir, { recursive: true })
  mkdirSync(ethDir, { recursive: true })
  writeFileSync(join(btcDir, "manifest.json"), JSON.stringify({ symbol: "BTCUSDT", timeframes: { "4h": { file: "4h.csv" } } }))
  writeFileSync(join(ethDir, "manifest.json"), JSON.stringify({ symbol: "ETHUSDT", timeframes: { "4h": { file: "4h.csv" } } }))
  writeFileSync(panelManifestPath, JSON.stringify({
    since_ts: 1609459200000,
    datasets: [
      { dataset_id: "BTCUSDT", symbol: "BTCUSDT", manifest_path: join(btcDir, "manifest.json") },
      { dataset_id: "ETHUSDT", symbol: "ETHUSDT", manifest_path: join(ethDir, "manifest.json") },
    ],
  }))
  const calls: string[][] = []

  const result = await runCalibrationMarketFeatures([
    "--panel-manifest", panelManifestPath,
    "--output-root", join(dir, "features"),
    "--metrics-source", "rest",
    "--external", "false",
  ], (manifestPath) => ({
    ok: true,
    data: {
      source_manifest: manifestPath,
      timeframes: {
        "4h": {
          features: {
            "price.close": { values: [{ timestamp: "2021-01-01T00:00:00.000Z", value: 1 }] },
          },
        },
      },
    },
  }), async (argv) => {
    calls.push(argv)
    return {
      ok: true,
      data: {
        market_events: { funding: [{ timestamp: "2021-01-01T00:00:00.000Z", value: 0.0001 }] },
        timeframes: { "4h": { features: {} } },
      },
    }
  })

  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.data.dataset_count, 2)
  assert.equal(calls.length, 2)
  assert.equal(calls[0].includes("--metrics-source"), true)
  const suite = JSON.parse(readFileSync(String(result.data.suite_input_path), "utf8")) as { datasets: Array<{ indicator_report_path: string }> }
  assert.equal(suite.datasets.length, 2)
  assert.match(suite.datasets[0].indicator_report_path, /market-features\.json$/)
  const manifest = JSON.parse(readFileSync(String(result.data.panel_manifest_path), "utf8")) as { reports: Array<{ funding_event_count: number }> }
  assert.equal(manifest.reports[0].funding_event_count, 1)
})
