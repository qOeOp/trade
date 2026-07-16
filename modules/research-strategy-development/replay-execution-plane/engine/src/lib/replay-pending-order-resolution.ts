import {
  REPLAY_PENDING_ORDER_RESOLUTION_SCHEMA_VERSION,
  assertReplayPendingOrderResolution,
  compareReplayEventKeys,
  replayPendingOrderResolutionHash,
  type ReplayEventKey,
  type ReplayPendingOrderObservation,
  type ReplayPendingOrderOutcomeReason,
  type ReplayPendingOrderResolution,
  type ReplayPendingOrderSpec,
} from "../../../contracts/src/lib/replay-contracts"

export interface ReplayPendingOrderResolutionInput {
  order: ReplayPendingOrderSpec
  observation: ReplayPendingOrderObservation
  cancel_effective_key: ReplayEventKey | null
}

interface PriceResolution {
  fills: boolean
  reason: ReplayPendingOrderOutcomeReason
  fillReferencePrice: number | null
  queueLimited: boolean
}

export function resolveReplayPendingOrder(
  input: ReplayPendingOrderResolutionInput,
): ReplayPendingOrderResolution {
  const shell = provisionalShell(input)
  const { order, observation, cancel_effective_key: cancelKey } = input
  if (cancelKey && sameEventOrdinal(cancelKey, observation.source_event_key)) {
    return finish(shell, {
      status: "unresolved",
      reason: "same_ordinal_cancel_race",
      decisive_event_key: null,
      fill_reference_price: null,
      fill_quantity: 0,
      remaining_quantity: order.quantity,
    }, ["same-event-order-unproven"])
  }
  if (cancelKey && compareReplayEventKeys(cancelKey, observation.source_event_key) < 0) {
    return finish(shell, {
      status: "cancelled",
      reason: "cancel_precedes_observation",
      decisive_event_key: structuredClone(cancelKey),
      fill_reference_price: null,
      fill_quantity: 0,
      remaining_quantity: order.quantity,
    }, [])
  }

  const priceResolution = order.order_type === "limit"
    ? resolveLimit(order, observation)
    : resolveStop(order, observation)
  if (priceResolution.fills) {
    return finish(shell, {
      status: order.order_type === "limit" ? "filled" : "triggered_and_filled",
      reason: priceResolution.reason,
      decisive_event_key: structuredClone(observation.source_event_key),
      fill_reference_price: priceResolution.fillReferencePrice,
      fill_quantity: order.quantity,
      remaining_quantity: 0,
    }, priceResolution.queueLimited ? ["ohlcv-limit-queue-unobserved"] : [])
  }
  if (order.time_in_force === "ioc") {
    return finish(shell, {
      status: "expired",
      reason: "ioc_unfilled_at_first_open",
      decisive_event_key: structuredClone(observation.source_event_key),
      fill_reference_price: null,
      fill_quantity: 0,
      remaining_quantity: order.quantity,
    }, [])
  }
  if (cancelKey) {
    if (priceResolution.queueLimited) {
      return finish(shell, {
        status: "unresolved",
        reason: "limit_touch_before_cancel_unresolved",
        decisive_event_key: null,
        fill_reference_price: null,
        fill_quantity: 0,
        remaining_quantity: order.quantity,
      }, ["ohlcv-limit-queue-unobserved"])
    }
    return finish(shell, {
      status: "cancelled",
      reason: "cancel_after_non_fill",
      decisive_event_key: structuredClone(cancelKey),
      fill_reference_price: null,
      fill_quantity: 0,
      remaining_quantity: order.quantity,
    }, priceResolution.queueLimited ? ["ohlcv-limit-queue-unobserved"] : [])
  }
  return finish(shell, {
    status: "resting",
    reason: priceResolution.reason,
    decisive_event_key: structuredClone(observation.source_event_key),
    fill_reference_price: null,
    fill_quantity: 0,
    remaining_quantity: order.quantity,
  }, priceResolution.queueLimited ? ["ohlcv-limit-queue-unobserved"] : [])
}

function resolveLimit(order: ReplayPendingOrderSpec, observation: ReplayPendingOrderObservation): PriceResolution {
  const limit = order.limit_price!
  if (observation.observation_kind === "bar_open") {
    const marketable = order.side === "buy" ? observation.bar.open <= limit : observation.bar.open >= limit
    return marketable
      ? { fills: true, reason: "limit_open_marketable", fillReferencePrice: observation.bar.open, queueLimited: true }
      : { fills: false, reason: "limit_not_reached", fillReferencePrice: null, queueLimited: false }
  }
  const extreme = order.side === "buy" ? observation.bar.low : observation.bar.high
  const strictCross = order.side === "buy" ? extreme < limit : extreme > limit
  if (strictCross) return { fills: true, reason: "limit_strict_cross", fillReferencePrice: limit, queueLimited: true }
  if (extreme === limit) return { fills: false, reason: "limit_touch_queue_unproven", fillReferencePrice: null, queueLimited: true }
  return { fills: false, reason: "limit_not_reached", fillReferencePrice: null, queueLimited: false }
}

function resolveStop(order: ReplayPendingOrderSpec, observation: ReplayPendingOrderObservation): PriceResolution {
  const trigger = order.trigger_price!
  if (observation.observation_kind === "bar_open") {
    const triggered = order.side === "buy" ? observation.bar.open >= trigger : observation.bar.open <= trigger
    return triggered
      ? { fills: true, reason: "stop_open_gap", fillReferencePrice: observation.bar.open, queueLimited: false }
      : { fills: false, reason: "stop_not_triggered", fillReferencePrice: null, queueLimited: false }
  }
  const triggered = order.side === "buy" ? observation.bar.high >= trigger : observation.bar.low <= trigger
  return triggered
    ? { fills: true, reason: "stop_range_trigger", fillReferencePrice: trigger, queueLimited: false }
    : { fills: false, reason: "stop_not_triggered", fillReferencePrice: null, queueLimited: false }
}

function provisionalShell(input: ReplayPendingOrderResolutionInput): Omit<ReplayPendingOrderResolution, "outcome" | "resolution_status" | "limitations" | "resolution_hash"> {
  return {
    schema_version: REPLAY_PENDING_ORDER_RESOLUTION_SCHEMA_VERSION,
    order: structuredClone(input.order),
    observation: structuredClone(input.observation),
    cancel_effective_key: input.cancel_effective_key ? structuredClone(input.cancel_effective_key) : null,
  }
}

function finish(
  shell: ReturnType<typeof provisionalShell>,
  outcome: ReplayPendingOrderResolution["outcome"],
  limitations: ReplayPendingOrderResolution["limitations"],
): ReplayPendingOrderResolution {
  const body: Omit<ReplayPendingOrderResolution, "resolution_hash"> = {
    ...shell,
    outcome,
    resolution_status: limitations.length > 0 ? "resolution_limited" : "exact_under_ohlc",
    limitations,
  }
  const result = { ...body, resolution_hash: replayPendingOrderResolutionHash(body) }
  assertReplayPendingOrderResolution(result)
  return result
}

function sameEventOrdinal(left: ReplayEventKey, right: ReplayEventKey): boolean {
  return left.event_time === right.event_time
    && left.boundary_phase === right.boundary_phase
    && left.source_sequence === right.source_sequence
    && left.event_subphase === right.event_subphase
}
