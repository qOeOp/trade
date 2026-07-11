import assert from "node:assert/strict"
import test from "node:test"
import { Database } from "bun:sqlite"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { isAbsolute, join } from "node:path"
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
  assert.equal(isAbsolute(String(result.data.output_root)), false)
  assert.equal(isAbsolute(String(result.data.suite_input_path)), false)
  assert.equal(isAbsolute(String(result.data.panel_manifest_path)), false)
  assert.equal(calls.length, 2)
  assert.equal(calls[0].includes("--metrics-source"), true)
  assert.equal(isAbsolute(calls[0][calls[0].indexOf("--base-report") + 1]), true)
  const suite = JSON.parse(readFileSync(String(result.data.suite_input_path), "utf8")) as { datasets: Array<{ manifest_path: string; indicator_report_path: string }> }
  assert.equal(suite.datasets.length, 2)
  assert.equal(suite.datasets.every((item) => !isAbsolute(item.manifest_path) && !isAbsolute(item.indicator_report_path)), true)
  assert.match(suite.datasets[0].indicator_report_path, /market-features\.json$/)
  const manifest = JSON.parse(readFileSync(String(result.data.panel_manifest_path), "utf8")) as { panel_manifest_ref: string; suite_input_path: string; reports: Array<{ funding_event_count: number; base_report_path: string; market_features_path: string }> }
  assert.equal(isAbsolute(manifest.panel_manifest_ref), false)
  assert.equal(isAbsolute(manifest.suite_input_path), false)
  assert.equal(manifest.reports.every((item) => !isAbsolute(item.base_report_path) && !isAbsolute(item.market_features_path)), true)
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
  assert.equal(isAbsolute(suite.datasets[0].indicator_report_path), false)
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

test("calibration market features upserts funding and feature refs into market data store", async () => {
  const dir = mkdtempSync(join(tmpdir(), "calibration-market-features-store-"))
  const panelManifestPath = join(dir, "panel-manifest.json")
  const btcDir = join(dir, "btcusdt")
  const dbPath = join(dir, "market_data.db")
  mkdirSync(btcDir, { recursive: true })
  writeFileSync(join(btcDir, "manifest.json"), JSON.stringify({ symbol: "BTCUSDT", timeframes: { "4h": { file: "4h.csv" } } }))
  writeFileSync(panelManifestPath, JSON.stringify({
    datasets: [{ dataset_id: "BTCUSDT", symbol: "BTCUSDT", manifest_path: join(btcDir, "manifest.json") }],
  }))

  const result = await runCalibrationMarketFeatures([
    "--panel-manifest", panelManifestPath,
    "--output-root", join(dir, "features"),
    "--market-data-db", dbPath,
  ], () => ({
    ok: true,
    data: {
      timeframes: {
        "4h": {
          features: {
            "price.close": { values: [{ timestamp: "2021-01-01T00:00:00.000Z", value: 1 }] },
          },
        },
      },
    },
  }), async () => ({
    ok: true,
    data: {
      market_events: {
        funding: [
          { timestamp: "2021-01-01T00:00:00.000Z", value: 0.0001 },
          { timestamp: "2021-01-01T08:00:00.000Z", value: -0.0002 },
        ],
      },
      timeframes: { "4h": { features: {} } },
    },
  }))

  assert.equal(result.ok, true)
  if (!result.ok) return
  const store = result.data.market_data_store as {
    db: string
    funding_events_upserted: number
    funding_manifests: Array<{ manifest_id: string; events: number }>
    feature_manifests: Array<{ feature_manifest_id: string }>
  }
  assert.equal(isAbsolute(store.db), false)
  assert.equal(store.funding_events_upserted, 2)
  assert.equal(store.funding_manifests[0].events, 2)
  assert.match(store.feature_manifests[0].feature_manifest_id, /^market-features:binanceusdm:BTCUSDT:4h:/)

  const db = new Database(dbPath, { readonly: true })
  try {
    const fundingCount = db.query("SELECT COUNT(*) AS count FROM funding_event WHERE symbol = 'BTCUSDT'").get() as { count: number }
    const manifestCount = db.query("SELECT COUNT(*) AS count FROM market_manifest WHERE dataset_kind = 'funding_events'").get() as { count: number }
    const featureCount = db.query("SELECT COUNT(*) AS count FROM feature_manifest WHERE feature_set_id = 'crypto-market-features.v1'").get() as { count: number }
    assert.equal(fundingCount.count, 2)
    assert.equal(manifestCount.count, 1)
    assert.equal(featureCount.count, 1)
  } finally {
    db.close()
  }
})
