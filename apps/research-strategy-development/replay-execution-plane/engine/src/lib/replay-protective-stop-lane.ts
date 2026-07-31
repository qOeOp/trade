import type {
  ReplayBoundaryPhase,
  ReplayOrder,
  ReplayOrderEvent,
  ReplayOrderSide,
} from "../../../contracts/src/lib/replay-contracts"
import {
  activateReplayOrder,
  cancelReplayOrder,
  submitReplayOrder,
  type ReplayTransitionStamp,
} from "./replay-order-state"

export function replaceReplayProtectiveStop(input: {
  run_id: string
  decision_sequence: number
  decision_time: string
  source_sequence: number
  signed_position: number
  side: ReplayOrderSide
  new_stop_price: number
  current_stop_order: ReplayOrder
  next_stamp: (
    eventTime: string,
    boundaryPhase: ReplayBoundaryPhase,
    sourceSequence: number,
    eventSubphase: number,
  ) => ReplayTransitionStamp
  capture: <T extends { order: ReplayOrder; event: ReplayOrderEvent }>(transition: T) => T
}): ReplayOrder {
  if (input.signed_position === 0 || input.current_stop_order.status !== "active") {
    throw new Error("Replay protective stop replacement requires an active protected position")
  }
  input.capture(cancelReplayOrder(
    input.current_stop_order,
    input.next_stamp(input.decision_time, 90, input.source_sequence, 0),
    input.signed_position,
    "protective-stop-replaced",
  ))
  let replacement = input.capture(submitReplayOrder({
    order_id: `${input.run_id}:order:stop-replacement:${input.decision_sequence}`,
    order_role: "stop",
    order_type: "stop_market",
    side: input.side,
    quantity: Math.abs(input.signed_position),
    reduce_only: true,
    submitted_at: input.decision_time,
    trigger_price: input.new_stop_price,
  }, input.next_stamp(input.decision_time, 90, input.source_sequence, 1), input.signed_position)).order
  replacement = input.capture(activateReplayOrder(
    replacement,
    input.next_stamp(input.decision_time, 90, input.source_sequence, 2),
    input.signed_position,
  )).order
  return replacement
}
