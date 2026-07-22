import assert from "node:assert/strict"
import test from "node:test"
import type { Candle } from "../../../legacy-research-data/src/lib/legacy-research-data"
import { buildTrendPullbackSignal, listReplayStrategyFixtures } from "./legacy-research-strategy-fixture"

const signalCandle: Candle = {
  date: "2026-01-01T00:00:00Z",
  timestamp: Date.parse("2026-01-01T00:00:00Z"),
  open: 101,
  high: 102,
  low: 99.5,
  close: 101,
  volume: 10,
}

test("exposes only the frozen trend-pullback fixture", () => {
  assert.deepEqual(listReplayStrategyFixtures(), ["S-BTC-4H-TREND-PULLBACK"])
})

test("preserves the frozen long pullback signal geometry", () => {
  const signal = buildTrendPullbackSignal({
    side: "long",
    signal: signalCandle,
    signalIndex: 200,
    entryIndex: 201,
    entry: 101,
    emaFast: 100,
    currentAtr: 2,
    entryRiskLimit: 2.5,
    rewardRisk: 2,
  })
  assert.equal(signal?.stop, 98.5)
  assert.equal(signal?.target, 106)
  assert.equal(signal?.reason, "ema50 trend pullback long")
})
