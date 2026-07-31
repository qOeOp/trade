import { expect, test } from "bun:test"
import { REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION, type ReplayFill, type ReplayInstrumentAccountingSpec } from "../../../contracts/src/lib/replay-contracts"
import { buildAverageCostPositionProjection, buildCertifiedSinglePositionProjection } from "./replay-position-accounting"

const ACCOUNTING_SPEC: ReplayInstrumentAccountingSpec = {
  spec_version: REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION,
  product_type: "linear_derivative",
  base_asset: "BTC",
  quote_asset: "USDT",
  settlement_asset: "USDT",
  contract_multiplier: "1",
  price_increment: "0.000000000001",
  quantity_increment: "0.001",
  settlement_increment: "0.000000000001",
}

function fills(side: "long" | "short", exitQuantity = 1): [ReplayFill, ReplayFill] {
  const entrySide = side === "long" ? "buy" : "sell"
  const exitSide = side === "long" ? "sell" : "buy"
  return [
    {
      fill_id: "fill-entry", order_id: "order-entry", order_role: "entry",
      event_key: { event_time: "2026-07-14T04:00:00Z", boundary_phase: 20, source_sequence: 1, event_subphase: 3, stable_event_id: "entry-fill" },
      timestamp: "2026-07-14T04:00:00Z", side: entrySide, quantity: 1, price: 100.123456789012, fee: 0, reduce_only: false,
    },
    {
      fill_id: "fill-exit", order_id: "order-exit", order_role: "target",
      event_key: { event_time: "2026-07-14T08:00:00Z", boundary_phase: 20, source_sequence: 1, event_subphase: 3, stable_event_id: "exit-fill" },
      timestamp: "2026-07-14T08:00:00Z", side: exitSide, quantity: exitQuantity, price: 110.987654321099, fee: 0, reduce_only: true,
    },
  ]
}

function positionFill(input: {
  id: string
  timestamp: string
  side: "buy" | "sell"
  quantity: number
  price: number
  reduce_only?: boolean
}): ReplayFill {
  return {
    fill_id: input.id,
    order_id: `order-${input.id}`,
    order_role: input.reduce_only ? "target" : "entry",
    event_key: {
      event_time: input.timestamp,
      boundary_phase: 20,
      source_sequence: 1,
      event_subphase: 3,
      stable_event_id: input.id,
    },
    timestamp: input.timestamp,
    side: input.side,
    quantity: input.quantity,
    price: input.price,
    fee: 0,
    reduce_only: input.reduce_only ?? false,
  }
}

test("single-position projection derives long and short post-fill states with canonical rounding", () => {
  const long = buildCertifiedSinglePositionProjection({ run_id: "long-run", symbol: "BTCUSDT", accounting_spec: ACCOUNTING_SPEC, fills: fills("long") })
  const short = buildCertifiedSinglePositionProjection({ run_id: "short-run", symbol: "BTCUSDT", accounting_spec: ACCOUNTING_SPEC, fills: fills("short") })
  expect(long.map((position) => [position.state, position.side, position.signed_quantity])).toEqual([
    ["open", "long", 1], ["flat", null, 0],
  ])
  expect(short[0].signed_quantity).toBe(-1)
  expect(long[0].average_entry_price).toBe(100.123456789012)
  expect(long[1].valuation_price).toBe(110.987654321099)
  expect(long[1].realized_pnl_cumulative).toBe(10.864197532087)
  expect(short[1].realized_pnl_cumulative).toBe(-10.864197532087)
  expect(long.map((position) => position.event_key)).toEqual(fills("long").map((fill) => fill.event_key))
})

test("certified position projection rejects partial close instead of implying generic lot support", () => {
  expect(() => buildCertifiedSinglePositionProjection({
    run_id: "partial-run", symbol: "BTCUSDT", accounting_spec: ACCOUNTING_SPEC, fills: fills("long", 0.5),
  })).toThrow("requires a full close")
})

test("average-cost reducer handles same-side add then partial reduce", () => {
  const projections = buildAverageCostPositionProjection({
    run_id: "multi-fill-run",
    symbol: "BTCUSDT",
    accounting_spec: ACCOUNTING_SPEC,
    fills: [
      positionFill({ id: "fill-1", timestamp: "2026-07-14T04:00:00Z", side: "buy", quantity: 1, price: 100 }),
      positionFill({ id: "fill-2", timestamp: "2026-07-14T05:00:00Z", side: "buy", quantity: 1, price: 110 }),
      positionFill({ id: "fill-3", timestamp: "2026-07-14T06:00:00Z", side: "sell", quantity: 0.5, price: 120, reduce_only: true }),
    ],
  })
  expect(projections.map((position) => ({
    quantity: position.signed_quantity,
    average: position.average_entry_price,
    realized: position.realized_pnl_delta,
    unrealized: position.unrealized_pnl,
  }))).toEqual([
    { quantity: 1, average: 100, realized: 0, unrealized: 0 },
    { quantity: 2, average: 105, realized: 0, unrealized: 10 },
    { quantity: 1.5, average: 105, realized: 7.5, unrealized: 22.5 },
  ])
})

test("average-cost reducer closes the old side before opening reversal residual", () => {
  const projections = buildAverageCostPositionProjection({
    run_id: "reversal-run",
    symbol: "BTCUSDT",
    accounting_spec: ACCOUNTING_SPEC,
    fills: [
      positionFill({ id: "fill-1", timestamp: "2026-07-14T04:00:00Z", side: "buy", quantity: 1, price: 100 }),
      positionFill({ id: "fill-2", timestamp: "2026-07-14T05:00:00Z", side: "sell", quantity: 1.5, price: 120 }),
    ],
  })
  expect(projections[1]).toMatchObject({
    state: "open",
    side: "short",
    signed_quantity: -0.5,
    average_entry_price: 120,
    realized_pnl_delta: 20,
    realized_pnl_cumulative: 20,
    unrealized_pnl: 0,
  })
})

test("average-cost reducer rejects impossible reduce-only and out-of-order Fill evidence", () => {
  const entry = positionFill({ id: "fill-1", timestamp: "2026-07-14T04:00:00Z", side: "buy", quantity: 1, price: 100 })
  const oversized = positionFill({ id: "fill-2", timestamp: "2026-07-14T05:00:00Z", side: "sell", quantity: 1.5, price: 120, reduce_only: true })
  expect(() => buildAverageCostPositionProjection({
    run_id: "oversized-run", symbol: "BTCUSDT", accounting_spec: ACCOUNTING_SPEC, fills: [entry, oversized],
  })).toThrow("exceeds reducible position")
  const laterEntry = positionFill({ id: "fill-late", timestamp: "2026-07-14T05:00:00Z", side: "buy", quantity: 1, price: 110 })
  expect(() => buildAverageCostPositionProjection({
    run_id: "unordered-run", symbol: "BTCUSDT", accounting_spec: ACCOUNTING_SPEC, fills: [laterEntry, entry],
  })).toThrow("strictly increasing")
})
