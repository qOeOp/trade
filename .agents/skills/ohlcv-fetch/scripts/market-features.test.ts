import assert from "node:assert/strict"
import test from "node:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { alignForward, mergeMarketFeatures, runMarketFeatures } from "./market-features"

test("market features align causally and expose coverage limits", () => {
  const grid = [0, 4, 8, 12].map((hour) => new Date(hour * 3_600_000).toISOString())
  const aligned = alignForward([{ timestamp: grid[0], value: 0.01 }, { timestamp: grid[2], value: 0.02 }], grid, 5 * 3_600_000)
  assert.deepEqual(aligned.map((item) => item.value), [0.01, 0.01, 0.02, 0.02])

  const report = mergeMarketFeatures({ data: { timeframes: { "4h": { features: {} } } } }, "4h", grid, {
    funding: [{ timestamp: grid[0], value: 0.01 }], premium: [], openInterest: [], takerRatio: [],
  })
  const data = report.data as { market_feature_coverage: { capability_gaps: string[] }; market_events: { funding: unknown[] }; timeframes: { "4h": { features: Record<string, { factor_id: string; values: unknown[] }> } } }
  assert.ok(data.market_feature_coverage.capability_gaps.includes("true_liquidation_labels_unavailable"))
  assert.equal(data.market_events.funding.length, 1)
  assert.equal(data.timeframes["4h"].features["crypto.funding_rate"].values.length, 4)
  for (const [factorID, feature] of Object.entries(data.timeframes["4h"].features)) assert.equal(feature.factor_id, factorID)
})

test("market features keeps funding when recent REST market data fails", async () => {
  const dir = mkdtempSync(join(tmpdir(), "market-features-rest-fail-"))
  const baseReport = join(dir, "base.json")
  const grid = [0, 4].map((hour) => new Date(Date.UTC(2021, 0, 1, hour)).toISOString())
  writeFileSync(baseReport, JSON.stringify({ data: { timeframes: { "4h": { features: { "price.close": { values: grid.map((timestamp) => ({ timestamp, value: 1 })) } } } } } }))

  const report = await runMarketFeatures([
    "--symbol", "BTCUSDT",
    "--timeframe", "4h",
    "--since-ts", String(Date.UTC(2021, 0, 1)),
    "--base-report", baseReport,
    "--metrics-source", "rest",
    "--external", "false",
  ], async (url) => {
    if (url.includes("/fapi/v1/fundingRate")) return [{ fundingTime: Date.UTC(2021, 0, 1), fundingRate: "0.0001" }]
    if (url.includes("/fapi/v1/premiumIndexKlines")) return [[Date.UTC(2021, 0, 1), "0", "0", "0", "1"]]
    throw new Error("recent market unavailable")
  })

  const data = report.data as { market_events: { funding: unknown[] }; market_feature_coverage: { market_errors?: string[] } }
  assert.equal(data.market_events.funding.length, 1)
  assert.equal((data.market_feature_coverage.market_errors || []).length, 1)
})
