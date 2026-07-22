import assert from "node:assert/strict"
import test from "node:test"
import {
  buildAntiOverfitProof,
  buildReplayDiagnostics,
  buildRobustnessProof,
  evaluateReplayGate,
  summarizeTrades,
  type LegacyReplayEvaluationTrade,
} from "./legacy-research-evaluation"

const trade = (index: number, r: number): LegacyReplayEvaluationTrade => ({
  r,
  signal_time: new Date(Date.UTC(2026, 0, index * 2 + 1)).toISOString(),
  exit_time: new Date(Date.UTC(2026, 0, index * 2 + 2)).toISOString(),
  entry: 100,
  exit: 100 + r,
  stop: 99,
  regime: "bull_low_vol",
})

test("preserves legacy summary and candidate gate thresholds", () => {
  const trades = Array.from({ length: 30 }, (_, index) => trade(index, index % 3 === 0 ? -0.5 : 1))
  const stats = summarizeTrades(trades)
  assert.equal(stats.sample_count, 30)
  assert.equal(stats.total_r, 15)
  assert.deepEqual(evaluateReplayGate(stats), { shadow_candidate: true, live_small_candidate: false, blocked_by: [] })
  assert.deepEqual(evaluateReplayGate({ ...stats, sample_count: 29 }).blocked_by.map((item) => item.check_id), ["R-SAMPLE-SIZE"])
})

test("preserves legacy diagnostics and evaluation-only proofs", () => {
  const trades = Array.from({ length: 6 }, (_, index) => trade(index, index % 2 === 0 ? 1 : -0.25))
  const diagnostics = buildReplayDiagnostics(trades)
  assert.equal((diagnostics.metrics as Record<string, unknown>).sample_count, 6)
  assert.equal((buildAntiOverfitProof(trades, { antiOverfitStage: "locked_holdout" }) as Record<string, unknown>).stage, "locked_holdout")
  const robustness = buildRobustnessProof(trades)
  assert.equal((robustness.regime_slices as unknown[]).length, 1)
})
