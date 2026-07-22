import assert from "node:assert/strict"
import test from "node:test"
import type { Candle } from "../../../legacy-research-data/src/lib/legacy-research-data"
import type { SimulatedLaneOrder } from "../../../legacy-research-contracts/src/lib/legacy-research-contracts"
import { simulateReplayOrderLane } from "./legacy-research-order-lane"

const candle = (date: string, open: number, high: number, low: number, close = open): Candle => ({
  date,
  timestamp: Date.parse(date),
  open,
  high,
  low,
  close,
  volume: 10,
})

test("preserves stop-first ordering and reduce-only capping", () => {
  const orders: SimulatedLaneOrder[] = [
    { id: "target", role: "take_profit", side: "SELL", kind: "limit", quantity: 0.5, price: 110, reduce_only: true },
    { id: "stop", role: "stop", side: "SELL", kind: "stop_market", quantity: 2, stop_price: 95, reduce_only: true },
  ]
  const result = simulateReplayOrderLane({
    candles: [candle("2026-01-01T00:00:00Z", 100, 110, 90)],
    orders,
    initial_position_qty: 1,
    initial_entry_price: 100,
    initial_risk_per_unit: 10,
  })
  assert.equal(result.fills.length, 1)
  assert.equal(result.fills[0].order_id, "stop")
  assert.equal(result.fills[0].reduced_only_cap_applied, true)
  assert.equal(result.realized_r_multiple_initial, -0.5)
  assert.equal(result.assumptions.same_candle_policy, "stop_first")
})

test("preserves partial target followed by stop-gap accounting", () => {
  const result = simulateReplayOrderLane({
    candles: [
      candle("2026-01-01T00:00:00Z", 100, 110, 99),
      candle("2026-01-02T00:00:00Z", 94, 96, 90),
    ],
    orders: [
      { id: "target", role: "take_profit", side: "SELL", kind: "limit", quantity: 0.5, price: 110, reduce_only: true },
      { id: "stop", role: "stop", side: "SELL", kind: "stop_market", quantity: 2, stop_price: 95, reduce_only: true },
    ],
    initial_position_qty: 1,
    initial_entry_price: 100,
    initial_risk_per_unit: 10,
  })
  assert.deepEqual(result.fills.map((fill) => fill.order_id), ["target", "stop"])
  assert.equal(result.final_position_qty, 0)
  assert.equal(result.realized_r_multiple_initial, 0.2)
})
