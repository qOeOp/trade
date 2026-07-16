import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import assert from "node:assert/strict"
import test from "node:test"

import { ensureFeatureReport, runTechIndicators, type TechIndicatorRunner } from "./feature-report"

test("feature report helper reuses valid cached feature series", () => {
  const dir = mkdtempSync(join(tmpdir(), "feature-report-"))
  try {
    const manifestPath = join(dir, "manifest.json")
    const outputPath = join(dir, "features.json")
    const payload = featurePayload(manifestPath, ["stc"])
    Bun.write(outputPath, JSON.stringify(payload))

    const result = ensureFeatureReport({
      manifestPath,
      outputPath,
      runner: () => {
        throw new Error("runner should not be called")
      },
    })

    assert.equal(result.status, "cached")
    assert.equal(result.feature_count, 1)
    assert.deepEqual(result.selected_indicators, ["stc"])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("feature report helper runs tech-indicators from the tool directory when cache is stale", () => {
  const dir = mkdtempSync(join(tmpdir(), "feature-report-"))
  try {
    const manifestPath = join(dir, "manifest.json")
    const outputPath = join(dir, "features.json")
    const calls: Array<{ cwd: string; manifestPath: string; indicators?: string; featureSeries: boolean }> = []
    const runner: TechIndicatorRunner = (input) => {
      calls.push(input)
      return {
        status: 0,
        stderr: "",
        stdout: JSON.stringify(featurePayload(manifestPath, ["stc", "vfi"])),
      }
    }

    const result = ensureFeatureReport({
      manifestPath,
      outputPath,
      indicators: "stc,vfi",
      techIndicatorsDir: join(dir, "tech-indicators"),
      runner,
    })

    assert.equal(result.status, "generated")
    assert.equal(result.feature_count, 2)
    assert.equal(calls[0].manifestPath, manifestPath)
    assert.equal(calls[0].indicators, "stc,vfi")
    assert.equal(calls[0].featureSeries, true)
    assert.match(calls[0].cwd, /tech-indicators$/)
    assert.equal(JSON.parse(readFileSync(outputPath, "utf8")).ok, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("feature report runner handles large feature-series output", { timeout: 60_000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), "feature-report-large-"))
  try {
    const manifestPath = join(dir, "manifest.json")
    const rows = Array.from({ length: 2_400 }, (_, index) => {
      const timestamp = 1_700_000_000_000 + index * 4 * 60 * 60 * 1000
      const close = 100 + Math.sin(index / 13) * 7 + index * 0.01
      const open = close - Math.sin(index / 5)
      return [new Date(timestamp).toISOString(), timestamp, open, Math.max(open, close) + 1, Math.min(open, close) - 1, close, 1_000 + index].join(",")
    })
    writeFileSync(join(dir, "4h.csv"), ["date,timestamp,open,high,low,close,volume", ...rows].join("\n"))
    writeFileSync(manifestPath, JSON.stringify({
      schema_version: 2,
      symbol: "TESTUSDT",
      exchange: "test",
      closed_candles_only: true,
      timeframes: { "4h": { file: "4h.csv", rows: rows.length } },
    }))

    const run = runTechIndicators({
      cwd: new URL("../../../../market-data-products/tech-indicators", import.meta.url).pathname,
      manifestPath,
      indicators: "stc,vfi",
      featureSeries: true,
    })

    assert.equal(run.status, 0)
    assert.equal(JSON.parse(run.stdout).ok, true)
    assert.ok(run.stdout.length > 1024 * 1024)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

function featurePayload(manifestPath: string, indicators: string[]): unknown {
  return {
    ok: true,
    data: {
      source_manifest: manifestPath,
      selected_indicators: Object.fromEntries(indicators.map((name) => [name, {}])),
      timeframes: {
        "4h": {
          features: Object.fromEntries(indicators.map((name) => [`${name}.value`, { status: "ok" }])),
        },
      },
    },
  }
}
