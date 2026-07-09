import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import assert from "node:assert/strict"
import test from "node:test"

import { ensureFeatureReport, type TechIndicatorRunner } from "./feature-report"

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

test("feature report helper runs tech-indicators from the skill directory when cache is stale", () => {
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
