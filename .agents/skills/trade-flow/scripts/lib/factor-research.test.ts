import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import assert from "node:assert/strict"
import test from "node:test"

import { loadFactorFeatureStore } from "./factor-engine"
import { researchFactorSeeds } from "./factor-research"
import type { Candle } from "./replay-core"

test("factor research keeps stable predictive factors and prunes correlated copies", () => {
  const dir = mkdtempSync(join(tmpdir(), "factor-research-"))
  try {
    const candles = buildCandles(900)
    const points = candles.map((candle, index) => ({
      timestamp: candle.date,
      value: index + 6 < candles.length ? candles[index + 6].close / candle.close - 1 : 0,
    }))
    const factor = (id: string) => ({
      status: "ok",
      factor_id: id,
      source_indicator: id.split(".")[0],
      output: "value",
      category: "momentum",
      roles: ["confirmation"],
      allowed_transforms: ["percentile"],
      values: points,
    })
    const reportPath = join(dir, "factor-report.json")
    writeFileSync(reportPath, JSON.stringify({ data: { timeframes: { "4h": { features: {
      "signal.primary": factor("signal.primary"),
      "signal.copy": factor("signal.copy"),
    } } } } }))

    const report = researchFactorSeeds(loadFactorFeatureStore(reportPath), candles, "4h", {
      horizonBars: 6,
      lookback: 60,
      minSamples: 300,
      minAbsIc: 0.05,
    })

    assert.equal(report.selected_factor_ids.length, 1)
    assert.equal(report.seeds.length, 2)
    assert.ok(report.profiles.some((item) => item.rejected_by.includes("redundant_correlation")))
    assert.ok(report.profiles.find((item) => item.accepted)?.fold_ics.filter((ic) => ic > 0).length! >= 2)
    assert.ok(report.profiles.find((item) => item.accepted)?.regime_ics.filter((item) => item.ic > 0).length! >= 2)
    assert.ok(report.profiles.find((item) => item.accepted)!.fdr_q_value <= 0.05)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

function buildCandles(count: number): Candle[] {
  return Array.from({ length: count }, (_, index) => {
    const slow = Math.sin(index / 35) * 12
    const amplitude = Math.floor(index / 90) % 2 === 0 ? 1.5 : 5
    const close = 100 + slow + Math.sin(index / 4) * amplitude
    const previous = index === 0 ? close : 100 + Math.sin((index - 1) / 35) * 12 + Math.sin((index - 1) / 4) * (Math.floor((index - 1) / 90) % 2 === 0 ? 1.5 : 5)
    return {
      date: new Date(1_700_000_000_000 + index * 4 * 60 * 60 * 1000).toISOString(),
      timestamp: 1_700_000_000_000 + index * 4 * 60 * 60 * 1000,
      open: previous,
      high: Math.max(previous, close) + amplitude * 0.2,
      low: Math.min(previous, close) - amplitude * 0.2,
      close,
      volume: 1_000 + index,
    }
  })
}
