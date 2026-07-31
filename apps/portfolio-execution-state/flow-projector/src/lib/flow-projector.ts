import { Database } from "bun:sqlite"
import {
  asRecord,
  compactRecord,
  normalizeZero,
  numberField,
  numberOrUndefined,
  stringField,
  type JSONRecord,
} from "../../../../contracts/runtime-core/src/json"
import { canonicalHash } from "../../../../contracts/runtime-core/src/canonical-json"
import { appendPlanEvent, listChainIds, readFlowEvents, type PlanEvent } from "../../../event-store/src/lib/event-store"

export const FLOW_POSITION_STATES = ["flat", "long", "short"] as const

export interface ActiveFlowSummary {
  chain_id: string
  symbol: string
  event_count: number
  lane_key: string
  latest_observe_event_key: string
  latest_slow_observe_event_key: string
  current_action_intent: JSONRecord
  current_orders_count: number
  current_position_state: string
  open_action_gap: JSONRecord
}

export interface PortfolioAccountProjectionInput {
  account_ref: string
  account_scope: string
  symbol?: string
  as_of?: string
}

export function buildPortfolioAccountProjection(db: Database, input: PortfolioAccountProjectionInput): JSONRecord {
  if (!input.account_ref || !input.account_scope) {
    throw new Error("portfolio account projection requires account_ref and account_scope")
  }
  const computedAt = input.as_of || new Date().toISOString()
  if (!Number.isFinite(Date.parse(computedAt))) {
    throw new Error("portfolio account projection as_of must be a valid timestamp")
  }
  const targetSymbol = stringField(input.symbol).toUpperCase()
  const warnings: string[] = []
  let sourceEventCount = 0
  let activePlansRisk = 0
  let currentOpenRisk = 0
  let realizedPnlToday = 0
  let worstLossAtStop = 0
  let activeRiskFlowCount = 0
  let grossNotional = 0
  let symbolNotional = 0
  let laneNotional = 0
  let openActionsThisCycle = 0
  let recentOpenActions1h = 0
  let currentLanePositionState = "flat"
  let latestEventAt = ""
  const locks: JSONRecord[] = []
  const flowRefs: string[] = []

  for (const chainId of listChainIds(db)) {
    const events = readFlowEvents(db, chainId)
    sourceEventCount += events.length
    if (events.length === 0) continue
    const state = reduceFlowState(db, chainId)
    const latestObserve = latestEventOfKind(events, "observe")
    const latestReview = latestEventOfKind(events, "review")
    const observe = asRecord(latestObserve?.body_json)
    const account = asRecord(observe.account)
    const observedAccountRef = stringField(account.account_ref)
    const observedScope = stringField(account.account_scope)
    const flowSymbol = stringField(observe.symbol).toUpperCase()
    const riskBudget = numberField(observe.risk_budget_usdt)
    const position = asRecord(state.current_position)
    const netQty = numberField(position.net_qty)
    const avgEntryPrice = numberField(position.avg_entry_price)
    const notional = Math.abs(netQty * avgEntryPrice)
    const currentOrders = Array.isArray(state.current_orders) ? state.current_orders : []
    const riskLock = asRecord(state.risk_lock)
    const isClosed = Boolean(latestReview) && netQty === 0 && currentOrders.length === 0
    latestEventAt = maxTimestamp(latestEventAt, events[events.length - 1]?.created_at || "")

    if (observedAccountRef && observedAccountRef !== input.account_ref) continue
    if (observedScope && observedScope !== input.account_scope) continue
    if (!observedAccountRef || !observedScope) {
      warnings.push(`flow ${chainId} has no canonical account_ref/account_scope binding`)
    }
    flowRefs.push(`trade_event_store:chain/${chainId}`)

    if (riskLock.locked === true) {
      locks.push({ chain_id: chainId, ...riskLock })
    }
    if (!isClosed) {
      activeRiskFlowCount += riskBudget > 0 || netQty !== 0 || currentOrders.length > 0 ? 1 : 0
      if (riskBudget <= 0 && (netQty !== 0 || currentOrders.length > 0)) {
        warnings.push(`active flow ${chainId} has no positive risk_budget_usdt`)
      }
      if (netQty === 0) activePlansRisk += riskBudget
      else currentOpenRisk += riskBudget
      worstLossAtStop -= riskBudget
    }

    grossNotional += notional
    if (targetSymbol && flowSymbol === targetSymbol) {
      symbolNotional += notional
      laneNotional += notional
      currentLanePositionState = stringField(position.state) || "flat"
    }
    if (latestReview) {
      realizedPnlToday += reviewPnlForDay(latestReview, computedAt)
    }
    for (const event of events) {
      if (event.kind !== "order_fill") continue
      const body = event.body_json
      const isOpenAction = stringField(body.sub_kind) === "submit" || stringField(body.lifecycle_status) === "submitted"
      if (!isOpenAction) continue
      openActionsThisCycle += 1
      if (ageMilliseconds(event.created_at, computedAt) <= 60 * 60 * 1000) recentOpenActions1h += 1
    }
  }

  const body = {
    schema_version: "trade.state.portfolio-account-projection.v1",
    account_ref: input.account_ref,
    account_scope: input.account_scope,
    target_symbol: targetSymbol || undefined,
    computed_at: computedAt,
    as_of: latestEventAt || computedAt,
    source_event_count: sourceEventCount,
    source_flow_refs: flowRefs,
    completeness: warnings.length === 0 ? "complete" : "incomplete",
    warnings,
    risk_lock: {
      locked: locks.length > 0,
      reasons: locks,
    },
    active_plans_risk_sum: roundMoney(activePlansRisk),
    current_account_open_risk_usdt: roundMoney(currentOpenRisk),
    realized_pnl_today_usdt: roundMoney(realizedPnlToday),
    active_plans_worst_loss_at_stop: roundMoney(worstLossAtStop),
    active_risk_flow_count: activeRiskFlowCount,
    current_gross_notional_usdt: roundMoney(grossNotional),
    current_symbol_notional_usdt: roundMoney(symbolNotional),
    current_lane_notional_usdt: roundMoney(laneNotional),
    current_lane_position_state: currentLanePositionState,
    open_actions_this_cycle: openActionsThisCycle,
    recent_open_actions_1h: recentOpenActions1h,
    reconcile_status: locks.length > 0 ? "blocked" : "consistent",
  }
  const contentHash = `sha256:${canonicalHash(body)}`
  return {
    ...body,
    content_hash: contentHash,
    projection_ref: `flow-read-models://portfolio-account/${encodeURIComponent(input.account_scope)}/${contentHash.slice(7)}`,
  }
}

export function reduceFlowState(db: Database, chainId: string): JSONRecord {
  const events = readFlowEvents(db, chainId)
  return reduceFlowEvents(chainId, events)
}

function reduceFlowEvents(chainId: string, events: PlanEvent[]): JSONRecord {
  const orders = new Map<string, JSONRecord>()
  const cumulativeFills = new Map<string, number>()
  const position = {
    symbol: "",
    position_side: "",
    net_qty: 0,
    avg_entry_price: 0,
    state: "flat",
  }
  let latestObserve: PlanEvent | null = null
  let latestOrderFill: PlanEvent | null = null
  let riskLock: JSONRecord = {
    locked: false,
  }

  for (const event of events) {
    if (event.kind === "observe") {
      latestObserve = event
      continue
    }
    if (event.kind === "review") {
      riskLock = updateReviewRiskLock(riskLock, event)
      continue
    }
    if (event.kind !== "order_fill") {
      continue
    }
    latestOrderFill = event
    riskLock = updateRiskLock(riskLock, event)
    reduceOrderFill(event.body_json, orders, position, cumulativeFills)
  }

  return {
    chain_id: chainId,
    event_count: events.length,
    latest_observe: latestObserve,
    latest_order_fill: latestOrderFill,
    current_orders: Array.from(orders.values()),
    current_position: {
      ...position,
      net_qty: normalizeZero(position.net_qty),
      avg_entry_price: normalizeZero(position.avg_entry_price),
      state: position.net_qty > 0 ? "long" : position.net_qty < 0 ? "short" : "flat",
    },
    risk_lock: riskLock,
    open_action_gap: detectOpenActionGap(latestObserve, events),
  }
}

export function listActiveFlows(db: Database): ActiveFlowSummary[] {
  return readActiveChainIds(db)
    .map((chainId) => {
      const events = readFlowEvents(db, chainId)
      return summarizeActiveFlow(chainId, events)
    })
    .filter((flow) => flow.latest_observe_event_key)
}

export function findActiveLaneConflicts(flows: ActiveFlowSummary[]): Array<{ lane_key: string; chain_ids: string[] }> {
  const byLane = new Map<string, string[]>()
  for (const flow of flows) {
    if (!flow.lane_key) {
      continue
    }
    byLane.set(flow.lane_key, [...(byLane.get(flow.lane_key) ?? []), flow.chain_id])
  }
  return Array.from(byLane.entries())
    .filter(([, chainIds]) => chainIds.length > 1)
    .map(([lane_key, chain_ids]) => ({ lane_key, chain_ids }))
}

export function laneKeyFromObserve(body: JSONRecord): string {
  const strategy = stringField(body.strategy_ref)
  const symbol = stringField(body.symbol).toUpperCase()
  const side = stringField(body.side)
  return [strategy, symbol, side].filter(Boolean).join("|")
}

export function latestSlowObserve(events: PlanEvent[]): PlanEvent | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event.kind === "observe" && stringField(event.body_json.source) === "slow_track") {
      return event
    }
  }
  return null
}

export function readLatestSlowObserve(db: Database, chainId: string): PlanEvent | null {
  return latestSlowObserve(readFlowEvents(db, chainId))
}

export function applyReconcileDrafts(db: Database, input: JSONRecord, yes: boolean): JSONRecord {
  if (!yes) {
    throw new Error("--apply-reconcile requires --yes")
  }
  if (input.can_reconcile !== true) {
    throw new Error("apply-reconcile requires can_reconcile=true")
  }
  const drafts = Array.isArray(input.drafts) ? input.drafts.map(asRecord) : []
  const applied: string[] = []
  for (const draft of drafts) {
    const event = draft as unknown as PlanEvent
    if (event.kind !== "order_fill" || stringField(asRecord(event.body_json).source) !== "reconcile") {
      throw new Error("apply-reconcile only accepts order_fill(source=reconcile) drafts")
    }
    appendPlanEvent(db, event)
    applied.push(event.event_key)
  }
  return {
    applied_count: applied.length,
    applied_event_keys: applied,
  }
}

function summarizeActiveFlow(chainId: string, events: PlanEvent[]): ActiveFlowSummary {
  const state = reduceFlowEvents(chainId, events)
  const latestObserve = asRecord(state.latest_observe) as unknown as PlanEvent | null
  const latestSlow = latestSlowObserve(events)
  const latestObserveBody = asRecord(latestObserve?.body_json)
  const position = asRecord(state.current_position)
  const observeSymbol = stringField(latestObserveBody.symbol).toUpperCase()
  const positionSymbol = stringField(position.symbol).toUpperCase()
  return {
    chain_id: chainId,
    symbol: positionSymbol || observeSymbol,
    event_count: events.length,
    lane_key: laneKeyFromObserve(latestObserveBody),
    latest_observe_event_key: stringField(latestObserve?.event_key),
    latest_slow_observe_event_key: stringField(latestSlow?.event_key),
    current_action_intent: asRecord(latestObserveBody.action_intent),
    current_orders_count: Array.isArray(state.current_orders) ? state.current_orders.length : 0,
    current_position_state: stringField(position.state) || "unknown",
    open_action_gap: asRecord(state.open_action_gap),
  }
}

function readActiveChainIds(db: Database): string[] {
  const rows = db.query(`
    SELECT DISTINCT candidate.chain_id
    FROM plan_event AS candidate
    WHERE NOT EXISTS (
      SELECT 1
      FROM plan_event AS review
      WHERE review.chain_id = candidate.chain_id
        AND review.kind = 'review'
    )
    ORDER BY candidate.chain_id
  `).all() as Array<{ chain_id: string }>
  return rows.map((row) => row.chain_id)
}

function reduceOrderFill(
  body: JSONRecord,
  orders: Map<string, JSONRecord>,
  position: { symbol: string; position_side: string; net_qty: number; avg_entry_price: number; state: string },
  cumulativeFills: Map<string, number>,
): void {
  const clientOrderId = stringField(body.client_order_id)
  const subKind = stringField(body.sub_kind)
  if (!clientOrderId) {
    return
  }

  const lifecycleStatus = normalizeLifecycleStatus(body)

  if (subKind === "submit" || subKind === "amend" || lifecycleStatus === "submitted" || lifecycleStatus === "accepted" || lifecycleStatus === "amended") {
    const qty = numberField(body.qty)
    const filledQty = numberField(body.filled_qty)
    orders.set(clientOrderId, compactRecord({
      client_order_id: clientOrderId,
      exchange_order_id: stringField(body.exchange_order_id),
      symbol: stringField(body.symbol),
      side: stringField(body.side),
      position_side: stringField(body.position_side),
      order_type: stringField(body.order_type),
      qty,
      price: numberOrUndefined(body.price),
      stop_price: numberOrUndefined(body.stop_price),
      remaining_qty: Math.max(qty - filledQty, 0),
    }))
    return
  }

  if (subKind === "cancel" || subKind === "reject" || subKind === "expire" || lifecycleStatus === "cancelled" || lifecycleStatus === "rejected" || lifecycleStatus === "expired") {
    orders.delete(clientOrderId)
    return
  }

  if (subKind === "partial_fill" || subKind === "fill" || lifecycleStatus === "partially_filled" || lifecycleStatus === "filled" || lifecycleStatus === "reconciled") {
    const fillQty = readFillDelta(body, clientOrderId, cumulativeFills)
    const avgFillPrice = numberField(body.avg_fill_price) || numberField(body.price)
    applyPositionFill(position, body, fillQty, avgFillPrice)
    const existing = orders.get(clientOrderId)
    if (existing) {
      const remaining = Math.max(numberField(existing.remaining_qty) - fillQty, 0)
      if (subKind === "fill" || remaining === 0) {
        orders.delete(clientOrderId)
      } else {
        orders.set(clientOrderId, {
          ...existing,
          remaining_qty: remaining,
        })
      }
    }
  }
}

function readFillDelta(body: JSONRecord, clientOrderId: string, cumulativeFills: Map<string, number>): number {
  const previous = cumulativeFills.get(clientOrderId) ?? 0
  if (Object.prototype.hasOwnProperty.call(body, "cumulative_filled_qty")) {
    const cumulative = Math.max(numberField(body.cumulative_filled_qty), 0)
    cumulativeFills.set(clientOrderId, Math.max(previous, cumulative))
    return Math.max(cumulative - previous, 0)
  }
  const delta = Object.prototype.hasOwnProperty.call(body, "fill_delta_qty")
    ? numberField(body.fill_delta_qty)
    : Object.prototype.hasOwnProperty.call(body, "filled_qty")
      ? numberField(body.filled_qty)
      : numberField(body.qty)
  cumulativeFills.set(clientOrderId, previous + Math.max(delta, 0))
  return Math.max(delta, 0)
}

function latestEventOfKind(events: PlanEvent[], kind: PlanEvent["kind"]): PlanEvent | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].kind === kind) return events[index]
  }
  return null
}

function reviewPnlForDay(review: PlanEvent, asOf: string): number {
  const reviewDay = review.created_at.slice(0, 10)
  const asOfDay = asOf.slice(0, 10)
  if (reviewDay !== asOfDay) return 0
  const body = review.body_json
  return numberField(body.realized_pnl_usdt) || numberField(body.pnl_usdt)
}

function maxTimestamp(left: string, right: string): string {
  if (!left) return right
  if (!right) return left
  return Date.parse(right) > Date.parse(left) ? right : left
}

function ageMilliseconds(earlier: string, later: string): number {
  const earlierMs = Date.parse(earlier)
  const laterMs = Date.parse(later)
  if (!Number.isFinite(earlierMs) || !Number.isFinite(laterMs)) return Number.POSITIVE_INFINITY
  return Math.max(0, laterMs - earlierMs)
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 1e8) / 1e8
}

function updateRiskLock(current: JSONRecord, event: PlanEvent): JSONRecord {
  const body = event.body_json
  const lifecycleStatus = normalizeLifecycleStatus(body)
  const subKind = stringField(body.sub_kind)
  if (lifecycleStatus === "unknown" || lifecycleStatus === "needs_review" || subKind === "unknown" || subKind === "needs_review") {
    return {
      locked: true,
      reason: lifecycleStatus === "needs_review" || subKind === "needs_review" ? "needs_review" : "unknown_order_state",
      event_key: event.event_key,
      client_order_id: stringField(body.client_order_id),
      lifecycle_status: lifecycleStatus || subKind,
    }
  }
  return current
}

function updateReviewRiskLock(current: JSONRecord, event: PlanEvent): JSONRecord {
  const body = event.body_json
  const lifecycleStatus = normalizeLifecycleStatus(body)
  const status = stringField(body.status)
  if (lifecycleStatus === "needs_review" || status === "needs_review") {
    return {
      locked: true,
      reason: "needs_review",
      event_key: event.event_key,
      lifecycle_status: "needs_review",
      review_reason: stringField(body.reason),
    }
  }
  return current
}

function normalizeLifecycleStatus(body: JSONRecord): string {
  const explicit = stringField(body.lifecycle_status)
  if (explicit) return explicit
  const subKind = stringField(body.sub_kind)
  if (subKind === "partial_fill") return "partially_filled"
  if (subKind === "fill") return "filled"
  if (subKind === "cancel") return "cancelled"
  if (subKind === "reject") return "rejected"
  if (subKind === "expire") return "expired"
  if (subKind === "submit") return "submitted"
  if (subKind === "amend") return "amended"
  return subKind
}

function applyPositionFill(
  position: { symbol: string; position_side: string; net_qty: number; avg_entry_price: number; state: string },
  body: JSONRecord,
  fillQty: number,
  avgFillPrice: number,
): void {
  if (fillQty <= 0) {
    return
  }
  const signedQty = stringField(body.side) === "SELL" ? -fillQty : fillQty
  const oldQty = position.net_qty
  const newQty = oldQty + signedQty
  position.symbol = stringField(body.symbol) || position.symbol
  position.position_side = stringField(body.position_side) || position.position_side

  if (oldQty === 0 || Math.sign(oldQty) === Math.sign(signedQty)) {
    const totalAbs = Math.abs(oldQty) + Math.abs(signedQty)
    position.avg_entry_price = totalAbs > 0
      ? ((Math.abs(oldQty) * position.avg_entry_price) + (Math.abs(signedQty) * avgFillPrice)) / totalAbs
      : 0
  } else if (newQty === 0) {
    position.avg_entry_price = 0
  } else if (Math.sign(newQty) !== Math.sign(oldQty)) {
    position.avg_entry_price = avgFillPrice
  }

  position.net_qty = newQty
}

function detectOpenActionGap(latestObserve: PlanEvent | null, events: PlanEvent[]): JSONRecord {
  if (!latestObserve) {
    return {
      exists: false,
      reason: "no_observe",
    }
  }
  const actionIntent = asRecord(latestObserve.body_json.action_intent)
  const targetAction = stringField(actionIntent.target_action) || "no_action"
  if (targetAction === "no_action") {
    return {
      exists: false,
      latest_observe_event_key: latestObserve.event_key,
      target_action: targetAction,
    }
  }
  const hasMatchingFill = events.some((event) => (
    event.kind === "order_fill"
    && stringField(event.body_json.source_observe_event_key) === latestObserve.event_key
  ))
  return {
    exists: !hasMatchingFill,
    latest_observe_event_key: latestObserve.event_key,
    target_action: targetAction,
    reason: hasMatchingFill ? "matched_order_fill" : "action_intent_without_order_fill",
  }
}
