import type {
  ReplayBoundaryPhase,
  ReplayEventKey,
  ReplayOrder,
  ReplayOrderEvent,
} from "../../../contracts/src/lib/replay-contracts"
import {
  activateReplayOrder,
  cancelReplayOrder,
  fillReplayOrder,
  submitReplayOrder,
  triggerReplayOrder,
  type ReplayTransitionStamp,
} from "./replay-order-state"
import type { ReplayReducedExit } from "./replay-source-reducer"

export interface ReplayExitOrderExecution {
  exit_order_id: string
  exit_quantity: number
  signed_position_after: number
  exit_fill_event_key: ReplayEventKey
}

export type ReplayTransitionCapture = <T extends { event: ReplayOrderEvent }>(transition: T) => T

export function completeReplayExitOrderLane(input: {
  run_id: string
  exit: ReplayReducedExit
  entry_time: string
  entry_source_sequence: number
  signed_position: number
  stop_order: ReplayOrder
  target_order: ReplayOrder
  next_stamp: (
    eventTime: string,
    boundaryPhase: ReplayBoundaryPhase,
    sourceSequence: number,
    eventSubphase: number,
  ) => ReplayTransitionStamp
  capture: ReplayTransitionCapture
}): ReplayExitOrderExecution {
  const { exit } = input
  const immediateAfterActivation = exit.timestamp === input.entry_time && exit.sourceSequence === input.entry_source_sequence
  const triggerPhase: ReplayBoundaryPhase = immediateAfterActivation ? 90 : 20
  const triggerSubphase = immediateAfterActivation ? 4 : 2
  const siblingCancelSubphase = immediateAfterActivation ? 6 : 0
  let stopOrder = input.stop_order
  let targetOrder = input.target_order

  if (exit.role === "stop") {
    stopOrder = input.capture(triggerReplayOrder(
      stopOrder,
      input.next_stamp(exit.timestamp, triggerPhase, exit.sourceSequence, triggerSubphase),
      input.signed_position,
      exit.triggerSource,
      exit.rawPrice,
    )).order
    const transition = input.capture(fillReplayOrder({
      order: stopOrder,
      requested_quantity: stopOrder.remaining_quantity,
      stamp: input.next_stamp(exit.timestamp, triggerPhase, exit.sourceSequence, triggerSubphase + 1),
      signed_position_before: input.signed_position,
    }))
    targetOrder = input.capture(cancelReplayOrder(
      targetOrder,
      input.next_stamp(exit.timestamp, 90, exit.sourceSequence, siblingCancelSubphase),
      transition.signed_position_after,
      "sibling-exit-filled",
    )).order
    return execution(stopOrder.order_id, transition.executed_quantity, transition.signed_position_after, transition.event.event_key)
  }

  if (exit.role === "target") {
    targetOrder = input.capture(triggerReplayOrder(
      targetOrder,
      input.next_stamp(exit.timestamp, triggerPhase, exit.sourceSequence, triggerSubphase),
      input.signed_position,
      exit.triggerSource,
      exit.rawPrice,
    )).order
    const transition = input.capture(fillReplayOrder({
      order: targetOrder,
      requested_quantity: targetOrder.remaining_quantity,
      stamp: input.next_stamp(exit.timestamp, triggerPhase, exit.sourceSequence, triggerSubphase + 1),
      signed_position_before: input.signed_position,
    }))
    stopOrder = input.capture(cancelReplayOrder(
      stopOrder,
      input.next_stamp(exit.timestamp, 90, exit.sourceSequence, siblingCancelSubphase),
      transition.signed_position_after,
      "sibling-exit-filled",
    )).order
    return execution(targetOrder.order_id, transition.executed_quantity, transition.signed_position_after, transition.event.event_key)
  }

  stopOrder = input.capture(cancelReplayOrder(
    stopOrder,
    input.next_stamp(exit.timestamp, 90, exit.sourceSequence, 0),
    input.signed_position,
    "end-of-data",
  )).order
  targetOrder = input.capture(cancelReplayOrder(
    targetOrder,
    input.next_stamp(exit.timestamp, 90, exit.sourceSequence, 1),
    input.signed_position,
    "end-of-data",
  )).order
  const exitOrderId = `${input.run_id}:order:end-of-data`
  let endOfDataOrder = input.capture(submitReplayOrder({
    order_id: exitOrderId,
    order_role: "end_of_data",
    order_type: "market",
    side: stopOrder.side,
    quantity: stopOrder.quantity,
    reduce_only: true,
    submitted_at: exit.timestamp,
  }, input.next_stamp(exit.timestamp, 90, exit.sourceSequence, 2), input.signed_position)).order
  endOfDataOrder = input.capture(activateReplayOrder(
    endOfDataOrder,
    input.next_stamp(exit.timestamp, 90, exit.sourceSequence, 3),
    input.signed_position,
  )).order
  const transition = input.capture(fillReplayOrder({
    order: endOfDataOrder,
    requested_quantity: endOfDataOrder.remaining_quantity,
    stamp: input.next_stamp(exit.timestamp, 90, exit.sourceSequence, 4),
    signed_position_before: input.signed_position,
  }))
  return execution(exitOrderId, transition.executed_quantity, transition.signed_position_after, transition.event.event_key)
}

function execution(
  exitOrderId: string,
  exitQuantity: number,
  signedPositionAfter: number,
  exitFillEventKey: ReplayEventKey,
): ReplayExitOrderExecution {
  return {
    exit_order_id: exitOrderId,
    exit_quantity: exitQuantity,
    signed_position_after: signedPositionAfter,
    exit_fill_event_key: exitFillEventKey,
  }
}
