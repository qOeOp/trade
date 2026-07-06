import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import assert from "node:assert/strict"
import test from "node:test"

import { runStrategyRndBatch } from "./strategy-rnd"

test("strategy R&D batch runs bounded predeclared candidates", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-rnd-"))
  try {
    const manifestPath = writeManifest(dir)
    const indicatorReportPath = join(dir, "indicator-report.json")
    writeFileSync(indicatorReportPath, JSON.stringify({
      ok: true,
      data: {
        selected_indicators: {
          vpci: {
            category: "volume",
            defaults: { period_short: 5, period_long: 20 },
            observe: "看量价方向一致还是背离。",
          },
          stc: {
            category: "momentum",
            defaults: { fast: 23, slow: 50, length: 10 },
            observe: "看 25/75 区域穿越和方向切换。",
          },
        },
        timeframes: {
          "4h": {
            structure_validation: {
              support: {
                sample_count: 88,
                respect_rate: 0.93,
                break_rate: 0.07,
              },
            },
          },
        },
      },
    }))
    const report = runStrategyRndBatch({
      batchId: "rnd-test",
      hypothesis: "trend pullback variants",
      manifestPath,
      indicatorReportPath,
      oosSplitRatio: 0.3,
      maxHoldBars: 8,
      feeBps: 2,
      slippageBps: 1,
      candidates: [{
        candidateId: "C-LONG-EMA50",
        description: "long-only EMA50 pullback",
        parameterCount: 6,
        params: {
          side: "long",
          fast_ema: 50,
          slow_ema: 200,
          pullback_atr: 0.25,
          stop_atr: 0.5,
          max_risk_atr: 1.25,
          reward_risk: 1.5,
        },
      }],
    })

    assert.equal(report.batch_id, "rnd-test")
    assert.equal(report.trial_count, 1)
    assert.equal(report.guardrails.no_auto_promote, true)
    assert.equal(report.indicator_research?.selected_indicators.length, 2)
    assert.equal(report.indicator_research?.structure_edges[0].feature_id, "support")
    assert.equal(report.candidates.length, 1)
    assert.equal(report.candidates[0].replay.strategy_id, "C-LONG-EMA50")
    assert.ok(["candidate_found", "no_promote"].includes(report.outcome))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("strategy R&D batch refuses excessive trial budget", () => {
  const candidates = Array.from({ length: 11 }, (_, index) => ({
    candidateId: `C-${index}`,
    params: { side: "long" },
  }))

  assert.throws(
    () => runStrategyRndBatch({
      manifestPath: "/tmp/manifest.json",
      candidates,
    }),
    /trial_count 11 exceeds 10/,
  )
})

function writeManifest(dir: string): string {
  writeFileSync(join(dir, "4h.csv"), [
    "date,timestamp,open,high,low,close,volume",
    ...buildReplayCandles().map((item, index) => [
      new Date(1_700_000_000_000 + index * 4 * 60 * 60 * 1000).toISOString(),
      1_700_000_000_000 + index * 4 * 60 * 60 * 1000,
      item.open,
      item.high,
      item.low,
      item.close,
      item.volume,
    ].join(",")),
  ].join("\n"))
  const manifestPath = join(dir, "manifest.json")
  writeFileSync(manifestPath, JSON.stringify({
    symbol: "BTCUSDT",
    timeframes: {
      "4h": {
        file: "4h.csv",
      },
    },
  }))
  return manifestPath
}

function buildReplayCandles(): Array<{ open: number; high: number; low: number; close: number; volume: number }> {
  const candles: Array<{ open: number; high: number; low: number; close: number; volume: number }> = []
  let close = 100
  for (let index = 0; index < 280; index += 1) {
    const trend = index < 240 ? 0.25 : 0.35
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
