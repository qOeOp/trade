import assert from "node:assert/strict"
import test from "node:test"
import {
  buildCostModel,
  buildWeightSchedule,
  chronologicalFolds,
  negativeControlDiagnostics,
  regimeAttribution,
  simulate,
  stressCostModel,
} from "./strategy-benchmark-simulation"

test("canonical benchmark simulation normalizes costs and records attribution", () => {
  const cost = buildCostModel({
    datasets: [],
    makerFeeBps: 0.2,
    takerFeeBps: 1,
    marketOrderShare: 0.5,
    slippageBps: 0.4,
  })
  assert.equal(cost.effective_fee_bps, 0.6)
  assert.equal(cost.effective_slippage_bps, 0.2)
  assert.equal(stressCostModel(cost, 5).effective_cost_bps, 5.8)

  const panel = panelFixture()
  const weights = buildWeightSchedule(panel.closes, 3, [1, 2], 2, 2, "4h")
  const result = simulate(panel, weights, 3, 2, cost, 0, "4h")
  assert.ok(result.stats.sample_count > 0)
  assert.ok(result.attribution.rebalance_count > 0)
  assert.ok(result.attribution.total_cost_drag > 0)
})

test("benchmark simulation diagnostics remain deterministic", () => {
  const panel = panelFixture()
  const weights = [[0.5, -0.5], [0.25, -0.25], [0.5, -0.5]]
  const cost = buildCostModel({ datasets: [], feeBps: 0, slippageBps: 0, fundingBpsPer8h: 0 })
  const simulated = simulate(panel, weights, 3, 2, cost, 0, "4h")
  const controls = negativeControlDiagnostics(panel, weights, 3, 2, cost, "4h", 20, simulated.stats.sharpe, 7)
  assert.equal(controls.method, "portfolio_weight_time_shift_side_flip_asset_shuffle")
  assert.equal(controls.trials, 20)
  assert.ok(controls.time_shift)
  assert.ok(controls.side_flip)
  assert.ok(controls.asset_label_shuffle)
  assert.equal(chronologicalFolds(simulated.returns, 3, "4h").length, 3)
  assert.equal((regimeAttribution(panel, simulated.returns, 3, "4h").buckets as unknown[]).length, 4)
})

function panelFixture(): { timestamps: number[]; closes: number[][] } {
  const timestamps = Array.from({ length: 20 }, (_, index) => 1_600_000_000_000 + index * 14_400_000)
  return {
    timestamps,
    closes: [
      timestamps.map((_, index) => 100 + index * 2 + Math.sin(index / 3)),
      timestamps.map((_, index) => 120 - index + Math.cos(index / 4)),
    ],
  }
}
