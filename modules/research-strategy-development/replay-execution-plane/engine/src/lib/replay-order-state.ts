import type {
  ReplayEventKey,
  ReplayOrder,
  ReplayOrderEvent,
  ReplayOrderRole,
  ReplayOrderSide,
  ReplayOrderType,
} from "../../../contracts/src/lib/replay-contracts"
import { compareReplayEventKeys, createReplayEventKey } from "./replay-event-key"

export interface ReplayOrderSubmission {
  order_id: string
  order_role: ReplayOrderRole
  order_type: ReplayOrderType
  side: ReplayOrderSide
  quantity: number
  reduce_only: boolean
  submitted_at: string
  trigger_price?: number | null
}

export interface ReplayOrderTransition {
  order: ReplayOrder
  event: ReplayOrderEvent
}

export interface ReplayTransitionStamp {
  sequence: number
  event_key: ReplayEventKey
}

export interface ReplayOrderFillTransition extends ReplayOrderTransition {
  executed_quantity: number
  signed_position_after: number
}

export function submitReplayOrder(
  submission: ReplayOrderSubmission,
  stamp: ReplayTransitionStamp,
  signedPosition: number,
): ReplayOrderTransition {
  requireText(submission.order_id, "order_id")
  requireUtcTimestamp(submission.submitted_at, "submitted_at")
  requirePositive(submission.quantity, "quantity")
  validateStamp(stamp)
  if (stamp.event_key.event_time !== submission.submitted_at) throw new Error("submission time must equal event key time")
  requireFinite(signedPosition, "signed_position")
  validateRoleContract(submission)
  const quantity = roundQuantity(submission.quantity)
  const order: ReplayOrder = {
    order_id: submission.order_id,
    order_role: submission.order_role,
    order_type: submission.order_type,
    side: submission.side,
    quantity,
    filled_quantity: 0,
    remaining_quantity: quantity,
    reduce_only: submission.reduce_only,
    status: "submitted",
    submitted_at: submission.submitted_at,
    active_at: null,
    trigger_price: submission.trigger_price ?? null,
    last_event_sequence: stamp.sequence,
    last_event_key: stamp.event_key,
  }
  return { order, event: eventFor(order, stamp, "submitted", 0, signedPosition, null) }
}

export function activateReplayOrder(
  order: ReplayOrder,
  stamp: ReplayTransitionStamp,
  signedPosition: number,
): ReplayOrderTransition {
  requireNextStamp(order, stamp)
  if (order.status !== "submitted") throw new Error(`cannot activate order in ${order.status} state`)
  const active = {
    ...order,
    status: "active" as const,
    active_at: stamp.event_key.event_time,
    last_event_sequence: stamp.sequence,
    last_event_key: stamp.event_key,
  }
  return { order: active, event: eventFor(active, stamp, "activated", 0, signedPosition, null) }
}

export function triggerReplayOrder(
  order: ReplayOrder,
  stamp: ReplayTransitionStamp,
  signedPosition: number,
  triggerSource: "bar_open" | "bar_range",
  triggerObservedPrice: number,
): ReplayOrderTransition {
  requireNextStamp(order, stamp)
  if (order.status !== "active") throw new Error(`cannot trigger order in ${order.status} state`)
  if (order.order_type === "market") throw new Error("market order cannot trigger")
  requireFinite(signedPosition, "signed_position")
  requirePositive(triggerObservedPrice, "trigger_observed_price")
  if (triggerSource !== "bar_open" && triggerSource !== "bar_range") throw new Error("unsupported trigger source")
  if (order.active_at === null) throw new Error("order cannot trigger before activation")
  const triggered = {
    ...order,
    status: "triggered" as const,
    last_event_sequence: stamp.sequence,
    last_event_key: stamp.event_key,
  }
  return {
    order: triggered,
    event: eventFor(triggered, stamp, "triggered", 0, signedPosition, null, triggerSource, triggerObservedPrice),
  }
}

export function fillReplayOrder(input: {
  order: ReplayOrder
  requested_quantity: number
  stamp: ReplayTransitionStamp
  signed_position_before: number
}): ReplayOrderFillTransition {
  const { order } = input
  requireNextStamp(order, input.stamp)
  const fillable = order.order_type === "market"
    ? order.status === "active" || order.status === "partially_filled"
    : order.status === "triggered" || order.status === "partially_filled"
  if (!fillable) {
    throw new Error(`cannot fill order in ${order.status} state`)
  }
  requirePositive(input.requested_quantity, "requested_quantity")
  requireFinite(input.signed_position_before, "signed_position_before")
  if (order.active_at === null) throw new Error("order cannot fill before activation")
  const requested = Math.min(roundQuantity(input.requested_quantity), order.remaining_quantity)
  const reducible = order.reduce_only ? reducibleQuantity(order.side, input.signed_position_before) : Number.POSITIVE_INFINITY
  const executed = roundQuantity(Math.min(requested, reducible))
  if (executed <= 0) {
    const rejected = {
      ...order,
      status: "rejected" as const,
      last_event_sequence: input.stamp.sequence,
      last_event_key: input.stamp.event_key,
    }
    return {
      order: rejected,
      event: eventFor(rejected, input.stamp, "rejected", 0, input.signed_position_before, "reduce-only-would-not-reduce"),
      executed_quantity: 0,
      signed_position_after: input.signed_position_before,
    }
  }
  const filled = roundQuantity(order.filled_quantity + executed)
  const remaining = roundQuantity(Math.max(0, order.quantity - filled))
  const status = remaining === 0 ? "filled" as const : "partially_filled" as const
  const signedPositionAfter = roundQuantity(input.signed_position_before + (order.side === "buy" ? executed : -executed))
  const next = {
    ...order,
    filled_quantity: filled,
    remaining_quantity: remaining,
    status,
    last_event_sequence: input.stamp.sequence,
    last_event_key: input.stamp.event_key,
  }
  return {
    order: next,
    event: eventFor(next, input.stamp, status === "filled" ? "filled" : "partially_filled", executed, signedPositionAfter, null),
    executed_quantity: executed,
    signed_position_after: signedPositionAfter,
  }
}

export function cancelReplayOrder(
  order: ReplayOrder,
  stamp: ReplayTransitionStamp,
  signedPosition: number,
  reason: string,
): ReplayOrderTransition {
  requireNextStamp(order, stamp)
  if (order.status !== "submitted" && order.status !== "active" && order.status !== "triggered" && order.status !== "partially_filled") {
    throw new Error(`cannot cancel order in ${order.status} state`)
  }
  requireText(reason, "cancel reason")
  const cancelled = {
    ...order,
    status: "cancelled" as const,
    last_event_sequence: stamp.sequence,
    last_event_key: stamp.event_key,
  }
  return { order: cancelled, event: eventFor(cancelled, stamp, "cancelled", 0, signedPosition, reason) }
}

function validateRoleContract(submission: ReplayOrderSubmission): void {
  if (!["entry", "stop", "target", "strategy_exit", "liquidation", "end_of_data"].includes(submission.order_role)) throw new Error("unsupported order_role")
  if (!["market", "stop_market", "take_profit_market"].includes(submission.order_type)) throw new Error("unsupported order_type")
  if (submission.side !== "buy" && submission.side !== "sell") throw new Error("unsupported order side")
  if (submission.order_role === "entry") {
    if (submission.order_type !== "market" || submission.reduce_only) throw new Error("entry must be a non-reduce-only market order")
  } else if (!submission.reduce_only) {
    throw new Error("exit orders must be reduce-only")
  }
  if (submission.order_role === "stop" && submission.order_type !== "stop_market") throw new Error("stop role requires stop_market")
  if (submission.order_role === "target" && submission.order_type !== "take_profit_market") throw new Error("target role requires take_profit_market")
  if (submission.order_role === "liquidation" && submission.order_type !== "market") throw new Error("liquidation role requires market")
  if (submission.order_role === "end_of_data" && submission.order_type !== "market") throw new Error("end_of_data role requires market")
  const needsTrigger = submission.order_type === "stop_market" || submission.order_type === "take_profit_market"
  if (needsTrigger) requirePositive(submission.trigger_price, "trigger_price")
  if (!needsTrigger && submission.trigger_price != null) throw new Error("market order cannot carry trigger_price")
}

function reducibleQuantity(side: ReplayOrderSide, signedPosition: number): number {
  return side === "sell" ? Math.max(0, signedPosition) : Math.max(0, -signedPosition)
}

function eventFor(
  order: ReplayOrder,
  stamp: ReplayTransitionStamp,
  kind: ReplayOrderEvent["kind"],
  fillQuantity: number,
  signedPositionAfter: number,
  reason: string | null,
  triggerSource: ReplayOrderEvent["trigger_source"] = null,
  triggerObservedPrice: number | null = null,
): ReplayOrderEvent {
  return {
    event_id: `${order.order_id}:event:${stamp.sequence}`,
    order_id: order.order_id,
    sequence: stamp.sequence,
    event_key: stamp.event_key,
    timestamp: stamp.event_key.event_time,
    kind,
    status: order.status,
    fill_quantity: roundQuantity(fillQuantity),
    remaining_quantity: order.remaining_quantity,
    signed_position_after: roundQuantity(signedPositionAfter),
    reason,
    trigger_source: triggerSource,
    trigger_observed_price: triggerObservedPrice === null ? null : roundQuantity(triggerObservedPrice),
  }
}

function roundQuantity(value: number): number {
  return Number(value.toFixed(12))
}

function requirePositive(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error(`${field} must be positive`)
}

function requireFinite(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${field} must be finite`)
}

function requireSequence(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("event sequence must be a positive safe integer")
}

function validateStamp(stamp: ReplayTransitionStamp): void {
  requireSequence(stamp.sequence)
  createReplayEventKey(stamp.event_key)
}

function requireNextStamp(order: ReplayOrder, stamp: ReplayTransitionStamp): void {
  validateStamp(stamp)
  if (stamp.sequence <= order.last_event_sequence) throw new Error("event sequence must increase for an order")
  if (compareReplayEventKeys(stamp.event_key, order.last_event_key) <= 0) throw new Error("event key must follow the prior order event")
}

function requireText(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} is required`)
}

function requireUtcTimestamp(value: unknown, field: string): asserts value is string {
  requireText(value, field)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${field} must be an RFC 3339 UTC timestamp`)
  }
}
