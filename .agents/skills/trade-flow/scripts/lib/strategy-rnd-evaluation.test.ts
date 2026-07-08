import assert from "node:assert/strict"
import test from "node:test"
import {
  compareCandidates,
  countActiveParameters,
  evaluateRndCandidate,
  evaluateRndRobustness,
  flippedSideParams,
  rebuildSignalAtEntry,
  summarizeNullControl,
} from "./strategy-rnd-evaluation"
import type { ReplayResult, ReplaySignal } from "./replay-core"

test("strategy R&D evaluation counts active parameters and flips side params", () => {
  assert.equal(countActiveParameters({
    side: "long",
    empty: "",
    nested: [1, 2],
    disabled: null,
    risk: 0.5,
  }), 4)
  assert.deepEqual(flippedSideParams({ side: "long", stopAtr: 1 }), { side: "short", stopAtr: 1 })
  assert.deepEqual(flippedSideParams({ side: "short" }), { side: "long" })
  assert.equal(flippedSideParams({ side: "both" }), null)
})

test("strategy R&D evaluation rebuilds delayed entry signal", () => {
  const signal: ReplaySignal = {
    side: "long",
    signal_index: 10,
    entry_index: 11,
    entry: 100,
    stop: 95,
    target: 110,
    reason: "fixture",
  }
  const rebuilt = rebuildSignalAtEntry(signal, 13, 14, 103)
  assert.equal(rebuilt?.entry, 103)
  assert.equal(rebuilt?.target, 119)
  assert.equal(rebuilt?.reason, "fixture null entry lag")
})

test("strategy R&D evaluation summarizes null controls and gates blockers", () => {
  const replay = replayFixture({
    total_r: 5,
    avg_r: 0.5,
    profit_factor: 1.2,
    oos_stats: {
      sample_count: 9,
      avg_r: -0.1,
      total_r: -1,
      max_drawdown_r: 11,
      profit_factor: 1,
    },
  })
  const nullSummary = summarizeNullControl("side_flip", replay)
  assert.equal(nullSummary.control_id, "side_flip")
  assert.equal(nullSummary.sample_count, replay.sample_count)

  const gate = evaluateRndCandidate(replay, 9, [{ check_id: "RND-NULL-NOT-BEATEN", reason: "null beat candidate" }])
  assert.equal(gate.accepted, false)
  assert.deepEqual(gate.blocked_by.map((item) => item.check_id), [
    "RND-OOS-SAMPLE",
    "RND-OOS-EXPECTANCY",
    "RND-OOS-PROFIT-FACTOR",
    "RND-OOS-DRAWDOWN",
    "RND-PARAM-COUNT",
    "RND-ROBUSTNESS-REGIME",
    "RND-ROBUSTNESS-COST",
    "RND-ROBUSTNESS-PARAM",
    "RND-NULL-NOT-BEATEN",
  ])
})

test("strategy R&D evaluation robustness and candidate comparison stay deterministic", () => {
  const weak = replayFixture({
    total_r: 1,
    avg_r: 0.1,
    oos_stats: {
      sample_count: 10,
      avg_r: 0.1,
      total_r: 1,
      max_drawdown_r: 1,
      profit_factor: 1.1,
    },
  })
  assert.deepEqual(evaluateRndRobustness(weak).map((item) => item.check_id), [
    "RND-ROBUSTNESS-REGIME",
    "RND-ROBUSTNESS-COST",
    "RND-ROBUSTNESS-PARAM",
  ])

  const stronger = replayFixture({
    total_r: 2,
    avg_r: 0.2,
    oos_stats: {
      sample_count: 10,
      avg_r: 0.3,
      total_r: 3,
      max_drawdown_r: 1,
      profit_factor: 1.2,
    },
  })
  assert.ok(compareCandidates(strongerReport(stronger), strongerReport(weak)) < 0)
})

function replayFixture(input: {
  total_r: number
  avg_r: number
  profit_factor?: number
  oos_stats: {
    sample_count: number
    avg_r: number
    total_r: number
    max_drawdown_r: number
    profit_factor: number
  }
}): ReplayResult {
  return {
    strategy_id: "fixture",
    symbol: "BTCUSDT",
    timeframe: "4h",
    sample_count: 12,
    win_rate: 0.5,
    avg_r: input.avg_r,
    total_r: input.total_r,
    expectancy_r: input.avg_r,
    profit_factor: input.profit_factor ?? 1.2,
    max_drawdown_r: 1,
    trades: [],
    gate: {
      shadow_candidate: true,
      live_small_candidate: false,
      blocked_by: [],
    },
    assumptions: {
      anti_overfit: {
        oos_stats: input.oos_stats,
        trial_count: 1,
        parameter_count: 1,
      },
      robustness: {
        regime_slices: [],
        cost_stress: {
          extra_bps_per_side: 0,
          stats: {
            avg_r: 0,
            total_r: 0,
          },
        },
        parameter_stability: {
          method: "none",
          evaluation_count: 0,
          positive_ratio: 0,
          worst_avg_r: 0,
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

function strongerReport(replay: ReplayResult) {
  return {
    candidate_id: replay.strategy_id,
    description: "",
    family: "fixture",
    parameter_count: 1,
    params: {},
    replay,
    null_controls: {
      method: "side_flip_and_entry_lag" as const,
      observed_total_r: replay.total_r,
      controls: [],
      blocked_by: [],
    },
    gate: {
      accepted: true,
      blocked_by: [],
    },
  }
}
