import { expect, test } from "bun:test"
import type {
  ReplayBoundaryPhase,
  ReplayOrder,
  ReplayOrderEvent,
  ReplayOrderRole,
  ReplayOrderType,
} from "../../../contracts/src/lib/replay-contracts"
import { createReplayEventKey } from "./replay-event-key"
import { completeReplayExitOrderLane, completeReplayStrategyExitOrderLane } from "./replay-exit-order-lane"

function activeOrder(role: ReplayOrderRole, type: ReplayOrderType, subphase: number): ReplayOrder {
  const orderId = `run-lane:order:${role}`
  return {
    order_id: orderId,
    order_role: role,
    order_type: type,
    side: "sell",
    quantity: 1,
    filled_quantity: 0,
    remaining_quantity: 1,
    reduce_only: true,
    status: "active",
    submitted_at: "2026-07-14T04:00:00Z",
    active_at: "2026-07-14T04:00:00Z",
    trigger_price: role === "stop" ? 95 : 110,
    last_event_sequence: 2,
    last_event_key: createReplayEventKey({
      event_time: "2026-07-14T04:00:00Z",
      boundary_phase: 90,
      source_sequence: 1,
      event_subphase: subphase,
      stable_event_id: `${orderId}:active`,
    }),
  }
}

test("terminal target event drives trigger fill and sibling cancel in EventKey order", () => {
  const events: ReplayOrderEvent[] = []
  let sequence = 10
  const result = completeReplayExitOrderLane({
    run_id: "run-lane",
    exit: {
      role: "target", timestamp: "2026-07-14T08:00:00Z", rawPrice: 110,
      triggerSource: "bar_range", sourceSequence: 1,
    },
    entry_time: "2026-07-14T04:00:00Z",
    entry_source_sequence: 1,
    signed_position: 1,
    stop_order: activeOrder("stop", "stop_market", 1),
    target_order: activeOrder("target", "take_profit_market", 3),
    next_stamp: (eventTime: string, boundaryPhase: ReplayBoundaryPhase, sourceSequence: number, eventSubphase: number) => {
      sequence += 1
      return {
        sequence,
        event_key: createReplayEventKey({
          event_time: eventTime,
          boundary_phase: boundaryPhase,
          source_sequence: sourceSequence,
          event_subphase: eventSubphase,
          stable_event_id: `run-lane:event:${sequence}`,
        }),
      }
    },
    capture: (transition) => {
      events.push(transition.event)
      return transition
    },
  })

  expect(events.map((event) => event.kind)).toEqual(["triggered", "filled", "cancelled"])
  expect(events.map((event) => event.order_id)).toEqual([
    "run-lane:order:target", "run-lane:order:target", "run-lane:order:stop",
  ])
  expect(events.map((event) => event.event_key.boundary_phase)).toEqual([20, 20, 90])
  expect(result).toEqual({
    terminal_state: "flat",
    exit_order_id: "run-lane:order:target",
    exit_quantity: 1,
    signed_position_after: 0,
    exit_fill_event_key: events[1].event_key,
  })
})

test("authorized strategy exit activates and fills before cancelling both brackets", () => {
  const events: ReplayOrderEvent[] = []
  let sequence = 20
  const strategyExit: ReplayOrder = {
    ...activeOrder("strategy_exit", "market", 2),
    status: "submitted",
    active_at: null,
    submitted_at: "2026-07-14T08:00:00Z",
    trigger_price: null,
  }
  const result = completeReplayStrategyExitOrderLane({
    run_id: "run-lane",
    event_time: "2026-07-14T12:00:00Z",
    source_sequence: 3,
    signed_position: 1,
    strategy_exit_order: strategyExit,
    stop_order: activeOrder("stop", "stop_market", 1),
    target_order: activeOrder("target", "take_profit_market", 3),
    next_stamp: (eventTime, boundaryPhase, sourceSequence, eventSubphase) => {
      sequence += 1
      return {
        sequence,
        event_key: createReplayEventKey({
          event_time: eventTime,
          boundary_phase: boundaryPhase,
          source_sequence: sourceSequence,
          event_subphase: eventSubphase,
          stable_event_id: `run-lane:event:${sequence}`,
        }),
      }
    },
    capture: (transition) => {
      events.push(transition.event)
      return transition
    },
  })

  expect(events.map((event) => [event.order_id, event.kind, event.event_key.boundary_phase])).toEqual([
    ["run-lane:order:strategy_exit", "activated", 20],
    ["run-lane:order:strategy_exit", "filled", 20],
    ["run-lane:order:stop", "cancelled", 90],
    ["run-lane:order:target", "cancelled", 90],
  ])
  expect(result).toMatchObject({
    terminal_state: "flat",
    exit_order_id: "run-lane:order:strategy_exit",
    exit_quantity: 1,
    signed_position_after: 0,
  })
})
