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
  type ReplayTransitionStamp,
} from "./replay-order-state"

export interface ReplayLiquidationOrderExecution {
  terminal_state: "flat"
  exit_order_id: string
  exit_quantity: number
  signed_position_after: 0
  exit_fill_event_key: ReplayEventKey
}

export function completeReplayLiquidationOrderLane(input: {
  run_id: string
  event_time: string
  source_sequence: number
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
  capture: <T extends { event: ReplayOrderEvent }>(transition: T) => T
}): ReplayLiquidationOrderExecution {
  if (input.signed_position === 0) throw new Error("Replay liquidation requires an open position")
  const side = input.signed_position > 0 ? "sell" as const : "buy" as const
  const quantity = Math.abs(input.signed_position)
  input.capture(cancelReplayOrder(
    input.stop_order,
    input.next_stamp(input.event_time, 15, input.source_sequence, 1),
    input.signed_position,
    "maintenance-liquidation",
  ))
  input.capture(cancelReplayOrder(
    input.target_order,
    input.next_stamp(input.event_time, 15, input.source_sequence, 2),
    input.signed_position,
    "maintenance-liquidation",
  ))
  let orderSubphase = 3
  if (input.strategy_exit_order) {
    input.capture(cancelReplayOrder(
      input.strategy_exit_order,
      input.next_stamp(input.event_time, 15, input.source_sequence, orderSubphase),
      input.signed_position,
      "maintenance-liquidation",
    ))
    orderSubphase += 1
  }
  if (input.partial_reduce_order?.status === "submitted") {
    input.capture(cancelReplayOrder(
      input.partial_reduce_order,
      input.next_stamp(input.event_time, 15, input.source_sequence, orderSubphase),
      input.signed_position,
      "maintenance-liquidation",
    ))
    orderSubphase += 1
  }
  let order = input.capture(submitReplayOrder({
    order_id: `${input.run_id}:order:liquidation`,
    order_role: "liquidation",
    order_type: "market",
    side,
    quantity,
    reduce_only: true,
    submitted_at: input.event_time,
  }, input.next_stamp(input.event_time, 15, input.source_sequence, orderSubphase), input.signed_position)).order
  order = input.capture(activateReplayOrder(
    order,
    input.next_stamp(input.event_time, 15, input.source_sequence, orderSubphase + 1),
    input.signed_position,
  )).order
  const fill = input.capture(fillReplayOrder({
    order,
    requested_quantity: order.remaining_quantity,
    stamp: input.next_stamp(input.event_time, 15, input.source_sequence, orderSubphase + 2),
    signed_position_before: input.signed_position,
  }))
  if (fill.signed_position_after !== 0 || fill.order.status !== "filled") {
    throw new Error("certified Replay liquidation must fully close the position")
  }
  return {
    terminal_state: "flat",
    exit_order_id: fill.order.order_id,
    exit_quantity: fill.executed_quantity,
    signed_position_after: 0,
    exit_fill_event_key: fill.event.event_key,
  }
}
