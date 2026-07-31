import assert from "node:assert/strict"
import test from "node:test"
import { buildIndicators } from "../../../legacy-research-features/src/lib/legacy-research-features"
import type { Candle } from "../../../legacy-research-data/src/lib/legacy-research-data"
import type { ReplayStrategy } from "../../../legacy-research-contracts/src/lib/legacy-research-contracts"
import { buildReplayDecisionInput, detectReplayDecisionLookahead, timeframeMilliseconds } from "./legacy-research-decision"

const candles: Candle[] = Array.from({ length: 6 }, (_, index) => ({
  date: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
  timestamp: Date.UTC(2026, 0, index + 1),
  open: index + 1,
  high: index + 2,
  low: index,
  close: index + 1,
  volume: 10,
}))

const causal: ReplayStrategy = {
  strategy_id: "causal",
  default_timeframe: "4h",
  warmup_bars: 1,
  generateSignal: () => null,
}

test("builds a frozen prefix-only decision input", () => {
  const input = buildReplayDecisionInput(candles, buildIndicators(candles), 2, { manifestPath: "unused" })
  assert.equal(input.candles.length, 3)
  assert.equal(input.indicators.atr14.length, 3)
  assert.equal(input.entryIndex, 3)
  assert.equal(Object.isFrozen(input), true)
  assert.equal(timeframeMilliseconds("4h"), 14_400_000)
})

test("preserves full-versus-cutoff decision integrity detection", () => {
  const report = detectReplayDecisionLookahead(causal, candles, { manifestPath: "unused" })
  assert.equal(report.status, "passed")
  assert.equal(report.coverage, "complete")
})
