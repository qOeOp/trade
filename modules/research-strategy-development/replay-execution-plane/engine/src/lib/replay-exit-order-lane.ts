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
  triggerReplayOrder,
  type ReplayTransitionStamp,
} from "./replay-order-state"
import type { ReplayReducedExit } from "./replay-source-reducer"

type ReplayExitOrderLaneExit =
  | Omit<Extract<ReplayReducedExit, { triggerSource: "bar_open" | "bar_range" }>, "resolution_evidence">
  | Extract<ReplayReducedExit, { role: "end_of_data" }>

export interface ReplayExitOrderExecution {
  terminal_state: "flat" | "open_marked"
  exit_order_id: string | null
  exit_quantity: number
  signed_position_after: number
  exit_fill_event_key: ReplayEventKey | null
}

export type ReplayTransitionCapture = <T extends { event: ReplayOrderEvent }>(transition: T) => T

export function completeReplayExitOrderLane(input: {
  run_id: string
  exit: ReplayExitOrderLaneExit
  entry_time: string
  entry_source_sequence: number
  signed_position: number
  stop_order: ReplayOrder
  target_order: ReplayOrder
  strategy_exit_order?: ReplayOrder | null
  partial_reduce_order?: ReplayOrder | null
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
    if (input.strategy_exit_order) input.capture(cancelReplayOrder(
      input.strategy_exit_order,
      input.next_stamp(exit.timestamp, 90, exit.sourceSequence, siblingCancelSubphase + 1),
      transition.signed_position_after,
      "sibling-exit-filled",
    ))
    if (input.partial_reduce_order?.status === "submitted") input.capture(cancelReplayOrder(
      input.partial_reduce_order,
      input.next_stamp(exit.timestamp, 90, exit.sourceSequence, siblingCancelSubphase + 2),
      transition.signed_position_after,
      "sibling-exit-filled",
    ))
    return execution("flat", stopOrder.order_id, transition.executed_quantity, transition.signed_position_after, transition.event.event_key)
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
    if (input.strategy_exit_order) input.capture(cancelReplayOrder(
      input.strategy_exit_order,
      input.next_stamp(exit.timestamp, 90, exit.sourceSequence, siblingCancelSubphase + 1),
      transition.signed_position_after,
      "sibling-exit-filled",
    ))
    if (input.partial_reduce_order?.status === "submitted") input.capture(cancelReplayOrder(
      input.partial_reduce_order,
      input.next_stamp(exit.timestamp, 90, exit.sourceSequence, siblingCancelSubphase + 2),
      transition.signed_position_after,
      "sibling-exit-filled",
    ))
    return execution("flat", targetOrder.order_id, transition.executed_quantity, transition.signed_position_after, transition.event.event_key)
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
  if (input.strategy_exit_order) input.capture(cancelReplayOrder(
    input.strategy_exit_order,
    input.next_stamp(exit.timestamp, 90, exit.sourceSequence, 2),
    input.signed_position,
    "end-of-data",
  ))
  if (input.partial_reduce_order?.status === "submitted") input.capture(cancelReplayOrder(
    input.partial_reduce_order,
    input.next_stamp(exit.timestamp, 90, exit.sourceSequence, 3),
    input.signed_position,
    "end-of-data",
  ))
  return execution("open_marked", null, 0, input.signed_position, null)
}

export function completeReplayStrategyExitOrderLane(input: {
  run_id: string
  event_time: string
  source_sequence: number
  signed_position: number
  strategy_exit_order: ReplayOrder
  partial_reduce_order?: ReplayOrder | null
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
  if (input.signed_position === 0) throw new Error("Replay strategy exit requires an open position")
  let strategyExitOrder = input.capture(activateReplayOrder(
    input.strategy_exit_order,
    input.next_stamp(input.event_time, 20, input.source_sequence, 2),
    input.signed_position,
  )).order
  const transition = input.capture(fillReplayOrder({
    order: strategyExitOrder,
    requested_quantity: strategyExitOrder.remaining_quantity,
    stamp: input.next_stamp(input.event_time, 20, input.source_sequence, 3),
    signed_position_before: input.signed_position,
  }))
  strategyExitOrder = transition.order
  if (strategyExitOrder.status !== "filled" || transition.signed_position_after !== 0) {
    throw new Error("certified Replay strategy exit must fully close the position")
  }
  input.capture(cancelReplayOrder(
    input.stop_order,
    input.next_stamp(input.event_time, 90, input.source_sequence, 0),
    transition.signed_position_after,
    "strategy-exit-filled",
  ))
  input.capture(cancelReplayOrder(
    input.target_order,
    input.next_stamp(input.event_time, 90, input.source_sequence, 1),
    transition.signed_position_after,
    "strategy-exit-filled",
  ))
  if (input.partial_reduce_order?.status === "submitted") input.capture(cancelReplayOrder(
    input.partial_reduce_order,
    input.next_stamp(input.event_time, 90, input.source_sequence, 2),
    transition.signed_position_after,
    "strategy-exit-filled",
  ))
  return execution(
    "flat",
    strategyExitOrder.order_id,
    transition.executed_quantity,
    transition.signed_position_after,
    transition.event.event_key,
  )
}

function execution(
  terminalState: ReplayExitOrderExecution["terminal_state"],
  exitOrderId: string | null,
  exitQuantity: number,
  signedPositionAfter: number,
  exitFillEventKey: ReplayEventKey | null,
): ReplayExitOrderExecution {
  return {
    terminal_state: terminalState,
    exit_order_id: exitOrderId,
    exit_quantity: exitQuantity,
    signed_position_after: signedPositionAfter,
    exit_fill_event_key: exitFillEventKey,
  }
}
