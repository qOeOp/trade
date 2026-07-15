import type {
  ReplayBoundaryPhase,
  ReplayEventKey,
  ReplayOrder,
  ReplayOrderSide,
} from "../../../contracts/src/lib/replay-contracts"
import {
  activateReplayOrder,
  fillReplayOrder,
  submitReplayOrder,
  type ReplayTransitionStamp,
} from "./replay-order-state"
import type { ReplayTransitionCapture } from "./replay-exit-order-lane"

export interface ReplayEntryOrderExecution {
  entry_order: ReplayOrder
  entry_order_id: string
  executed_quantity: number
  signed_position_after: number
  entry_fill_event_key: ReplayEventKey
  stop_order: ReplayOrder
  target_order: ReplayOrder
}

export function completeReplayEntryOrderLane(input: {
  run_id: string
  entry_time: string
  entry_source_sequence: number
  entry_order: ReplayOrder
  exit_side: ReplayOrderSide
  stop_price: number
  target_price: number
  next_stamp: (
    eventTime: string,
    boundaryPhase: ReplayBoundaryPhase,
    sourceSequence: number,
    eventSubphase: number,
  ) => ReplayTransitionStamp
  capture: ReplayTransitionCapture
}): ReplayEntryOrderExecution {
  let entryOrder = input.capture(activateReplayOrder(
    input.entry_order,
    input.next_stamp(input.entry_time, 20, input.entry_source_sequence, 2),
    0,
  )).order
  const entryTransition = input.capture(fillReplayOrder({
    order: entryOrder,
    requested_quantity: entryOrder.remaining_quantity,
    stamp: input.next_stamp(input.entry_time, 20, input.entry_source_sequence, 3),
    signed_position_before: 0,
  }))
  entryOrder = entryTransition.order
  const signedPosition = entryTransition.signed_position_after

  let stopOrder = input.capture(submitReplayOrder({
    order_id: `${input.run_id}:order:stop`,
    order_role: "stop",
    order_type: "stop_market",
    side: input.exit_side,
    quantity: entryTransition.executed_quantity,
    reduce_only: true,
    submitted_at: input.entry_time,
    trigger_price: input.stop_price,
  }, input.next_stamp(input.entry_time, 90, input.entry_source_sequence, 0), signedPosition)).order
  stopOrder = input.capture(activateReplayOrder(
    stopOrder,
    input.next_stamp(input.entry_time, 90, input.entry_source_sequence, 1),
    signedPosition,
  )).order

  let targetOrder = input.capture(submitReplayOrder({
    order_id: `${input.run_id}:order:target`,
    order_role: "target",
    order_type: "take_profit_market",
    side: input.exit_side,
    quantity: entryTransition.executed_quantity,
    reduce_only: true,
    submitted_at: input.entry_time,
    trigger_price: input.target_price,
  }, input.next_stamp(input.entry_time, 90, input.entry_source_sequence, 2), signedPosition)).order
  targetOrder = input.capture(activateReplayOrder(
    targetOrder,
    input.next_stamp(input.entry_time, 90, input.entry_source_sequence, 3),
    signedPosition,
  )).order

  return {
    entry_order: entryOrder,
    entry_order_id: entryOrder.order_id,
    executed_quantity: entryTransition.executed_quantity,
    signed_position_after: signedPosition,
    entry_fill_event_key: entryTransition.event.event_key,
    stop_order: stopOrder,
    target_order: targetOrder,
  }
}
