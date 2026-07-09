import assert from "node:assert/strict"
import test from "node:test"
import type { ReplayResult } from "./replay-core"
import type { StrategyRndCandidateReport } from "./strategy-rnd-evaluation"
import {
  buildFailureSummary,
  buildFullTrialStatisticalReport,
  buildReliabilityGate,
  buildSelectionAudit,
  failureAreaForCheck,
  selectRndWinner,
  summarizeCandidateBlockers,
  summarizeFailureLayers,
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
  assert.deepEqual(summarizeFailureLayers(summary.top_blockers), [
    { area: "sample_efficiency", count: 2 },
    { area: "edge_expectancy", count: 1 },
    { area: "negative_control", count: 1 },
  ])
  const gate = buildReliabilityGate(candidates, stableAudit(), null, summary)
  assert.equal(gate.status, "blocked")
  assert.equal(gate.decision, "move_to_panel")
  assert.equal(gate.more_trials_allowed, false)
  assert.equal(gate.sample_profile.candidate_count, 3)
  assert.equal(gate.sample_profile.min_oos_sample_count, 20)
})

test("strategy R&D reliability gate stops search after a candidate passes", () => {
  const winner = candidateReport("winner", true, [1, 1, 1, 1])
  const summary = buildFailureSummary([winner], stableAudit())
  const gate = buildReliabilityGate([winner], stableAudit(), winner, summary)
  assert.equal(gate.status, "candidate_ready")
  assert.equal(gate.decision, "draft_policy")
  assert.equal(gate.more_trials_allowed, false)
  assert.equal(gate.sample_profile.total_trade_count, 20)
})

test("strategy R&D full-trial report records universe and unresolved samples", () => {
  const winner = candidateReport("winner", true, [1, 1, 1, 1], { total_r: 4, avg_r: 0.2, oos_total_r: 3 })
  const rejected = candidateReport("rejected", false, [0, 0, 0, 0], {}, ["RND-OOS-EXPECTANCY"])
  const ready = buildFullTrialStatisticalReport([winner, rejected], stableAudit(), winner)
  assert.equal(ready.status, "candidate_ready")
  assert.equal(ready.trial_universe.declared_trials, 2)
  assert.deepEqual(ready.trial_universe.candidate_ids, ["winner", "rejected"])
  assert.equal(ready.trial_universe.winner_candidate_id, "winner")
  assert.equal(ready.multiple_testing_adjustment, "deflated_edge_probability_and_cscv_pbo")
  assert.equal(ready.deflated_edge_probability.status, "evaluated")
  assert.equal(ready.deflated_edge_probability.passed, true)
  assert.equal(ready.pbo.status, "evaluated")

  const thinWinner = candidateReport("thin", true, [1, 1], { total_r: 2, avg_r: 0.2, oos_total_r: 2 })
  thinWinner.replay.assumptions.anti_overfit = { oos_stats: { sample_count: 8, avg_r: 0.2, total_r: 1.6, profit_factor: 1.4 } }
  const unresolved = buildFullTrialStatisticalReport([thinWinner], stableAudit(), thinWinner)
  assert.equal(unresolved.status, "statistically_unresolved")
  assert.equal(unresolved.trial_universe.winner_candidate_id, null)
  assert.equal(unresolved.blocked_by[0].check_id, "RND-STAT-EFFECTIVE-SAMPLE")
})

test("strategy R&D full-trial report blocks high PBO selection risk", () => {
  const candidateA = candidateReport("a", true, [3, 0, -5, 1], { avg_r: 1, total_r: 20, oos_total_r: 20 })
  const candidateB = candidateReport("b", true, [3, 1, -3, -3], { avg_r: 0.9, total_r: 18, oos_total_r: 18 })
  const candidateC = candidateReport("c", true, [5, -3, 5, 0], { avg_r: 0.8, total_r: 16, oos_total_r: 16 })
  const report = buildFullTrialStatisticalReport([candidateA, candidateB, candidateC], stableAudit(), candidateA)
  assert.equal(report.pbo.status, "evaluated")
  assert.equal(report.pbo.passed, false)
  assert.equal(report.pbo.overfit_probability, 0.666667)
  assert.equal(report.status, "blocked")
  assert.equal(report.blocked_by.some((item) => item.check_id === "RND-STAT-PBO"), true)
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
          sample_count: 20,
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
      temporal_contract: temporalContract(),
    },
    notes: [],
  }
}

function temporalContract() {
  return {
    method: "closed_candle_replay_v1" as const,
    timeframe: "4h",
    closed_candle_only: true,
    reference_at: "2026-01-01T00:00:00.000Z",
    availability_at: "2026-01-01T04:00:00.000Z",
    lookback_start: "2026-01-01T00:00:00.000Z",
    label_end: "2026-01-01T04:00:00.000Z",
    universe_selected_at: "2026-01-01T00:00:00.000Z",
    universe_selection_source: "fixture",
    label_policy: "signals use closed candles; entries occur on next open; labels are available after exit candle close",
    supplemental_data: [],
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
