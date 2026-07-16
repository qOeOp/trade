import { expect, test } from "bun:test"
import {
  REPLAY_PENDING_ORDER_RESOLUTION_SCHEMA_VERSION,
  assertReplayPendingOrderResolution,
  canonicalHash,
  type ReplayBoundaryPhase,
  type ReplayEventKey,
  type ReplayMarketBar,
  type ReplayPendingOrderObservation,
  type ReplayPendingOrderSpec,
} from "../../../contracts/src/lib/replay-contracts"
import { createReplayEventKey } from "./replay-event-key"
import { resolveReplayPendingOrder } from "./replay-pending-order-resolution"

const BAR: ReplayMarketBar = {
  open_time: "2026-07-14T04:00:00Z",
  close_time: "2026-07-14T08:00:00Z",
  open: 100,
  high: 106,
  low: 94,
  close: 101,
  volume: 100,
  closed: true,
}

test("golden: GTC limit uses observed-open improvement but remains queue-limited", () => {
  const buy = resolveReplayPendingOrder({
    order: limitOrder("buy", 101),
    observation: observation("bar_open"),
    cancel_effective_key: null,
  })
  expect(buy).toMatchObject({
    schema_version: REPLAY_PENDING_ORDER_RESOLUTION_SCHEMA_VERSION,
    outcome: { status: "filled", reason: "limit_open_marketable", fill_reference_price: 100, fill_quantity: 1, remaining_quantity: 0 },
    resolution_status: "resolution_limited",
    limitations: ["ohlcv-limit-queue-unobserved"],
  })
  const sell = resolveReplayPendingOrder({
    order: limitOrder("sell", 99),
    observation: observation("bar_open"),
    cancel_effective_key: null,
  })
  expect(sell.outcome.fill_reference_price).toBe(100)
  expect(buy.resolution_hash).toBe("d6108a5cbf983efd967b9655d3ab65495004c114d6442204b3b64f23b0c8d8e1")
  expect(sell.resolution_hash).toHaveLength(64)
})

test("strict range cross fills at the limit while an exact touch stays resolution-limited", () => {
  const crossed = resolveReplayPendingOrder({
    order: limitOrder("buy", 95),
    observation: observation("bar_range"),
    cancel_effective_key: null,
  })
  expect(crossed).toMatchObject({
    outcome: { status: "filled", reason: "limit_strict_cross", fill_reference_price: 95 },
    resolution_status: "resolution_limited",
  })
  const touched = resolveReplayPendingOrder({
    order: limitOrder("buy", 94),
    observation: observation("bar_range"),
    cancel_effective_key: null,
  })
  expect(touched).toMatchObject({
    outcome: { status: "resting", reason: "limit_touch_queue_unproven", fill_reference_price: null },
    limitations: ["ohlcv-limit-queue-unobserved"],
  })
  const untouched = resolveReplayPendingOrder({
    order: limitOrder("buy", 93),
    observation: observation("bar_range"),
    cancel_effective_key: null,
  })
  expect(untouched).toMatchObject({
    outcome: { status: "resting", reason: "limit_not_reached" },
    resolution_status: "exact_under_ohlc",
    limitations: [],
  })
})

test("IOC limit resolves only at the first eligible open", () => {
  const cancelled = resolveReplayPendingOrder({
    order: limitOrder("buy", 99, "ioc"),
    observation: observation("bar_open"),
    cancel_effective_key: null,
  })
  expect(cancelled).toMatchObject({
    outcome: { status: "cancelled", reason: "ioc_not_marketable", decisive_event_key: observation("bar_open").source_event_key },
    resolution_status: "exact_under_ohlc",
  })
  expect(() => resolveReplayPendingOrder({
    order: limitOrder("buy", 99, "ioc"),
    observation: observation("bar_range"),
    cancel_effective_key: null,
  })).toThrow("IOC limit order requires a bar_open observation")
})

test("stop-market gap and range triggers are side-symmetric and GTC-only", () => {
  const sellGap = resolveReplayPendingOrder({
    order: stopOrder("sell", 101),
    observation: observation("bar_open"),
    cancel_effective_key: null,
  })
  expect(sellGap).toMatchObject({
    outcome: { status: "triggered_and_filled", reason: "stop_open_gap", fill_reference_price: 100 },
    resolution_status: "exact_under_ohlc",
  })
  const buyRange = resolveReplayPendingOrder({
    order: stopOrder("buy", 105),
    observation: observation("bar_range"),
    cancel_effective_key: null,
  })
  expect(buyRange.outcome).toMatchObject({ status: "triggered_and_filled", reason: "stop_range_trigger", fill_reference_price: 105 })
  const notTriggered = resolveReplayPendingOrder({
    order: stopOrder("buy", 107),
    observation: observation("bar_range"),
    cancel_effective_key: null,
  })
  expect(notTriggered.outcome).toMatchObject({ status: "resting", reason: "stop_not_triggered" })
  expect(() => resolveReplayPendingOrder({
    order: { ...stopOrder("buy", 105), time_in_force: "ioc" },
    observation: observation("bar_open"),
    cancel_effective_key: null,
  })).toThrow("supports gtc only")
})

test("Cancel EventKey wins before observation, loses after fill, and closes a later non-fill", () => {
  const before = resolveReplayPendingOrder({
    order: limitOrder("buy", 95),
    observation: observation("bar_range"),
    cancel_effective_key: eventKey("2026-07-14T07:59:59Z", 90, 0, 0, "cancel-before"),
  })
  expect(before.outcome).toMatchObject({ status: "cancelled", reason: "cancel_precedes_observation" })
  const afterFill = resolveReplayPendingOrder({
    order: limitOrder("buy", 95),
    observation: observation("bar_range"),
    cancel_effective_key: eventKey("2026-07-14T08:00:01Z", 90, 1, 0, "cancel-after-fill"),
  })
  expect(afterFill.outcome).toMatchObject({ status: "filled", reason: "limit_strict_cross" })
  const afterNonFill = resolveReplayPendingOrder({
    order: limitOrder("buy", 93),
    observation: observation("bar_range"),
    cancel_effective_key: eventKey("2026-07-14T08:00:01Z", 90, 1, 0, "cancel-after-non-fill"),
  })
  expect(afterNonFill.outcome).toMatchObject({ status: "cancelled", reason: "cancel_after_non_fill" })
})

test("unsequenced same-ordinal cancel races and touch-before-cancel remain unresolved", () => {
  const sourceKey = observation("bar_range").source_event_key
  const sameOrdinal = resolveReplayPendingOrder({
    order: stopOrder("buy", 105),
    observation: observation("bar_range"),
    cancel_effective_key: { ...sourceKey, stable_event_id: "cancel-same-ordinal" },
  })
  expect(sameOrdinal).toMatchObject({
    outcome: { status: "unresolved", reason: "same_ordinal_cancel_race", decisive_event_key: null },
    limitations: ["same-event-order-unproven"],
  })
  const touchBeforeCancel = resolveReplayPendingOrder({
    order: limitOrder("buy", 94),
    observation: observation("bar_range"),
    cancel_effective_key: eventKey("2026-07-14T08:00:01Z", 90, 1, 0, "cancel-after-touch"),
  })
  expect(touchBeforeCancel).toMatchObject({
    outcome: { status: "unresolved", reason: "limit_touch_before_cancel_unresolved", decisive_event_key: null },
    limitations: ["ohlcv-limit-queue-unobserved"],
  })
})

test("metamorphic: mirrored strict-cross limits preserve status, quantity, and centered price", () => {
  const buy = resolveReplayPendingOrder({ order: limitOrder("buy", 95), observation: observation("bar_range"), cancel_effective_key: null })
  const sell = resolveReplayPendingOrder({ order: limitOrder("sell", 105), observation: observation("bar_range"), cancel_effective_key: null })
  expect([buy.outcome.status, buy.outcome.fill_quantity, buy.resolution_status]).toEqual([
    sell.outcome.status, sell.outcome.fill_quantity, sell.resolution_status,
  ])
  expect(buy.outcome.fill_reference_price! + sell.outcome.fill_reference_price!).toBe(200)
})

test("property: resolution is deterministic and conserves quantity across limit price grids", () => {
  for (const side of ["buy", "sell"] as const) {
    for (const kind of ["bar_open", "bar_range"] as const) {
      for (let price = 90; price <= 110; price += 1) {
        const input = { order: limitOrder(side, price), observation: observation(kind), cancel_effective_key: null }
        const first = resolveReplayPendingOrder(input)
        const second = resolveReplayPendingOrder(structuredClone(input))
        expect(second).toEqual(first)
        expect(first.outcome.fill_quantity + first.outcome.remaining_quantity).toBe(first.order.quantity)
        if (first.outcome.fill_reference_price !== null) {
          expect(side === "buy"
            ? first.outcome.fill_reference_price <= price
            : first.outcome.fill_reference_price >= price).toBe(true)
        }
      }
    }
  }
})

test("resolution contract rejects capacity, activation, price-bound, and hash tamper", () => {
  expect(() => resolveReplayPendingOrder({
    order: { ...limitOrder("buy", 95), full_fill_capacity: 0.5 },
    observation: observation("bar_range"),
    cancel_effective_key: null,
  })).toThrow("exceeds full-fill capacity")
  expect(() => resolveReplayPendingOrder({
    order: { ...limitOrder("buy", 95), activation_event_key: observation("bar_range").source_event_key },
    observation: observation("bar_range"),
    cancel_effective_key: null,
  })).toThrow("must follow activation")
  const result = resolveReplayPendingOrder({ order: limitOrder("buy", 95), observation: observation("bar_range"), cancel_effective_key: null })
  const priceTamper = structuredClone(result)
  priceTamper.outcome.fill_reference_price = 96
  const { resolution_hash: _priceHash, ...priceBody } = priceTamper
  priceTamper.resolution_hash = canonicalHash(priceBody)
  expect(() => assertReplayPendingOrderResolution(priceTamper)).toThrow("price bound")
  const hashTamper = structuredClone(result)
  hashTamper.order.order_id = "changed-order-id"
  expect(() => assertReplayPendingOrderResolution(hashTamper)).toThrow("hash mismatch")
  const semanticTamper = structuredClone(result)
  semanticTamper.outcome.reason = "limit_open_marketable"
  const { resolution_hash: _semanticHash, ...semanticBody } = semanticTamper
  semanticTamper.resolution_hash = canonicalHash(semanticBody)
  expect(() => assertReplayPendingOrderResolution(semanticTamper)).toThrow("price/time/cancel semantics")
})

function limitOrder(side: "buy" | "sell", limitPrice: number, tif: "gtc" | "ioc" = "gtc"): ReplayPendingOrderSpec {
  return {
    order_id: `limit-${side}-${limitPrice}-${tif}`,
    order_type: "limit",
    side,
    quantity: 1,
    time_in_force: tif,
    activation_event_key: eventKey("2026-07-14T00:00:00Z", 90, 0, 0, `activate-limit-${side}`),
    limit_price: limitPrice,
    trigger_price: null,
    trigger_source: null,
    liquidity_model: "ohlcv-cross-through-full-fill-bounded-v1",
    full_fill_capacity: 1,
  }
}

function stopOrder(side: "buy" | "sell", triggerPrice: number): ReplayPendingOrderSpec {
  return {
    order_id: `stop-${side}-${triggerPrice}`,
    order_type: "stop_market",
    side,
    quantity: 1,
    time_in_force: "gtc",
    activation_event_key: eventKey("2026-07-14T00:00:00Z", 90, 0, 0, `activate-stop-${side}`),
    limit_price: null,
    trigger_price: triggerPrice,
    trigger_source: "last_trade_ohlcv",
    liquidity_model: "ohlcv-cross-through-full-fill-bounded-v1",
    full_fill_capacity: 1,
  }
}

function observation(kind: "bar_open" | "bar_range"): ReplayPendingOrderObservation {
  return {
    observation_kind: kind,
    source_event_key: eventKey(
      kind === "bar_open" ? BAR.open_time : BAR.close_time,
      20,
      1,
      kind === "bar_open" ? 0 : 1,
      `source-${kind}`,
    ),
    bar: structuredClone(BAR),
  }
}

function eventKey(
  eventTime: string,
  phase: ReplayBoundaryPhase,
  sourceSequence: number,
  subphase: number,
  id: string,
): ReplayEventKey {
  return createReplayEventKey({
    event_time: eventTime,
    boundary_phase: phase,
    source_sequence: sourceSequence,
    event_subphase: subphase,
    stable_event_id: id,
  })
}
