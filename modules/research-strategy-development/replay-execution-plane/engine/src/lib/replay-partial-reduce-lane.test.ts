import { expect, test } from "bun:test"
import type { ReplayBoundaryPhase, ReplayOrderEvent } from "../../../contracts/src/lib/replay-contracts"
import {
  activateReplayOrder,
  cancelReplayOrder,
  submitReplayOrder,
  type ReplayTransitionStamp,
} from "./replay-order-state"
import { completeReplayExitOrderLane } from "./replay-exit-order-lane"
import { completeReplayLiquidationOrderLane } from "./replay-liquidation-order-lane"
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

test("every post-partial terminal owner consumes only the resized position for long and short", () => {
  for (const side of ["long", "short"] as const) {
    for (const owner of ["stop", "target", "liquidation", "end_of_data"] as const) {
      const events: ReplayOrderEvent[] = []
      let sequence = 0
      const nextStamp = (time: string, phase: ReplayBoundaryPhase, source: number, subphase: number): ReplayTransitionStamp => ({
        sequence: ++sequence,
        event_key: {
          event_time: time, boundary_phase: phase, source_sequence: source,
          event_subphase: subphase, stable_event_id: `${side}:${owner}:event:${sequence}`,
        },
      })
      const capture = <T extends { event: ReplayOrderEvent }>(transition: T): T => {
        events.push(transition.event)
        return transition
      }
      const signedPosition = side === "long" ? 1 : -1
      const exitSide = side === "long" ? "sell" as const : "buy" as const
      const active = (role: "stop" | "target", triggerPrice: number, subphase: number) => {
        const submitted = capture(submitReplayOrder({
          order_id: `${side}:${owner}:${role}`, order_role: role,
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
        order_id: `${side}:${owner}:partial`, order_role: "strategy_partial_reduce", order_type: "market",
        side: exitSide, quantity: 0.4, reduce_only: true, submitted_at: "2026-07-14T16:00:00Z",
      }, nextStamp("2026-07-14T16:00:00Z", 90, 5, 4), signedPosition)).order
      const reduced = completeReplayPartialReduceLane({
        run_id: `${side}:${owner}`, decision_sequence: 2, event_time: "2026-07-14T20:00:00Z",
        source_sequence: 6, signed_position: signedPosition, partial_order: partial,
        stop_order: stop, target_order: target, exit_side: exitSide, next_stamp: nextStamp, capture,
      })
      events.length = 0

      if (owner === "liquidation") {
        const terminal = completeReplayLiquidationOrderLane({
          run_id: `${side}:${owner}`, event_time: "2026-07-15T00:00:00Z", source_sequence: 7,
          signed_position: reduced.signed_position_after,
          stop_order: reduced.stop_order, target_order: reduced.target_order,
          partial_reduce_order: reduced.partial_order, next_stamp: nextStamp, capture,
        })
        expect(terminal).toMatchObject({ terminal_state: "flat", exit_quantity: 0.6, signed_position_after: 0 })
        expect(events.map((event) => [event.kind, event.event_key.boundary_phase]))
          .toEqual([["cancelled", 15], ["cancelled", 15], ["submitted", 15], ["activated", 15], ["filled", 15]])
        continue
      }

      const terminal = completeReplayExitOrderLane({
        run_id: `${side}:${owner}`,
        exit: owner === "end_of_data"
          ? { role: owner, timestamp: "2026-07-15T00:00:00Z", rawPrice: 100, triggerSource: null, sourceSequence: 7 }
          : {
            role: owner,
            timestamp: "2026-07-15T00:00:00Z",
            rawPrice: owner === "stop" ? reduced.stop_order.trigger_price! : reduced.target_order.trigger_price!,
            triggerSource: "bar_range" as const,
            sourceSequence: 7,
          },
        entry_time: "2026-07-14T12:00:00Z", entry_source_sequence: 4,
        signed_position: reduced.signed_position_after,
        stop_order: reduced.stop_order, target_order: reduced.target_order,
        partial_reduce_order: reduced.partial_order, next_stamp: nextStamp, capture,
      })
      if (owner === "end_of_data") {
        expect(terminal).toMatchObject({ terminal_state: "open_marked", exit_quantity: 0, signed_position_after: reduced.signed_position_after })
        expect(events.map((event) => event.kind)).toEqual(["cancelled", "cancelled"])
      } else {
        expect(terminal).toMatchObject({ terminal_state: "flat", exit_quantity: 0.6, signed_position_after: 0 })
        expect(events.map((event) => event.kind)).toEqual(["triggered", "filled", "cancelled"])
        expect(events[0]!.order_id).toBe(owner === "stop" ? reduced.stop_order.order_id : reduced.target_order.order_id)
      }
    }
  }
})

test("liquidation preserves a prior target cancellation and closes through one terminal owner", () => {
  const events: ReplayOrderEvent[] = []
  let sequence = 0
  const nextStamp = (time: string, phase: ReplayBoundaryPhase, source: number, subphase: number): ReplayTransitionStamp => ({
    sequence: ++sequence,
    event_key: {
      event_time: time,
      boundary_phase: phase,
      source_sequence: source,
      event_subphase: subphase,
      stable_event_id: `stop-only-liquidation:event:${sequence}`,
    },
  })
  const capture = <T extends { event: ReplayOrderEvent }>(transition: T): T => {
    events.push(transition.event)
    return transition
  }
  const active = (role: "stop" | "target", triggerPrice: number, subphase: number) => {
    const submitted = capture(submitReplayOrder({
      order_id: `stop-only-liquidation:${role}`,
      order_role: role,
      order_type: role === "stop" ? "stop_market" : "take_profit_market",
      side: "sell",
      quantity: 1,
      reduce_only: true,
      submitted_at: "2026-07-14T12:00:00Z",
      trigger_price: triggerPrice,
    }, nextStamp("2026-07-14T12:00:00Z", 90, 1, subphase), 1)).order
    return capture(activateReplayOrder(
      submitted,
      nextStamp("2026-07-14T12:00:00Z", 90, 1, subphase + 1),
      1,
    )).order
  }
  const stop = active("stop", 95, 0)
  const activeTarget = active("target", 120, 2)
  const target = capture(cancelReplayOrder(
    activeTarget,
    nextStamp("2026-07-14T20:00:00Z", 90, 6, 0),
    1,
    "take-profit-condition-revoked",
  )).order
  events.length = 0

  const terminal = completeReplayLiquidationOrderLane({
    run_id: "stop-only-liquidation",
    event_time: "2026-07-15T00:00:00Z",
    source_sequence: 7,
    signed_position: 1,
    stop_order: stop,
    target_order: target,
    next_stamp: nextStamp,
    capture,
  })

  expect(target.status).toBe("cancelled")
  expect(terminal).toMatchObject({ terminal_state: "flat", exit_quantity: 1, signed_position_after: 0 })
  expect(events.map((event) => [event.order_id, event.kind])).toEqual([
    [stop.order_id, "cancelled"],
    ["stop-only-liquidation:order:liquidation", "submitted"],
    ["stop-only-liquidation:order:liquidation", "activated"],
    ["stop-only-liquidation:order:liquidation", "filled"],
  ])
})
