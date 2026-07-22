import assert from "node:assert/strict"
import test from "node:test"
import {
  compareCandidates,
  countActiveParameters,
  evaluateRndCandidate,
  evaluateRndRobustness,
  flippedSideParams,
  laggedEntryStrategy,
  rebuildSignalAtEntry,
  summarizeNegativeControl,
} from "../../../../../agent-roles/developer/candidate-batch-engine/src/lib/strategy-rnd-evaluation"
import type { ReplayResult, ReplaySignal, ReplayStrategy } from "../../../../../replay-execution-plane/compatibility/replay-engine/src/lib/replay-core"

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
  assert.equal(rebuilt?.reason, "fixture negative control entry lag")
})

test("strategy R&D entry-lag negative control replays source signal with bounded decision price", () => {
  const calls: Array<{ index: number; entryIndex: number; decisionPrice: number; candleCount: number }> = []
  const strategy: ReplayStrategy = {
    strategy_id: "fixture",
    default_timeframe: "4h",
    warmup_bars: 0,
    generateSignal(input) {
      calls.push({ index: input.index, entryIndex: input.entryIndex, decisionPrice: input.decisionPrice, candleCount: input.candles.length })
      return {
        side: "long",
        signal_index: input.index,
        entry_index: input.entryIndex,
        entry: input.decisionPrice,
        stop: input.decisionPrice - 10,
        target: input.decisionPrice + 20,
        reason: "fixture",
      }
    },
  }
  const candles = Array.from({ length: 20 }, (_, index) => ({
    date: new Date(1_700_000_000_000 + index * 4 * 60 * 60 * 1000).toISOString(),
    timestamp: 1_700_000_000_000 + index * 4 * 60 * 60 * 1000,
    open: 100 + index,
    high: 101 + index,
    low: 99 + index,
    close: 100 + index,
    volume: 1000,
  }))
  const lagged = laggedEntryStrategy(strategy, 3)
  const signal = lagged.generateSignal({
    candles,
    indicators: { ema20: [], ema50: [], ema200: [], atr14: [] },
    index: 10,
    entryIndex: 11,
    decisionPrice: 110,
    options: { manifestPath: "/tmp/manifest.json" },
  })

  assert.deepEqual(calls, [{ index: 7, entryIndex: 8, decisionPrice: 107, candleCount: 8 }])
  assert.equal(signal?.signal_index, 10)
  assert.equal(signal?.entry_index, 11)
  assert.equal(signal?.entry, 110)
  assert.equal(signal?.stop, 97)
  assert.equal(signal?.target, 136)
})

test("strategy R&D evaluation summarizes negative controls and gates blockers", () => {
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
  const negativeControlSummary = summarizeNegativeControl("side_flip", replay)
  assert.equal(negativeControlSummary.control_id, "side_flip")
  assert.equal(negativeControlSummary.sample_count, replay.sample_count)

  const gate = evaluateRndCandidate(replay, 9, [{ check_id: "RND-NEGATIVE-CONTROL-NOT-BEATEN", reason: "negative control beat candidate" }])
  assert.equal(gate.accepted, false)
  assert.deepEqual(gate.blocked_by.map((item) => item.check_id), [
    "RND-OOS-SAMPLE",
    "RND-OOS-EXPECTANCY",
    "RND-OOS-PROFIT-FACTOR",
    "RND-OOS-DRAWDOWN",
    "RND-OOS-EFFECTIVE-SAMPLE",
    "RND-OOS-EDGE-MARGIN",
    "RND-PARAM-COUNT",
    "RND-ROBUSTNESS-REGIME",
    "RND-ROBUSTNESS-COST",
    "RND-ROBUSTNESS-PARAM",
    "RND-NEGATIVE-CONTROL-NOT-BEATEN",
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

function strongerReport(replay: ReplayResult) {
  return {
    candidate_id: replay.strategy_id,
    description: "",
    family: "fixture",
    parameter_count: 1,
    params: {},
    replay,
    negative_controls: {
      method: "side_flip_and_entry_lag" as const,
      observed_sample_count: replay.sample_count,
      observed_avg_r: replay.avg_r,
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
