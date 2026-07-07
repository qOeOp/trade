import assert from "node:assert/strict"
import test from "node:test"
import { alignForward, mergeMarketFeatures } from "./market-features"

test("market features align causally and expose coverage limits", () => {
  const grid = [0, 4, 8, 12].map((hour) => new Date(hour * 3_600_000).toISOString())
  const aligned = alignForward([{ timestamp: grid[0], value: 0.01 }, { timestamp: grid[2], value: 0.02 }], grid, 5 * 3_600_000)
  assert.deepEqual(aligned.map((item) => item.value), [0.01, 0.01, 0.02, 0.02])

  const report = mergeMarketFeatures({ data: { timeframes: { "4h": { features: {} } } } }, "4h", grid, {
    funding: [{ timestamp: grid[0], value: 0.01 }], premium: [], openInterest: [], takerRatio: [],
  })
  const data = report.data as { market_feature_coverage: { open_interest_history_limit_days: number }; timeframes: { "4h": { features: Record<string, { factor_id: string; values: unknown[] }> } } }
  assert.equal(data.market_feature_coverage.open_interest_history_limit_days, 30)
  assert.equal(data.timeframes["4h"].features["crypto.funding_rate"].values.length, 4)
  for (const [factorID, feature] of Object.entries(data.timeframes["4h"].features)) assert.equal(feature.factor_id, factorID)
})
