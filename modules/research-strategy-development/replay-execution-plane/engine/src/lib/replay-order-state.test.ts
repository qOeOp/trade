import { expect, test } from "bun:test"
import type { ReplayBoundaryPhase } from "../../../contracts/src/lib/replay-contracts"
import { compareReplayEventKeys, createReplayEventKey } from "./replay-event-key"
import {
  activateReplayOrder,
  cancelReplayOrder,
  expireReplayOrder,
  fillReplayOrder,
  submitReplayOrder,
  triggerReplayOrder,
  type ReplayTransitionStamp,
} from "./replay-order-state"

function stamp(
  sequence: number,
  eventTime: string,
  boundaryPhase: ReplayBoundaryPhase = 90,
  sourceSequence = 0,
  eventSubphase = sequence,
): ReplayTransitionStamp {
  return {
    sequence,
    event_key: createReplayEventKey({
      event_time: eventTime,
      boundary_phase: boundaryPhase,
      source_sequence: sourceSequence,
      event_subphase: eventSubphase,
      stable_event_id: `test-event-${sequence}`,
    }),
  }
}

test("order lifecycle supports deterministic partial fill then terminal fill", () => {
  const submitted = submitReplayOrder({
    order_id: "entry-1", order_role: "entry", order_type: "market", side: "buy",
    quantity: 2, reduce_only: false, submitted_at: "2026-07-14T00:00:00Z",
  }, stamp(1, "2026-07-14T00:00:00Z"), 0)
  const active = activateReplayOrder(submitted.order, stamp(2, "2026-07-14T04:00:00Z"), 0)
  const partial = fillReplayOrder({ order: active.order, requested_quantity: 0.75, stamp: stamp(3, "2026-07-14T04:00:00Z"), signed_position_before: 0 })
  const filled = fillReplayOrder({ order: partial.order, requested_quantity: 1.25, stamp: stamp(4, "2026-07-14T04:00:01Z"), signed_position_before: partial.signed_position_after })
  expect([submitted.event.kind, active.event.kind, partial.event.kind, filled.event.kind]).toEqual(["submitted", "activated", "partially_filled", "filled"])
  expect(filled.order.remaining_quantity).toBe(0)
  expect(filled.signed_position_after).toBe(2)
})

test("oversized reduce-only fill caps at position and residual is cancellable", () => {
  const submitted = submitReplayOrder({
    order_id: "stop-1", order_role: "stop", order_type: "stop_market", side: "sell",
    quantity: 3, reduce_only: true, submitted_at: "2026-07-14T04:00:00Z", trigger_price: 95,
  }, stamp(1, "2026-07-14T04:00:00Z"), 1.25)
  const active = activateReplayOrder(submitted.order, stamp(2, "2026-07-14T04:00:00Z"), 1.25)
  const triggered = triggerReplayOrder(active.order, stamp(3, "2026-07-14T08:00:00Z"), 1.25, "bar_range", 95)
  const partial = fillReplayOrder({ order: triggered.order, requested_quantity: 3, stamp: stamp(4, "2026-07-14T08:00:00Z"), signed_position_before: 1.25 })
  expect(partial.executed_quantity).toBe(1.25)
  expect(partial.signed_position_after).toBe(0)
  expect(partial.order.status).toBe("partially_filled")
  const cancelled = cancelReplayOrder(partial.order, stamp(5, "2026-07-14T08:00:00Z"), 0, "reduce-only-position-exhausted")
  expect(cancelled.order.status).toBe("cancelled")
  expect(cancelled.order.remaining_quantity).toBe(1.75)
})

test("wrong-side reduce-only is rejected and cancelled orders cannot fill", () => {
  const submitted = submitReplayOrder({
    order_id: "target-1", order_role: "target", order_type: "take_profit_market", side: "sell",
    quantity: 1, reduce_only: true, submitted_at: "2026-07-14T04:00:00Z", trigger_price: 110,
  }, stamp(1, "2026-07-14T04:00:00Z"), -1)
  const active = activateReplayOrder(submitted.order, stamp(2, "2026-07-14T04:00:00Z"), -1)
  const triggered = triggerReplayOrder(active.order, stamp(3, "2026-07-14T08:00:00Z"), -1, "bar_range", 110)
  const rejected = fillReplayOrder({ order: triggered.order, requested_quantity: 1, stamp: stamp(4, "2026-07-14T08:00:00Z"), signed_position_before: -1 })
  expect(rejected.order.status).toBe("rejected")
  expect(rejected.executed_quantity).toBe(0)

  const fresh = activateReplayOrder(submitReplayOrder({
    order_id: "stop-2", order_role: "stop", order_type: "stop_market", side: "sell",
    quantity: 1, reduce_only: true, submitted_at: "2026-07-14T04:00:00Z", trigger_price: 95,
  }, stamp(5, "2026-07-14T04:00:00Z"), 1).order, stamp(6, "2026-07-14T04:00:00Z"), 1)
  const cancelled = cancelReplayOrder(fresh.order, stamp(7, "2026-07-14T06:00:00Z"), 1, "oco-sibling-filled")
  expect(() => fillReplayOrder({ order: cancelled.order, requested_quantity: 1, stamp: stamp(8, "2026-07-14T08:00:00Z"), signed_position_before: 1 })).toThrow("cancelled")
})

test("IOC limit expires distinctly from an explicit cancellation", () => {
  const submitted = submitReplayOrder({
    order_id: "ioc-entry", order_role: "entry", order_type: "limit", side: "buy",
    quantity: 1, reduce_only: false, submitted_at: "2026-07-14T00:00:00Z",
    limit_price: 99, time_in_force: "ioc",
  }, stamp(1, "2026-07-14T00:00:00Z"), 0)
  const active = activateReplayOrder(submitted.order, stamp(2, "2026-07-14T00:00:00Z"), 0)
  const expired = expireReplayOrder(
    active.order, stamp(3, "2026-07-14T04:00:00Z"), 0, "ioc_unfilled_at_first_open",
  )
  expect(expired).toMatchObject({
    order: { status: "expired", filled_quantity: 0, remaining_quantity: 1 },
    event: { kind: "expired", status: "expired", reason: "ioc_unfilled_at_first_open" },
  })
  expect(() => cancelReplayOrder(expired.order, stamp(4, "2026-07-14T04:00:00Z"), 0, "late-cancel"))
    .toThrow("expired")
  expect(() => expireReplayOrder(expired.order, stamp(4, "2026-07-14T04:00:00Z"), 0, "again"))
    .toThrow("expired")

  const gtc = activateReplayOrder(submitReplayOrder({
    order_id: "gtc-entry", order_role: "entry", order_type: "limit", side: "buy",
    quantity: 1, reduce_only: false, submitted_at: "2026-07-14T00:00:00Z",
    limit_price: 99, time_in_force: "gtc",
  }, stamp(5, "2026-07-14T00:00:00Z"), 0).order, stamp(6, "2026-07-14T00:00:00Z"), 0)
  expect(() => expireReplayOrder(gtc.order, stamp(7, "2026-07-14T04:00:00Z"), 0, "wrong-tif"))
    .toThrow("non-active IOC")
})

test("conditional orders require trigger and every transition advances EventKey", () => {
  const submitted = submitReplayOrder({
    order_id: "stop-3", order_role: "stop", order_type: "stop_market", side: "sell",
    quantity: 1, reduce_only: true, submitted_at: "2026-07-14T04:00:00Z", trigger_price: 95,
  }, stamp(10, "2026-07-14T04:00:00Z"), 1)
  const active = activateReplayOrder(submitted.order, stamp(11, "2026-07-14T04:00:00Z"), 1)
  expect(() => fillReplayOrder({ order: active.order, requested_quantity: 1, stamp: stamp(12, "2026-07-14T08:00:00Z"), signed_position_before: 1 })).toThrow("active")
  expect(() => triggerReplayOrder(active.order, stamp(11, "2026-07-14T08:00:00Z"), 1, "bar_range", 95)).toThrow("sequence")
  const triggered = triggerReplayOrder(active.order, stamp(12, "2026-07-14T08:00:00Z"), 1, "bar_range", 95)
  expect(() => fillReplayOrder({ order: triggered.order, requested_quantity: 1, stamp: stamp(13, "2026-07-14T07:59:59Z"), signed_position_before: 1 })).toThrow("event key")
  const filled = fillReplayOrder({ order: triggered.order, requested_quantity: 1, stamp: stamp(13, "2026-07-14T08:00:00Z"), signed_position_before: 1 })
  expect([triggered.event.kind, filled.event.kind]).toEqual(["triggered", "filled"])
  expect([triggered.event.trigger_source, triggered.event.trigger_observed_price]).toEqual(["bar_range", 95])
  expect(() => cancelReplayOrder(filled.order, stamp(14, "2026-07-14T08:00:00Z"), 0, "late-cancel")).toThrow("filled")
})

test("same-timestamp trigger fill and cancel race has one EventKey order", () => {
  const submitted = submitReplayOrder({
    order_id: "stop-race", order_role: "stop", order_type: "stop_market", side: "sell",
    quantity: 1, reduce_only: true, submitted_at: "2026-07-14T04:00:00Z", trigger_price: 95,
  }, stamp(1, "2026-07-14T04:00:00Z"), 1)
  const active = activateReplayOrder(submitted.order, stamp(2, "2026-07-14T04:00:00Z"), 1)
  const triggerStamp = stamp(3, "2026-07-14T08:00:00Z", 20, 7, 2)
  const fillStamp = stamp(4, "2026-07-14T08:00:00Z", 20, 7, 3)
  const cancelStamp = stamp(5, "2026-07-14T08:00:00Z", 90, 7, 0)
  expect(compareReplayEventKeys(triggerStamp.event_key, fillStamp.event_key)).toBeLessThan(0)
  expect(compareReplayEventKeys(fillStamp.event_key, cancelStamp.event_key)).toBeLessThan(0)
  const triggered = triggerReplayOrder(active.order, triggerStamp, 1, "bar_range", 95)
  const filled = fillReplayOrder({ order: triggered.order, requested_quantity: 1, stamp: fillStamp, signed_position_before: 1 })
  expect(() => cancelReplayOrder(filled.order, cancelStamp, 0, "late-command")).toThrow("filled")

  const cancelled = cancelReplayOrder(active.order, stamp(6, "2026-07-14T07:59:59Z", 90, 6, 0), 1, "earlier-command")
  expect(() => triggerReplayOrder(cancelled.order, stamp(7, "2026-07-14T08:00:00Z", 20, 7, 2), 1, "bar_range", 95)).toThrow("cancelled")
})
