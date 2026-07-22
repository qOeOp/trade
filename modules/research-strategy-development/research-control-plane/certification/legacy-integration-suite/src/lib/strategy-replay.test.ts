import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import assert from "node:assert/strict"
import test from "node:test"

import { detectReplayDecisionLookahead, evaluateLatestSignal, evaluateReplayGate, replayStrategy, replayTrendPullback, simulateReplayOrderLane } from "../../../../../replay-execution-plane/compatibility/legacy-research-kernel/src/lib/strategy-replay"
import type { ReplayStrategy } from "../../../../../replay-execution-plane/compatibility/legacy-research-contracts/src/lib/legacy-research-contracts"
import { parseCsvCandles, type Candle } from "../../../../../replay-execution-plane/compatibility/legacy-research-data/src/lib/legacy-research-data"

test("parseCsvCandles reads OHLCV rows", () => {
  const candles = parseCsvCandles([
    "date,timestamp,open,high,low,close,volume",
    "2026-01-01T00:00:00Z,1,100,110,90,105,10",
  ].join("\n"))

  assert.equal(candles.length, 1)
  assert.equal(candles[0].close, 105)
})

test("replayTrendPullback produces mechanical samples from manifest", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-replay-"))
  try {
    const candles = buildSyntheticTrendCandles()
    writeFileSync(join(dir, "4h.csv"), [
      "date,timestamp,open,high,low,close,volume",
      ...candles.map((item, index) => [
        new Date(1_700_000_000_000 + index * 4 * 60 * 60 * 1000).toISOString(),
        1_700_000_000_000 + index * 4 * 60 * 60 * 1000,
        item.open,
        item.high,
        item.low,
        item.close,
        item.volume,
      ].join(",")),
    ].join("\n"))
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({
      symbol: "BTCUSDT",
      timeframes: {
        "4h": {
          file: "4h.csv",
        },
      },
    }))

    const result = replayTrendPullback({
      manifestPath: join(dir, "manifest.json"),
      maxHoldBars: 8,
      rewardRisk: 1.5,
    })

    assert.equal(result.strategy_id, "S-BTC-4H-TREND-PULLBACK")
    assert.equal(result.symbol, "BTCUSDT")
    assert.ok(result.sample_count > 0)
    assert.ok(Number.isFinite(result.avg_r))
    assert.ok(result.trades.every((trade) => trade.side === "long"))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("replayStrategy runs a custom strategy definition through generic engine", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-replay-core-"))
  try {
    writeReplayFixture(dir)
    const customStrategy: ReplayStrategy = {
      strategy_id: "S-CUSTOM-ONE-SHOT",
      default_timeframe: "4h",
      warmup_bars: 1,
      generateSignal({ decisionPrice, index }) {
        if (index !== 1) {
          return null
        }
        return {
          side: "long",
          signal_index: index,
          entry_index: index + 1,
          entry: decisionPrice,
          stop: decisionPrice - 1,
          target: decisionPrice + 2,
          reason: "test one-shot",
        }
      },
    }

    const result = replayStrategy(customStrategy, {
      manifestPath: join(dir, "manifest.json"),
      maxHoldBars: 3,
    })

    assert.equal(result.strategy_id, "S-CUSTOM-ONE-SHOT")
    assert.equal(result.sample_count, 1)
    assert.equal(result.trades[0].reason, "test one-shot")
    assert.equal(result.trades[0].signal_time, "2026-01-01T04:00:00Z")
    assert.equal(result.provenance.temporal_contract.method, "closed_candle_replay_v1")
    assert.equal(result.provenance.temporal_contract.reference_at, "2026-01-01T12:00:00.000Z")
    assert.equal(result.provenance.temporal_contract.availability_at, "2026-01-01T16:00:00.000Z")
    assert.equal(result.provenance.temporal_contract.lookback_start, "2026-01-01T00:00:00.000Z")
    assert.equal(result.provenance.temporal_contract.label_end, "2026-01-01T12:00:00.000Z")
    assert.equal(result.provenance.temporal_contract.universe_selection_source, "dataset_start_fallback")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("replayStrategy gives strategies only an immutable cutoff snapshot", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-replay-cutoff-"))
  try {
    writeReplayFixture(dir)
    let inspected = false
    const strategy: ReplayStrategy = {
      strategy_id: "S-CUTOFF-BOUNDARY",
      default_timeframe: "4h",
      warmup_bars: 1,
      generateSignal({ candles, indicators, index, decisionPrice }) {
        if (index !== 1) return null
        inspected = true
        assert.equal(candles.length, index + 1)
        assert.equal(candles[index + 1], undefined)
        assert.equal(indicators.atr14.length, index + 1)
        assert.equal(Object.isFrozen(candles), true)
        assert.equal(Object.isFrozen(candles[index]), true)
        assert.equal(Object.isFrozen(indicators.atr14), true)
        return {
          side: "long",
          signal_index: index,
          entry_index: index + 1,
          entry: decisionPrice,
          stop: decisionPrice - 1,
          target: decisionPrice + 2,
          reason: "cutoff boundary",
        }
      },
    }

    const result = replayStrategy(strategy, { manifestPath: join(dir, "manifest.json") })
    assert.equal(inspected, true)
    assert.equal(result.sample_count, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("future next-open gaps cannot change the prior decision and are enforced at fill time", () => {
  const root = mkdtempSync(join(tmpdir(), "strategy-replay-gap-boundary-"))
  try {
    const stableDir = join(root, "stable")
    const gapDir = join(root, "gap")
    const decisions: Record<string, Array<Record<string, unknown>>> = { stable: [], gap: [] }
    for (const [name, dir, nextOpen] of [["stable", stableDir, 100], ["gap", gapDir, 120]] as const) {
      mkdirSync(dir)
      writeFileSync(join(dir, "4h.csv"), [
        "date,timestamp,open,high,low,close,volume",
        "2026-01-01T00:00:00Z,1767225600000,100,101,99,100,10",
        "2026-01-01T04:00:00Z,1767240000000,100,101,99,100,10",
        `2026-01-01T08:00:00Z,1767254400000,${nextOpen},${nextOpen + 2},99,${nextOpen},10`,
        `2026-01-01T12:00:00Z,1767268800000,${nextOpen},${nextOpen + 3},98,${nextOpen + 1},10`,
      ].join("\n"))
      writeFileSync(join(dir, "manifest.json"), JSON.stringify({ symbol: "BTCUSDT", timeframes: { "4h": { file: "4h.csv" } } }))
      const strategy: ReplayStrategy = {
        strategy_id: `S-GAP-BOUNDARY-${name}`,
        default_timeframe: "4h",
        warmup_bars: 1,
        generateSignal({ candles, index, decisionPrice }) {
          if (index !== 1) return null
          decisions[name].push({ decisionPrice, candleCount: candles.length, lastClose: candles[index].close })
          return {
            side: "long",
            signal_index: index,
            entry_index: index + 1,
            entry: decisionPrice,
            stop: decisionPrice - 1,
            target: decisionPrice + 2,
            entry_risk_limit: 5,
            reason: "gap execution boundary",
          }
        },
      }
      const result = replayStrategy(strategy, { manifestPath: join(dir, "manifest.json") })
      assert.equal(result.sample_count, name === "stable" ? 1 : 0)
    }
    assert.deepEqual(decisions.stable, decisions.gap)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("full-vs-cutoff detector passes causal strategies and catches future-capturing factories", () => {
  const candles = parseCsvCandles([
    "date,timestamp,open,high,low,close,volume",
    ...Array.from({ length: 12 }, (_, index) => {
      const value = 100 + index
      return `${new Date(1_700_000_000_000 + index * 14_400_000).toISOString()},${1_700_000_000_000 + index * 14_400_000},${value},${value + 1},${value - 1},${value},10`
    }),
  ].join("\n"))
  const causal: ReplayStrategy = {
    strategy_id: "S-CAUSAL-DETECTOR",
    default_timeframe: "4h",
    warmup_bars: 1,
    generateSignal({ index, decisionPrice }) {
      return index % 3 === 0
        ? { side: "long", signal_index: index, entry_index: index + 1, entry: decisionPrice, stop: decisionPrice - 1, target: decisionPrice + 2, reason: "causal" }
        : null
    },
  }
  const causalReport = detectReplayDecisionLookahead(causal, candles, { manifestPath: "/tmp/detector.json" })
  assert.equal(causalReport.status, "passed")
  assert.equal(causalReport.coverage, "complete")

  const futureCapturingFactory = (visible: Candle[]): ReplayStrategy => ({
    strategy_id: "S-FUTURE-CAPTURE",
    default_timeframe: "4h",
    warmup_bars: 1,
    generateSignal({ index, decisionPrice }) {
      return visible[index + 1]
        ? { side: "long", signal_index: index, entry_index: index + 1, entry: decisionPrice, stop: decisionPrice - 1, target: decisionPrice + 2, reason: "future capture" }
        : null
    },
  })
  const leaked = detectReplayDecisionLookahead(futureCapturingFactory(candles), candles, { manifestPath: "/tmp/detector.json" }, {
    cutoffStrategyFactory: (prefix) => futureCapturingFactory(prefix),
  })
  assert.equal(leaked.status, "failed")
  assert.ok(leaked.mismatch_count > 0)
})

test("replayStrategy charges adverse funding and fills a stop gap at the worse open", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-replay-gap-"))
  try {
    writeFileSync(join(dir, "4h.csv"), [
      "date,timestamp,open,high,low,close,volume",
      "2026-01-01T00:00:00Z,1767225600000,100,101,99,100,10",
      "2026-01-01T04:00:00Z,1767240000000,100,101,99,100,10",
      "2026-01-01T08:00:00Z,1767254400000,100,101,99,100,10",
      "2026-01-01T12:00:00Z,1767268800000,95,96,94,95,10",
    ].join("\n"))
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ symbol: "BTCUSDT", timeframes: { "4h": { file: "4h.csv" } } }))
    const strategy: ReplayStrategy = {
      strategy_id: "S-GAP",
      default_timeframe: "4h",
      warmup_bars: 1,
      generateSignal({ index }) {
        return index === 1 ? { side: "long", signal_index: 1, entry_index: 2, entry: 100, stop: 98, target: 110, reason: "gap test" } : null
      },
    }
    const result = replayStrategy(strategy, {
      manifestPath: join(dir, "manifest.json"), maxHoldBars: 2, fundingBpsPer8h: 2,
      fundingEvents: [{ timestamp: "2026-01-01T12:00:00Z", value: 0.01 }],
    })
    assert.equal(result.trades[0].exit, 95)
    assert.equal(result.trades[0].fill_model?.model, "ohlcv_intrabar_conservative_v1")
    assert.equal((result.trades[0].fill_model?.exit_fill as { gap_adjusted?: boolean }).gap_adjusted, true)
    assert.ok(result.trades[0].r < -3)
    assert.ok(Number(result.trades[0].funding_r) > 0.5)
    assert.equal(result.assumptions.funding_model, "historical_events_entry_notional")
    assert.ok(result.gate.blocked_by.some((item) => item.check_id === "R-FUNDING-COVERAGE"))
    assert.equal(result.assumptions.stop_gap_policy, "next_open_if_worse")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("replayStrategy exposes conservative same-bar stop-first fill policy", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-replay-same-bar-"))
  try {
    writeFileSync(join(dir, "4h.csv"), [
      "date,timestamp,open,high,low,close,volume",
      "2026-01-01T00:00:00Z,1767225600000,100,101,99,100,10",
      "2026-01-01T04:00:00Z,1767240000000,100,101,99,100,10",
      "2026-01-01T08:00:00Z,1767254400000,100,103,97,101,10",
      "2026-01-01T12:00:00Z,1767268800000,101,102,100,101,10",
    ].join("\n"))
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ symbol: "BTCUSDT", timeframes: { "4h": { file: "4h.csv" } } }))
    const strategy: ReplayStrategy = {
      strategy_id: "S-SAME-BAR",
      default_timeframe: "4h",
      warmup_bars: 1,
      generateSignal({ index }) {
        return index === 1 ? { side: "long", signal_index: 1, entry_index: 2, entry: 100, stop: 98, target: 102, reason: "same bar" } : null
      },
    }
    const result = replayStrategy(strategy, { manifestPath: join(dir, "manifest.json"), maxHoldBars: 1 })
    assert.equal(result.trades[0].outcome, "stop")
    assert.equal(result.assumptions.same_candle_policy, "stop_first")
    assert.equal((result.trades[0].fill_model?.policies as { same_candle_policy?: string }).same_candle_policy, "stop_first")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("simulateReplayOrderLane applies stop-first ordering and caps oversized reduce-only stop", () => {
  const candles = parseCsvCandles([
    "date,timestamp,open,high,low,close,volume",
    "2026-01-01T00:00:00Z,1,100,111,89,100,10",
  ].join("\n"))
  const result = simulateReplayOrderLane({
    candles,
    initial_position_qty: 1,
    initial_entry_price: 100,
    initial_risk_per_unit: 10,
    orders: [
      { id: "tp-1", role: "take_profit", side: "SELL", kind: "limit", price: 110, quantity: 0.4, reduce_only: true },
      { id: "stop-1", role: "stop", side: "SELL", kind: "stop_market", stop_price: 90, quantity: 2, reduce_only: true },
    ],
  })

  assert.deepEqual(result.fills.map((fill) => fill.order_id), ["stop-1"])
  assert.equal(result.fills[0].quantity, 1)
  assert.equal(result.fills[0].requested_quantity, 2)
  assert.equal(result.fills[0].reduced_only_cap_applied, true)
  assert.equal(result.final_position_qty, 0)
  assert.equal(result.assumptions.intrabar_order_sort, "stop_reduce_only_then_take_profit_then_entry_by_id")
})

test("simulateReplayOrderLane handles partial take profit before later oversized stop", () => {
  const candles = parseCsvCandles([
    "date,timestamp,open,high,low,close,volume",
    "2026-01-01T00:00:00Z,1,100,111,99,108,10",
    "2026-01-01T04:00:00Z,2,108,109,89,92,10",
  ].join("\n"))
  const result = simulateReplayOrderLane({
    candles,
    initial_position_qty: 1,
    initial_entry_price: 100,
    initial_risk_per_unit: 10,
    orders: [
      { id: "tp-1", role: "take_profit", side: "SELL", kind: "limit", price: 110, quantity: 0.4, reduce_only: true },
      { id: "stop-1", role: "stop", side: "SELL", kind: "stop_market", stop_price: 90, quantity: 2, reduce_only: true },
    ],
  })

  assert.deepEqual(result.fills.map((fill) => [fill.order_id, fill.quantity]), [["tp-1", 0.4], ["stop-1", 0.6]])
  assert.equal(result.fills[1].reduced_only_cap_applied, true)
  assert.equal(result.final_position_qty, 0)
  assert.equal(result.realized_r_multiple_initial, -0.2)
  assert.equal(result.realized_r_multiple_max_live_risk, -0.2)
})

test("replayStrategy applies break-even protection only after a completed trigger bar", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-replay-break-even-"))
  try {
    writeFileSync(join(dir, "4h.csv"), [
      "date,timestamp,open,high,low,close,volume",
      "2026-01-01T00:00:00Z,1767225600000,100,101,99,100,10",
      "2026-01-01T04:00:00Z,1767240000000,100,101,99,100,10",
      "2026-01-01T08:00:00Z,1767254400000,100,111,99,108,10",
      "2026-01-01T12:00:00Z,1767268800000,108,109,99,100,10",
      "2026-01-01T16:00:00Z,1767283200000,100,101,89,90,10",
    ].join("\n"))
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ symbol: "BTCUSDT", timeframes: { "4h": { file: "4h.csv" } } }))
    const strategy: ReplayStrategy = {
      strategy_id: "S-BREAK-EVEN",
      default_timeframe: "4h",
      warmup_bars: 1,
      generateSignal({ index }) {
        return index === 1
          ? {
            side: "long",
            signal_index: 1,
            entry_index: 2,
            entry: 100,
            stop: 90,
            target: 130,
            break_even_after_r: 1,
            reason: "break-even test",
          }
          : null
      },
    }

    const result = replayStrategy(strategy, {
      manifestPath: join(dir, "manifest.json"),
      maxHoldBars: 3,
    })

    assert.equal(result.trades[0].outcome, "stop")
    assert.equal(result.trades[0].exit, 100)
    assert.equal(result.trades[0].stop, 100)
    assert.equal(result.trades[0].r, 0)
    assert.equal(result.assumptions.protective_stop_policy, "optional_break_even_stop_activates_next_bar")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("replayStrategy emits diagnostic-only monte carlo metrics", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-replay-diagnostics-"))
  try {
    writeMultiReplayFixture(dir)
    const strategy: ReplayStrategy = {
      strategy_id: "S-DIAGNOSTICS",
      default_timeframe: "4h",
      warmup_bars: 1,
      generateSignal({ decisionPrice, index }) {
        if (index !== 1 && index !== 3) return null
        return { side: "long", signal_index: index, entry_index: index + 1, entry: decisionPrice, stop: decisionPrice - 1, target: decisionPrice + 2, reason: "diagnostic" }
      },
    }
    const result = replayStrategy(strategy, { manifestPath: join(dir, "manifest.json"), maxHoldBars: 2 })
    const diagnostics = result.diagnostics as { schema_version: string; promotion_effect: string; monte_carlo: { trade_order_shuffle: { status: string } } }
    assert.equal(diagnostics.schema_version, "trade-flow.replay-diagnostics.v1")
    assert.equal(diagnostics.promotion_effect, "diagnostic_only_cannot_authorize")
    assert.equal(diagnostics.monte_carlo.trade_order_shuffle.status, "evaluated")
    assert.match(result.notes.join("\n"), /diagnostic-only/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("replayStrategy can attach chronological OOS anti-overfit proof", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-replay-oos-"))
  try {
    writeMultiReplayFixture(dir)
    const customStrategy: ReplayStrategy = {
      strategy_id: "S-CUSTOM-MULTI",
      default_timeframe: "4h",
      warmup_bars: 1,
      generateSignal({ decisionPrice, index }) {
        if (index !== 1 && index !== 3) {
          return null
        }
        return {
          side: "long",
          signal_index: index,
          entry_index: index + 1,
          entry: decisionPrice,
          stop: decisionPrice - 1,
          target: decisionPrice + 2,
          reason: "test multi",
        }
      },
    }

    const result = replayStrategy(customStrategy, {
      manifestPath: join(dir, "manifest.json"),
      maxHoldBars: 3,
      oosSplitRatio: 0.5,
      trialCount: 2,
      parameterCount: 3,
    })
    const proof = result.assumptions.anti_overfit as { oos_stats: { sample_count: number }; trial_count: number; parameter_count: number }

    assert.equal(proof.oos_stats.sample_count, 1)
    assert.equal(proof.trial_count, 2)
    assert.equal(proof.parameter_count, 3)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("locked holdout evaluates the complete frozen dataset", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-replay-holdout-"))
  try {
    writeMultiReplayFixture(dir)
    const customStrategy: ReplayStrategy = {
      strategy_id: "S-CUSTOM-HOLDOUT",
      default_timeframe: "4h",
      warmup_bars: 1,
      generateSignal({ decisionPrice, index }) {
        if (index !== 1 && index !== 3) return null
        return {
          side: "long",
          signal_index: index,
          entry_index: index + 1,
          entry: decisionPrice,
          stop: decisionPrice - 1,
          target: decisionPrice + 2,
          reason: "test locked holdout",
        }
      },
    }

    const result = replayStrategy(customStrategy, {
      manifestPath: join(dir, "manifest.json"),
      maxHoldBars: 3,
      antiOverfitStage: "locked_holdout",
    })
    const proof = result.assumptions.anti_overfit as {
      stage: string
      train_stats?: unknown
      oos_stats: { sample_count: number }
    }

    assert.equal(proof.stage, "locked_holdout")
    assert.equal(proof.train_stats, undefined)
    assert.equal(proof.oos_stats.sample_count, result.sample_count)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("external validation evaluates the complete dataset without claiming holdout", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-replay-external-"))
  try {
    writeMultiReplayFixture(dir)
    const strategy: ReplayStrategy = {
      strategy_id: "S-EXTERNAL",
      default_timeframe: "4h",
      warmup_bars: 1,
      generateSignal({ decisionPrice, index }) {
        if (index !== 1 && index !== 3) return null
        return { side: "long", signal_index: index, entry_index: index + 1, entry: decisionPrice, stop: decisionPrice - 1, target: decisionPrice + 2, reason: "external" }
      },
    }
    const result = replayStrategy(strategy, { manifestPath: join(dir, "manifest.json"), antiOverfitStage: "external_validation" })
    const proof = result.assumptions.anti_overfit as { stage: string; oos_stats: { sample_count: number } }
    assert.equal(proof.stage, "external_validation")
    assert.equal(proof.oos_stats.sample_count, result.sample_count)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("evaluateLatestSignal uses the latest closed candle and external entry reference", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-latest-signal-parity-"))
  try {
    writeReplayFixture(dir)
    const strategy: ReplayStrategy = {
      strategy_id: "S-LATEST",
      default_timeframe: "4h",
      warmup_bars: 1,
      generateSignal({ candles, index, decisionPrice, entryIndex }) {
        return {
          side: "long",
          signal_index: index,
          entry_index: entryIndex,
          entry: decisionPrice,
          stop: decisionPrice - 1,
          target: decisionPrice + 2,
          reason: `latest:${candles[index].date}`,
        }
      },
    }
    const result = evaluateLatestSignal(strategy, {
      manifestPath: join(dir, "manifest.json"),
    }, 105, { now: "2026-01-01T16:01:00Z", maxAgeBars: 1 })

    assert.equal(result.signal_time, "2026-01-01T12:00:00Z")
    assert.equal(result.entry_reference, 105)
    assert.equal(result.signal?.entry, 105)
    assert.equal(result.signal?.entry_index, 4)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("evaluateReplayGate blocks weak replay evidence", () => {
  const weak = evaluateReplayGate({
    sample_count: 12,
    avg_r: -0.1,
    total_r: -1.2,
    max_drawdown_r: 4,
    profit_factor: 0.8,
  })

  assert.equal(weak.shadow_candidate, false)
  assert.equal(weak.live_small_candidate, false)
  assert.deepEqual(weak.blocked_by.map((item) => item.check_id), [
    "R-SAMPLE-SIZE",
    "R-EXPECTANCY",
    "R-PROFIT-FACTOR",
  ])

  const strong = evaluateReplayGate({
    sample_count: 45,
    avg_r: 0.12,
    total_r: 5.4,
    max_drawdown_r: 6,
    profit_factor: 1.35,
  })
  assert.equal(strong.shadow_candidate, true)
  assert.equal(strong.live_small_candidate, false)
  assert.deepEqual(strong.blocked_by, [])
})

function buildSyntheticTrendCandles(): Array<{ open: number; high: number; low: number; close: number; volume: number }> {
  const candles: Array<{ open: number; high: number; low: number; close: number; volume: number }> = []
  let close = 100
  for (let index = 0; index < 260; index += 1) {
    const trend = index < 220 ? 0.25 : 0.35
    const pullback = index > 220 && index % 8 === 0 ? -3 : 0
    const open = close
    close = close + trend + pullback
    const high = Math.max(open, close) + 0.5
    const low = Math.min(open, close) - (pullback < 0 ? Math.abs(pullback) + 0.5 : 0.4)
    candles.push({
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(close.toFixed(2)),
      volume: 1000 + index,
    })
  }
  return candles
}

function writeReplayFixture(dir: string): void {
  writeFileSync(join(dir, "4h.csv"), [
    "date,timestamp,open,high,low,close,volume",
    "2026-01-01T00:00:00Z,1767225600000,100,101,99,100,10",
    "2026-01-01T04:00:00Z,1767240000000,100,101,99,100,10",
    "2026-01-01T08:00:00Z,1767254400000,100,103,99.5,102,10",
    "2026-01-01T12:00:00Z,1767268800000,102,104,101,103,10",
  ].join("\n"))
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({
    symbol: "BTCUSDT",
    timeframes: {
      "4h": {
        file: "4h.csv",
      },
    },
  }))
}

function writeMultiReplayFixture(dir: string): void {
  writeFileSync(join(dir, "4h.csv"), [
    "date,timestamp,open,high,low,close,volume",
    "2026-01-01T00:00:00Z,1767225600000,100,101,99,100,10",
    "2026-01-01T04:00:00Z,1767240000000,100,101,99,100,10",
    "2026-01-01T08:00:00Z,1767254400000,100,103,99.5,102,10",
    "2026-01-01T12:00:00Z,1767268800000,102,104,101,103,10",
    "2026-01-01T16:00:00Z,1767283200000,103,104,102,103,10",
    "2026-01-01T20:00:00Z,1767297600000,103,106,102.5,105,10",
    "2026-01-02T00:00:00Z,1767312000000,105,107,104,106,10",
  ].join("\n"))
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({
    symbol: "BTCUSDT",
    timeframes: {
      "4h": {
        file: "4h.csv",
      },
    },
  }))
}
