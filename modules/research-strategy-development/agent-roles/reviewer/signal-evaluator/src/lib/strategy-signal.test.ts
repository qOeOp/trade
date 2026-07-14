import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import assert from "node:assert/strict"
import test from "node:test"

import { evaluateStrategySignal, strategySignalInputFromJson } from "../../../../developer/signal-engine/src/lib/strategy-signal"
import type { JSONRecord } from "../../../../../../contracts/runtime-core/src/json"

test("strategy signal parser normalizes candidate input", () => {
  const input = strategySignalInputFromJson({
    manifest_path: "/tmp/manifest.json",
    entry_price: 65000,
    max_signal_age_bars: 2,
    candidate: {
      candidate_id: "candidate-1",
      family: "trend_pullback_v1",
    },
  })

  assert.equal(input.manifestPath, "/tmp/manifest.json")
  assert.equal(input.entryPrice, 65000)
  assert.equal(input.maxSignalAgeBars, 2)
  assert.equal(input.candidate.candidateId, "candidate-1")
})

test("strategy signal parser ignores camel-case contract fields", () => {
  const signal = strategySignalInputFromJson({
    manifestPath: "/tmp/manifest.json",
    entryPrice: 65000,
    maxSignalAgeBars: 2,
    candidate: { candidateId: "candidate-1" },
  })

  assert.equal(signal.manifestPath, "")
  assert.equal(Number.isNaN(signal.entryPrice), true)
  assert.equal(signal.maxSignalAgeBars, undefined)
  assert.equal(signal.candidate.candidateId, "")
})

test("latest strategy signal injects a live entry reference into the replay family", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-signal-"))
  try {
    const replayCandles = buildReplayCandles()
    const entryPrice = replayCandles[replayCandles.length - 1]!.close
    const result = evaluateStrategySignal({
      manifestPath: writeManifest(dir),
      entryPrice,
      now: new Date(1_700_000_000_000 + 280 * 4 * 60 * 60 * 1000).toISOString(),
      candidate: {
        candidateId: "C-LIVE-SIGNAL",
        family: "trend_pullback_v1",
        params: { side: "both", fast_ema: 50, slow_ema: 200, pullback_atr: 10, stop_atr: 0.5, max_risk_atr: 20, reward_risk: 2 },
      },
    })
    assert.equal(result.entry_reference, entryPrice)
    assert.equal(result.action, "entry")
    assert.equal((result.signal as { entry: number }).entry, entryPrice)
    assert.equal(typeof result.candidate_hash, "string")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("latest strategy signal rejects stale candles", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-stale-signal-"))
  try {
    assert.throws(() => evaluateStrategySignal({
      manifestPath: writeManifest(dir),
      entryPrice: 100,
      now: "2026-01-01T00:00:00.000Z",
      candidate: { candidateId: "C-STALE", params: { side: "both" } },
    }), /latest closed candle is stale/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("strategy signal result schema matches latest signal outer report", () => {
  const schema = JSON.parse(readFileSync(new URL("../schemas/strategy-signal-result.schema.json", import.meta.url), "utf8")) as JSONRecord
  assert.equal(schema.$id, "trade-flow.strategy-signal-result.v1")

  const dir = mkdtempSync(join(tmpdir(), "strategy-signal-schema-"))
  try {
    const signal = evaluateStrategySignal({
      manifestPath: writeManifest(dir),
      entryPrice: 120,
      now: new Date(1_700_000_000_000 + 280 * 4 * 60 * 60 * 1000).toISOString(),
      candidate: {
        candidateId: "C-SCHEMA-LONG",
        params: { side: "long" },
      },
    }) as JSONRecord
    for (const field of asArray(schema.required)) {
      assert.ok(String(field) in signal, `missing required field ${String(field)}`)
    }
    assert.equal(signal.candidate_id, "C-SCHEMA-LONG")
    assert.ok(["entry", "no_action"].includes(String(signal.action)))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

function writeManifest(dir: string, startTimestamp = 1_700_000_000_000): string {
  writeFileSync(join(dir, "4h.csv"), [
    "date,timestamp,open,high,low,close,volume",
    ...buildReplayCandles().map((item, index) => [
      new Date(startTimestamp + index * 4 * 60 * 60 * 1000).toISOString(),
      startTimestamp + index * 4 * 60 * 60 * 1000,
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

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}
