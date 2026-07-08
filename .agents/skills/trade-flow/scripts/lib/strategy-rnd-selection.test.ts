import assert from "node:assert/strict"
import test from "node:test"
import type { ReplayResult } from "./replay-core"
import type { StrategyRndCandidateReport } from "./strategy-rnd-evaluation"
import {
  buildFailureSummary,
  buildSelectionAudit,
  failureAreaForCheck,
  selectRndWinner,
  summarizeCandidateBlockers,
  type SelectionAudit,
} from "./strategy-rnd-selection"

test("strategy R&D selection blocks unstable rank reversal", () => {
  const candidateA = candidateReport("a", true, [3, 3, -10, -10])
  const candidateB = candidateReport("b", true, [-10, -10, 3, 3])
  const audit = buildSelectionAudit([candidateA, candidateB], 2)
  assert.equal(audit.evaluated_folds, 4)
  assert.equal(audit.rank_reversal_rate, 1)
  assert.equal(audit.blocked, true)
  assert.equal(selectRndWinner([candidateA, candidateB], audit), null)
})

test("strategy R&D selection chooses strongest accepted candidate when stable", () => {
  const stronger = candidateReport("stronger", true, [1, 1, 1, 1], { total_r: 4, avg_r: 0.4, oos_total_r: 3 })
  const weaker = candidateReport("weaker", true, [1, 1, 1, 1], { total_r: 2, avg_r: 0.2, oos_total_r: 1 })
  const winner = selectRndWinner([weaker, stronger], stableAudit())
  assert.ok(winner)
  assert.equal(winner.candidate_id, "stronger")
})

test("strategy R&D failure summary keeps blocker counts and next action deterministic", () => {
  const candidates = [
    candidateReport("sample", false, [0, 0, 0, 0], {}, ["RND-OOS-SAMPLE", "RND-OOS-EXPECTANCY"]),
    candidateReport("null", false, [0, 0, 0, 0], {}, ["RND-OOS-SAMPLE", "RND-NULL-NOT-BEATEN"]),
    candidateReport("accepted", true, [1, 1, 1, 1]),
  ]
  assert.deepEqual(summarizeCandidateBlockers(candidates), [
    { check_id: "RND-OOS-SAMPLE", count: 2 },
    { check_id: "RND-NULL-NOT-BEATEN", count: 1 },
    { check_id: "RND-OOS-EXPECTANCY", count: 1 },
  ])
  assert.equal(failureAreaForCheck("RND-NULL-NOT-BEATEN"), "negative_control")
  const summary = buildFailureSummary(candidates, stableAudit())
  assert.equal(summary.rejected_candidate_count, 2)
  assert.equal(summary.accepted_candidate_count, 1)
  assert.equal(summary.primary_failure_area, "sample_efficiency")
  assert.equal(summary.next_system_actions[0], "Move this hypothesis to panel R&D or loosen setup frequency before spending more single-asset trials.")
})

function stableAudit(): SelectionAudit {
  return {
    method: "four_block_rank_reversal",
    declared_trials: 2,
    candidate_count: 2,
    evaluated_folds: 0,
    rank_reversal_rate: null,
    blocked: false,
  }
}

function candidateReport(
  id: string,
  accepted: boolean,
  foldRValues: number[],
  score: { total_r?: number; avg_r?: number; oos_total_r?: number } = {},
  blockers: string[] = [],
): StrategyRndCandidateReport {
  const totalR = score.total_r ?? foldRValues.reduce((sum, value) => sum + value * 5, 0)
  const avgR = score.avg_r ?? totalR / (foldRValues.length * 5)
  return {
    candidate_id: id,
    description: "",
    family: "fixture",
    parameter_count: 1,
    params: {},
    replay: replayFixture(id, foldRValues, totalR, avgR, score.oos_total_r ?? totalR),
    null_controls: {
      method: "side_flip_and_entry_lag",
      observed_total_r: totalR,
      controls: [],
      blocked_by: [],
    },
    gate: {
      accepted,
      blocked_by: blockers.map((check_id) => ({ check_id, reason: check_id })),
    },
  }
}

function replayFixture(id: string, foldRValues: number[], totalR: number, avgR: number, oosTotalR: number): ReplayResult {
  return {
    strategy_id: id,
    symbol: "BTCUSDT",
    timeframe: "4h",
    sample_count: foldRValues.length * 5,
    win_rate: 0.5,
    avg_r: avgR,
    total_r: totalR,
    max_drawdown_r: 1,
    profit_factor: 1.2,
    expectancy_r: avgR,
    gate: {
      shadow_candidate: true,
      live_small_candidate: false,
      blocked_by: [],
    },
    trades: foldRValues.flatMap((r, foldIndex) => Array.from({ length: 5 }, (_, offset) => tradeFixture(foldIndex * 5 + offset, r))),
    assumptions: {
      anti_overfit: {
        oos_stats: {
          total_r: oosTotalR,
          avg_r: avgR,
        },
      },
    },
    provenance: {
      harness_hash: "harness",
      data_hash: "data",
      assumptions_hash: "assumptions",
      data_ref: "fixture",
      timeframe: "4h",
      data_schema_version: 1,
      closed_candles_only: true,
      manifest_checksum_verified: true,
    },
    notes: [],
  }
}

function tradeFixture(index: number, r: number): ReplayResult["trades"][number] {
  const time = new Date(Date.UTC(2026, 0, 1 + index)).toISOString()
  return {
    side: "long",
    signal_time: time,
    entry_time: time,
    exit_time: time,
    entry: 100,
    exit: 101,
    stop: 99,
    target: 102,
    r,
    outcome: "target",
    reason: "fixture",
    bars_held: 1,
    regime: "fixture",
  }
}
