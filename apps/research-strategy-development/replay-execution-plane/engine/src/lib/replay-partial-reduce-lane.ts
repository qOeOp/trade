import type {
  ReplayBoundaryPhase,
  ReplayEventKey,
  ReplayOrder,
  ReplayOrderSide,
} from "../../../contracts/src/lib/replay-contracts"
import {
  activateReplayOrder,
  cancelReplayOrder,
  fillReplayOrder,
  submitReplayOrder,
  type ReplayTransitionStamp,
} from "./replay-order-state"
import type { ReplayTransitionCapture } from "./replay-exit-order-lane"

export interface ReplayPartialReduceExecution {
  partial_order: ReplayOrder
  partial_order_id: string
  executed_quantity: number
  signed_position_after: number
  partial_fill_event_key: ReplayEventKey
  stop_order: ReplayOrder
  target_order: ReplayOrder
}

export function completeReplayPartialReduceLane(input: {
  run_id: string
  decision_sequence: number
  event_time: string
  source_sequence: number
  signed_position: number
  partial_order: ReplayOrder
  stop_order: ReplayOrder
  target_order: ReplayOrder
  exit_side: ReplayOrderSide
  next_stamp: (
    eventTime: string,
    boundaryPhase: ReplayBoundaryPhase,
    sourceSequence: number,
    eventSubphase: number,
  ) => ReplayTransitionStamp
  capture: ReplayTransitionCapture
}): ReplayPartialReduceExecution {
  if (input.signed_position === 0
      || input.stop_order.status !== "active"
      || input.target_order.status !== "active"
      || input.stop_order.trigger_price === null
      || input.target_order.trigger_price === null) {
    throw new Error("Replay partial reduce requires one open fully protected position")
  }
  let partialOrder = input.capture(activateReplayOrder(
    input.partial_order,
    input.next_stamp(input.event_time, 20, input.source_sequence, 2),
    input.signed_position,
  )).order
  const partialTransition = input.capture(fillReplayOrder({
    order: partialOrder,
    requested_quantity: partialOrder.remaining_quantity,
    stamp: input.next_stamp(input.event_time, 20, input.source_sequence, 3),
    signed_position_before: input.signed_position,
  }))
  partialOrder = partialTransition.order
  if (partialOrder.status !== "filled" || partialTransition.signed_position_after === 0) {
    throw new Error("certified Replay partial reduce must fill its fixed quantity and leave the position open")
  }

  input.capture(cancelReplayOrder(
    input.stop_order,
    input.next_stamp(input.event_time, 90, input.source_sequence, 0),
    partialTransition.signed_position_after,
    "partial-reduce-protection-resize",
  ))
  input.capture(cancelReplayOrder(
    input.target_order,
    input.next_stamp(input.event_time, 90, input.source_sequence, 1),
    partialTransition.signed_position_after,
    "partial-reduce-protection-resize",
  ))

  const remainingQuantity = Math.abs(partialTransition.signed_position_after)
  let stopOrder = input.capture(submitReplayOrder({
    order_id: `${input.run_id}:order:stop-after-partial:${input.decision_sequence}`,
    order_role: "stop",
    order_type: "stop_market",
    side: input.exit_side,
    quantity: remainingQuantity,
    reduce_only: true,
    submitted_at: input.event_time,
    trigger_price: input.stop_order.trigger_price,
  }, input.next_stamp(input.event_time, 90, input.source_sequence, 2), partialTransition.signed_position_after)).order
  stopOrder = input.capture(activateReplayOrder(
    stopOrder,
    input.next_stamp(input.event_time, 90, input.source_sequence, 3),
    partialTransition.signed_position_after,
  )).order

  let targetOrder = input.capture(submitReplayOrder({
    order_id: `${input.run_id}:order:target-after-partial:${input.decision_sequence}`,
    order_role: "target",
    order_type: "take_profit_market",
    side: input.exit_side,
    quantity: remainingQuantity,
    reduce_only: true,
    submitted_at: input.event_time,
    trigger_price: input.target_order.trigger_price,
  }, input.next_stamp(input.event_time, 90, input.source_sequence, 4), partialTransition.signed_position_after)).order
  targetOrder = input.capture(activateReplayOrder(
    targetOrder,
    input.next_stamp(input.event_time, 90, input.source_sequence, 5),
    partialTransition.signed_position_after,
  )).order

  return {
    partial_order: partialOrder,
    partial_order_id: partialOrder.order_id,
    executed_quantity: partialTransition.executed_quantity,
    signed_position_after: partialTransition.signed_position_after,
    partial_fill_event_key: partialTransition.event.event_key,
    stop_order: stopOrder,
    target_order: targetOrder,
  }
}
