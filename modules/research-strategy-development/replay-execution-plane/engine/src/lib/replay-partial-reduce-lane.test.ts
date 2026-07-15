import { expect, test } from "bun:test"
import type { ReplayBoundaryPhase, ReplayOrderEvent } from "../../../contracts/src/lib/replay-contracts"
import { activateReplayOrder, submitReplayOrder, type ReplayTransitionStamp } from "./replay-order-state"
import { completeReplayPartialReduceLane } from "./replay-partial-reduce-lane"

function stamp(sequence: number, eventTime: string, phase: ReplayBoundaryPhase, subphase: number): ReplayTransitionStamp {
  return {
    sequence,
    event_key: {
      event_time: eventTime,
      boundary_phase: phase,
      source_sequence: 6,
      event_subphase: subphase,
      stable_event_id: `event:${sequence}`,
    },
  }
}

test("partial-reduce lane is direction-symmetric and atomically rebuilds remaining protection", () => {
  for (const side of ["long", "short"] as const) {
    const events: ReplayOrderEvent[] = []
    let sequence = 0
    const nextStamp = (time: string, phase: ReplayBoundaryPhase, _source: number, subphase: number) => (
      stamp(++sequence, time, phase, subphase)
    )
    const capture = <T extends { event: ReplayOrderEvent }>(transition: T): T => {
      events.push(transition.event)
      return transition
    }
    const signedPosition = side === "long" ? 1 : -1
    const exitSide = side === "long" ? "sell" as const : "buy" as const
    const active = (role: "stop" | "target", triggerPrice: number, subphase: number) => {
      const submitted = capture(submitReplayOrder({
        order_id: `${side}:${role}`, order_role: role,
        order_type: role === "stop" ? "stop_market" : "take_profit_market",
        side: exitSide, quantity: 1, reduce_only: true,
        submitted_at: "2026-07-14T12:00:00Z", trigger_price: triggerPrice,
      }, nextStamp("2026-07-14T12:00:00Z", 90, 1, subphase), signedPosition)).order
      return capture(activateReplayOrder(
        submitted, nextStamp("2026-07-14T12:00:00Z", 90, 1, subphase + 1), signedPosition,
      )).order
    }
    const stop = active("stop", side === "long" ? 95 : 105, 0)
    const target = active("target", side === "long" ? 120 : 80, 2)
    const partial = capture(submitReplayOrder({
      order_id: `${side}:partial`, order_role: "strategy_partial_reduce", order_type: "market",
      side: exitSide, quantity: 0.4, reduce_only: true, submitted_at: "2026-07-14T16:00:00Z",
    }, nextStamp("2026-07-14T16:00:00Z", 90, 5, 4), signedPosition)).order
    events.length = 0

    const execution = completeReplayPartialReduceLane({
      run_id: side, decision_sequence: 2, event_time: "2026-07-14T20:00:00Z",
      source_sequence: 6, signed_position: signedPosition, partial_order: partial,
      stop_order: stop, target_order: target, exit_side: exitSide, next_stamp: nextStamp, capture,
    })
    expect(execution.signed_position_after).toBe(side === "long" ? 0.6 : -0.6)
    expect(execution.stop_order).toMatchObject({ status: "active", remaining_quantity: 0.6, trigger_price: stop.trigger_price })
    expect(execution.target_order).toMatchObject({ status: "active", remaining_quantity: 0.6, trigger_price: target.trigger_price })
    expect(events.map((event) => [event.kind, event.event_key.boundary_phase, event.event_key.event_subphase]))
      .toEqual([
        ["activated", 20, 2], ["filled", 20, 3],
        ["cancelled", 90, 0], ["cancelled", 90, 1],
        ["submitted", 90, 2], ["activated", 90, 3],
        ["submitted", 90, 4], ["activated", 90, 5],
      ])
  }
})
