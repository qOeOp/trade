import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import assert from "node:assert/strict"
import test from "node:test"

import { evaluateReplayGate, parseCsvCandles, replayStrategy, replayTrendPullback, type ReplayStrategy } from "./strategy-replay"

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
      generateSignal({ candles, index }) {
        if (index !== 1) {
          return null
        }
        return {
          side: "long",
          signal_index: index,
          entry_index: index + 1,
          entry: candles[index + 1].open,
          stop: candles[index + 1].open - 1,
          target: candles[index + 1].open + 2,
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
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
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
    assert.ok(result.trades[0].r < -3)
    assert.ok(Number(result.trades[0].funding_r) > 0.5)
    assert.equal(result.assumptions.funding_model, "historical_events_entry_notional")
    assert.ok(result.gate.blocked_by.some((item) => item.check_id === "R-FUNDING-COVERAGE"))
    assert.equal(result.assumptions.stop_gap_policy, "next_open_if_worse")
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
      generateSignal({ candles, index }) {
        if (index !== 1 && index !== 3) {
          return null
        }
        return {
          side: "long",
          signal_index: index,
          entry_index: index + 1,
          entry: candles[index + 1].open,
          stop: candles[index + 1].open - 1,
          target: candles[index + 1].open + 2,
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
      generateSignal({ candles, index }) {
        if (index !== 1 && index !== 3) return null
        return {
          side: "long",
          signal_index: index,
          entry_index: index + 1,
          entry: candles[index + 1].open,
          stop: candles[index + 1].open - 1,
          target: candles[index + 1].open + 2,
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
      generateSignal({ candles, index }) {
        if (index !== 1 && index !== 3) return null
        return { side: "long", signal_index: index, entry_index: index + 1, entry: candles[index + 1].open, stop: candles[index + 1].open - 1, target: candles[index + 1].open + 2, reason: "external" }
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
