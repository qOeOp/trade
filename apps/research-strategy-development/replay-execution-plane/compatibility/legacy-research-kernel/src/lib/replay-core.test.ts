import assert from "node:assert/strict"
import test from "node:test"
import { evaluateReplayGate } from "./replay-core"

test("legacy evaluation gate distinguishes weak and admissible research samples", () => {
  const weak = evaluateReplayGate({
    sample_count: 10,
    avg_r: -0.1,
    total_r: -1,
    max_drawdown_r: 12,
    profit_factor: 0.8,
  })
  assert.equal(weak.shadow_candidate, false)
  assert.deepEqual(weak.blocked_by.map((item) => item.check_id), [
    "R-SAMPLE-SIZE",
    "R-EXPECTANCY",
    "R-PROFIT-FACTOR",
    "R-DRAWDOWN",
  ])

  const admissible = evaluateReplayGate({
    sample_count: 30,
    avg_r: 0.2,
    total_r: 6,
    max_drawdown_r: 4,
    profit_factor: 1.2,
  })
  assert.equal(admissible.shadow_candidate, true)
  assert.deepEqual(admissible.blocked_by, [])
})
