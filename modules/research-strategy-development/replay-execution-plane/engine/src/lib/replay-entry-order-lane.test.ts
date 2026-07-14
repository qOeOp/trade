import { expect, test } from "bun:test"
import type { ReplayBoundaryPhase, ReplayOrder, ReplayOrderEvent } from "../../../contracts/src/lib/replay-contracts"
import { createReplayEventKey } from "./replay-event-key"
import { completeReplayEntryOrderLane } from "./replay-entry-order-lane"

test("entry bar-open drives market fill then bracket activation in one causal lane", () => {
  const entryOrder: ReplayOrder = {
    order_id: "run-entry:order:entry",
    order_role: "entry",
    order_type: "market",
    side: "buy",
    quantity: 1,
    filled_quantity: 0,
    remaining_quantity: 1,
    reduce_only: false,
    status: "submitted",
    submitted_at: "2026-07-14T00:00:00Z",
    active_at: null,
    trigger_price: null,
    last_event_sequence: 1,
    last_event_key: createReplayEventKey({
      event_time: "2026-07-14T00:00:00Z", boundary_phase: 90, source_sequence: 0,
      event_subphase: 0, stable_event_id: "run-entry:event:1",
    }),
  }
  const events: ReplayOrderEvent[] = []
  let sequence = 1
  const result = completeReplayEntryOrderLane({
    run_id: "run-entry",
    entry_time: "2026-07-14T04:00:00Z",
    entry_source_sequence: 1,
    entry_order: entryOrder,
    exit_side: "sell",
    stop_price: 95,
    target_price: 110,
    next_stamp: (eventTime: string, boundaryPhase: ReplayBoundaryPhase, sourceSequence: number, eventSubphase: number) => {
      sequence += 1
      return {
        sequence,
        event_key: createReplayEventKey({
          event_time: eventTime,
          boundary_phase: boundaryPhase,
          source_sequence: sourceSequence,
          event_subphase: eventSubphase,
          stable_event_id: `run-entry:event:${sequence}`,
        }),
      }
    },
    capture: (transition) => {
      events.push(transition.event)
      return transition
    },
  })

  expect(events.map((event) => event.kind)).toEqual([
    "activated", "filled", "submitted", "activated", "submitted", "activated",
  ])
  expect(events.map((event) => event.event_key.boundary_phase)).toEqual([20, 20, 90, 90, 90, 90])
  expect(events.map((event) => event.event_key.event_subphase)).toEqual([2, 3, 0, 1, 2, 3])
  expect(result.signed_position_after).toBe(1)
  expect(result.stop_order.status).toBe("active")
  expect(result.target_order.status).toBe("active")
})
