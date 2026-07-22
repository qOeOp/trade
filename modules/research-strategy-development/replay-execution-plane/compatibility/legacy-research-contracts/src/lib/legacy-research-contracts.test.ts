import assert from "node:assert/strict"
import test from "node:test"
import type { LatestSignalResult, ReplaySignal, SimulatedLaneOrder } from "./legacy-research-contracts"

test("preserves the legacy signal and latest-signal discriminants", () => {
  const signal: ReplaySignal = {
    side: "long",
    signal_index: 1,
    entry_index: 2,
    entry: 100,
    stop: 99,
    target: 102,
    reason: "contract fixture",
  }
  const result: LatestSignalResult = {
    strategy_id: "fixture",
    symbol: "BTCUSDT",
    timeframe: "4h",
    signal_time: "2026-01-01T00:00:00.000Z",
    entry_reference: 100,
    action: "entry",
    signal,
  }
  assert.equal(result.signal?.side, "long")
})

test("preserves simulated-lane order vocabulary", () => {
  const order: SimulatedLaneOrder = {
    id: "stop",
    role: "stop",
    side: "SELL",
    kind: "stop_market",
    quantity: 1,
    stop_price: 99,
    reduce_only: true,
  }
  assert.deepEqual([order.role, order.kind, order.side], ["stop", "stop_market", "SELL"])
})
