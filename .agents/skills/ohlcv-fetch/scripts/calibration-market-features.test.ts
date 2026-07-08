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

test("calibration market features records per-symbol failures and continues", async () => {
  const dir = mkdtempSync(join(tmpdir(), "calibration-market-features-fail-"))
  const panelManifestPath = join(dir, "panel-manifest.json")
  const btcDir = join(dir, "btcusdt")
  mkdirSync(btcDir, { recursive: true })
  writeFileSync(join(btcDir, "manifest.json"), JSON.stringify({ symbol: "BTCUSDT", timeframes: { "4h": { file: "4h.csv" } } }))
  writeFileSync(panelManifestPath, JSON.stringify({ datasets: [{ dataset_id: "BTCUSDT", symbol: "BTCUSDT", manifest_path: join(btcDir, "manifest.json") }] }))

  const result = await runCalibrationMarketFeatures([
    "--panel-manifest", panelManifestPath,
    "--output-root", join(dir, "features"),
  ], () => ({ ok: true, data: { timeframes: { "4h": { features: { "price.close": { values: [{ timestamp: "2021-01-01T00:00:00.000Z", value: 1 }] } } } } } }), async () => {
    throw new Error("funding endpoint unavailable")
  })

  assert.equal(result.ok, true)
  if (!result.ok) return
  const manifest = JSON.parse(readFileSync(String(result.data.panel_manifest_path), "utf8")) as { reports: Array<{ status: string; error: string; funding_event_count: number }> }
  assert.equal(manifest.reports[0].status, "failed")
  assert.match(manifest.reports[0].error, /funding endpoint unavailable/)
  assert.equal(manifest.reports[0].funding_event_count, 0)
  const suite = JSON.parse(readFileSync(String(result.data.suite_input_path), "utf8")) as { datasets: Array<{ indicator_report_path: string }> }
  assert.match(suite.datasets[0].indicator_report_path, /market-features\.json$/)

  const retried = await runCalibrationMarketFeatures([
    "--panel-manifest", panelManifestPath,
    "--output-root", join(dir, "features"),
  ], () => ({ ok: true, data: { timeframes: { "4h": { features: { "price.close": { values: [{ timestamp: "2021-01-01T00:00:00.000Z", value: 1 }] } } } } } }), async () => ({
    ok: true,
    data: { market_events: { funding: [{ timestamp: "2021-01-01T00:00:00.000Z", value: 0.0001 }] } },
  }))
  assert.equal(retried.ok, true)
  if (!retried.ok) return
  const retriedManifest = JSON.parse(readFileSync(String(retried.data.panel_manifest_path), "utf8")) as { reports: Array<{ status: string; funding_event_count: number }> }
  assert.equal(retriedManifest.reports[0].status, "ok")
  assert.equal(retriedManifest.reports[0].funding_event_count, 1)
})
