import { canonicalHash, type ReplayFundingEvent } from "./replay-contracts"
import { addReplayDecimalValues, quantizeReplayProduct } from "./replay-decimal"
import {
  assertReplayRuntimeSharedWalletLifecycleEvent,
  type ReplayRuntimeSharedWalletLifecycleClosedPosition,
  type ReplayRuntimeSharedWalletLifecycleEntryEvent,
  type ReplayRuntimeSharedWalletLifecycleExitEvent,
  type ReplayRuntimeSharedWalletLifecyclePosition,
} from "./replay-runtime-shared-wallet-lifecycle-contracts"
import type {
  ReplayRuntimeSharedWalletAuthorityBinding,
  ReplayRuntimeSharedWalletSnapshot,
} from "./replay-runtime-shared-wallet-contracts"

export const REPLAY_RUNTIME_SHARED_WALLET_FUNDING_PLAN_SCHEMA_VERSION =
  "trade.rd-replay-runtime-shared-wallet-funding-plan.v1" as const
export const REPLAY_RUNTIME_SHARED_WALLET_FUNDING_RESULT_SCHEMA_VERSION =
  "trade.rd-replay-runtime-shared-wallet-funding-result.v1" as const
export const REPLAY_RUNTIME_SHARED_WALLET_FUNDING_OUTCOME_SCHEMA_VERSION =
  "trade.rd-replay-runtime-shared-wallet-funding-outcome.v1" as const

export interface ReplayRuntimeSharedWalletFundingPlan {
  schema_version: typeof REPLAY_RUNTIME_SHARED_WALLET_FUNDING_PLAN_SCHEMA_VERSION
  portfolio_id: string
  execution_mode: "runtime_shared_wallet_entry_exit_exact_funding_v1"
  capital_semantics: "single_runtime_wallet_event_committed_funding_cash_reuse"
  matching_scope: "market_next_open_full_fill"
  margin_scope: "isolated_positions_shared_admission_cash"
  funding_scope: "frozen_exact_events_t_minus_position"
  same_time_cash_policy: "funding_before_exit_before_entry_then_control_plane_priority"
  failure_policy: "engine_failure_no_partial_portfolio_result"
  lanes: Array<{
    lane_id: string
    symbol: string
    run_id: string
    request_hash: string
    trial_reservation_hash: string
    attempt_lease_hash: string
    scheduled_exit_time: string | null
    exit_intent_hash: string | null
    settlement_increment: string
    funding_event_count: number
    funding_events_hash: string
  }>
  plan_hash: string
}

export interface ReplayRuntimeSharedWalletFundingEvent {
  event_hash: string
  queue_ordinal: number
  event_time: string
  boundary_phase: 10
  source_kind: "funding"
  event_role: "funding"
  event_role_rank: 0
  lane_id: string
  symbol: string
  priority_rank: number
  request_hash: string
  funding_event_index: number
  funding_event_hash: string
  rate: number
  mark_price: number
  position_side: "long" | "short" | null
  quantity: number
  funding_cashflow: number
  outcome: "applied" | "not_reached"
  outcome_reason: "position_open_t_minus" | "no_open_position_t_minus"
  wallet_before: ReplayRuntimeSharedWalletSnapshot
  wallet_after: ReplayRuntimeSharedWalletSnapshot
}

export type ReplayRuntimeSharedWalletFundingQueueEvent =
  | ReplayRuntimeSharedWalletLifecycleEntryEvent
  | ReplayRuntimeSharedWalletLifecycleExitEvent
  | ReplayRuntimeSharedWalletFundingEvent

export interface ReplayRuntimeSharedWalletFundingResult {
  schema_version: typeof REPLAY_RUNTIME_SHARED_WALLET_FUNDING_RESULT_SCHEMA_VERSION
  portfolio_id: string
  portfolio_plan_hash: string
  funding_reservation_hash: string
  execution_mode: "runtime_shared_wallet_entry_exit_exact_funding_v1"
  settlement_asset: string
  shared_initial_cash: number
  global_source_event_queue: ReplayRuntimeSharedWalletFundingQueueEvent[]
  open_positions: ReplayRuntimeSharedWalletLifecyclePosition[]
  closed_positions: ReplayRuntimeSharedWalletLifecycleClosedPosition[]
  rejected_lane_ids: string[]
  total_entry_fees: number
  total_exit_fees: number
  total_realized_pnl: number
  total_funding_cashflow: number
  ending_settled_cash: number
  ending_reserved_isolated_collateral: number
  ending_available_cash: number
  portfolio_nav_at_entry_marks: number
  limitations: [
    "market_next_open_entry_full_exit_and_exact_funding_only",
    "no_liquidation_partial_position_cross_margin_or_borrow",
    "open_positions_marked_at_entry_price",
  ]
  result_hash: string
}

export interface ReplayRuntimeSharedWalletFundingOutcome {
  schema_version: typeof REPLAY_RUNTIME_SHARED_WALLET_FUNDING_OUTCOME_SCHEMA_VERSION
  portfolio_id: string
  portfolio_plan_hash: string
  funding_reservation_hash: string
  status: "completed" | "failed"
  result: ReplayRuntimeSharedWalletFundingResult | null
  failure: {
    code: "runtime-shared-wallet-funding-input-invalid" | "runtime-shared-wallet-funding-engine-failed"
    message: string
    partial_result_published: false
  } | null
  outcome_hash: string
}

export function replayRuntimeSharedWalletFundingPlanHash(
  value: Omit<ReplayRuntimeSharedWalletFundingPlan, "plan_hash"> | ReplayRuntimeSharedWalletFundingPlan,
): string {
  const { plan_hash: _hash, ...body } = value as ReplayRuntimeSharedWalletFundingPlan
  return canonicalHash(body)
}

export function replayRuntimeSharedWalletFundingEventHash(
  value: Omit<ReplayRuntimeSharedWalletFundingEvent, "event_hash"> | ReplayRuntimeSharedWalletFundingEvent,
): string {
  const { event_hash: _hash, ...body } = value as ReplayRuntimeSharedWalletFundingEvent
  return canonicalHash(body)
}

export function replayRuntimeSharedWalletFundingResultHash(
  value: Omit<ReplayRuntimeSharedWalletFundingResult, "result_hash"> | ReplayRuntimeSharedWalletFundingResult,
): string {
  const { result_hash: _hash, ...body } = value as ReplayRuntimeSharedWalletFundingResult
  return canonicalHash(body)
}

export function replayRuntimeSharedWalletFundingOutcomeHash(
  value: Omit<ReplayRuntimeSharedWalletFundingOutcome, "outcome_hash"> | ReplayRuntimeSharedWalletFundingOutcome,
): string {
  const { outcome_hash: _hash, ...body } = value as ReplayRuntimeSharedWalletFundingOutcome
  return canonicalHash(body)
}

export function assertReplayRuntimeSharedWalletFundingPlan(value: ReplayRuntimeSharedWalletFundingPlan): void {
  exact(value, [
    "schema_version", "portfolio_id", "execution_mode", "capital_semantics", "matching_scope", "margin_scope",
    "funding_scope", "same_time_cash_policy", "failure_policy", "lanes", "plan_hash",
  ], "Plan")
  if (value.schema_version !== REPLAY_RUNTIME_SHARED_WALLET_FUNDING_PLAN_SCHEMA_VERSION
      || value.execution_mode !== "runtime_shared_wallet_entry_exit_exact_funding_v1"
      || value.capital_semantics !== "single_runtime_wallet_event_committed_funding_cash_reuse"
      || value.matching_scope !== "market_next_open_full_fill"
      || value.margin_scope !== "isolated_positions_shared_admission_cash"
      || value.funding_scope !== "frozen_exact_events_t_minus_position"
      || value.same_time_cash_policy !== "funding_before_exit_before_entry_then_control_plane_priority"
      || value.failure_policy !== "engine_failure_no_partial_portfolio_result") {
    throw new Error("runtime shared wallet funding Plan policy is unsupported")
  }
  required(value.portfolio_id, "portfolio_id")
  if (value.lanes.length < 2) throw new Error("runtime shared wallet funding Plan requires at least two lanes")
  let previous = ""
  let exits = 0
  let funding = 0
  const symbols = new Set<string>()
  const runs = new Set<string>()
  for (const lane of value.lanes) {
    exact(lane, [
      "lane_id", "symbol", "run_id", "request_hash", "trial_reservation_hash", "attempt_lease_hash",
      "scheduled_exit_time", "exit_intent_hash", "settlement_increment", "funding_event_count",
      "funding_events_hash",
    ], "Plan lane")
    required(lane.lane_id, "lane_id")
    required(lane.symbol, "symbol")
    required(lane.run_id, "run_id")
    digest(lane.request_hash, "request_hash")
    digest(lane.trial_reservation_hash, "trial_reservation_hash")
    digest(lane.attempt_lease_hash, "attempt_lease_hash")
    digest(lane.funding_events_hash, "funding_events_hash")
    decimalIncrement(lane.settlement_increment)
    if (!Number.isSafeInteger(lane.funding_event_count) || lane.funding_event_count < 0) {
      throw new Error("runtime shared wallet funding event count is invalid")
    }
    if ((lane.scheduled_exit_time === null) !== (lane.exit_intent_hash === null)) {
      throw new Error("runtime shared wallet funding exit time and intent hash must be jointly present")
    }
    if (lane.scheduled_exit_time !== null) {
      timestamp(lane.scheduled_exit_time, "scheduled_exit_time")
      digest(lane.exit_intent_hash!, "exit_intent_hash")
      exits += 1
    }
    if (lane.lane_id <= previous || symbols.has(lane.symbol) || runs.has(lane.run_id)) {
      throw new Error("runtime shared wallet funding Plan lanes require canonical unique identities")
    }
    previous = lane.lane_id
    symbols.add(lane.symbol)
    runs.add(lane.run_id)
    funding += lane.funding_event_count
  }
  if (exits < 1 || funding < 1) {
    throw new Error("runtime shared wallet funding Plan requires a frozen full exit and exact funding event")
  }
  digest(value.plan_hash, "plan_hash")
  if (value.plan_hash !== replayRuntimeSharedWalletFundingPlanHash(value)) {
    throw new Error("runtime shared wallet funding Plan hash mismatch")
  }
}

export function assertReplayRuntimeSharedWalletFundingOutcome(
  value: ReplayRuntimeSharedWalletFundingOutcome,
  plan: ReplayRuntimeSharedWalletFundingPlan,
  authority: ReplayRuntimeSharedWalletAuthorityBinding,
): void {
  exact(value, [
    "schema_version", "portfolio_id", "portfolio_plan_hash", "funding_reservation_hash", "status",
    "result", "failure", "outcome_hash",
  ], "Outcome")
  if (value.schema_version !== REPLAY_RUNTIME_SHARED_WALLET_FUNDING_OUTCOME_SCHEMA_VERSION
      || value.portfolio_id !== plan.portfolio_id || value.portfolio_plan_hash !== plan.plan_hash
      || value.funding_reservation_hash !== authority.reservation_hash) {
    throw new Error("runtime shared wallet funding Outcome authority binding is invalid")
  }
  if (value.status === "completed") {
    if (!value.result || value.failure !== null) throw new Error("completed funding Outcome requires Result")
    assertReplayRuntimeSharedWalletFundingResult(value.result, plan, authority)
  } else {
    if (value.result !== null || !value.failure || value.failure.partial_result_published !== false) {
      throw new Error("failed funding Outcome cannot publish partial Result")
    }
    exact(value.failure, ["code", "message", "partial_result_published"], "Outcome failure")
    if (!["runtime-shared-wallet-funding-input-invalid", "runtime-shared-wallet-funding-engine-failed"]
      .includes(value.failure.code)) throw new Error("failed funding Outcome code is unsupported")
    required(value.failure.message, "failure.message")
  }
  digest(value.outcome_hash, "outcome_hash")
  if (value.outcome_hash !== replayRuntimeSharedWalletFundingOutcomeHash(value)) {
    throw new Error("runtime shared wallet funding Outcome hash mismatch")
  }
}

export function assertReplayRuntimeSharedWalletFundingResult(
  value: ReplayRuntimeSharedWalletFundingResult,
  plan: ReplayRuntimeSharedWalletFundingPlan,
  authority: ReplayRuntimeSharedWalletAuthorityBinding,
): void {
  assertReplayRuntimeSharedWalletFundingPlan(plan)
  exact(value, [
    "schema_version", "portfolio_id", "portfolio_plan_hash", "funding_reservation_hash", "execution_mode",
    "settlement_asset", "shared_initial_cash", "global_source_event_queue", "open_positions", "closed_positions",
    "rejected_lane_ids", "total_entry_fees", "total_exit_fees", "total_realized_pnl",
    "total_funding_cashflow", "ending_settled_cash", "ending_reserved_isolated_collateral",
    "ending_available_cash", "portfolio_nav_at_entry_marks", "limitations", "result_hash",
  ], "Result")
  if (value.schema_version !== REPLAY_RUNTIME_SHARED_WALLET_FUNDING_RESULT_SCHEMA_VERSION
      || value.portfolio_id !== plan.portfolio_id || value.portfolio_id !== authority.portfolio_id
      || value.portfolio_plan_hash !== plan.plan_hash || value.portfolio_plan_hash !== authority.portfolio_plan_hash
      || value.funding_reservation_hash !== authority.reservation_hash
      || value.execution_mode !== "runtime_shared_wallet_entry_exit_exact_funding_v1"
      || value.settlement_asset !== authority.settlement_asset
      || value.shared_initial_cash !== authority.shared_initial_cash) {
    throw new Error("runtime shared wallet funding Result authority binding is invalid")
  }
  const expectedCount = plan.lanes.length
    + plan.lanes.filter((lane) => lane.scheduled_exit_time !== null).length
    + plan.lanes.reduce((total, lane) => total + lane.funding_event_count, 0)
  if (value.global_source_event_queue.length !== expectedCount) {
    throw new Error("runtime shared wallet funding Result event coverage is incomplete")
  }
  const planByLane = new Map(plan.lanes.map((lane) => [lane.lane_id, lane]))
  const rank = new Map(authority.lanes.map((lane) => [lane.lane_id, lane.priority_rank]))
  const positions = new Map<string, ReplayRuntimeSharedWalletLifecyclePosition & { entry_fee: number }>()
  const closed: ReplayRuntimeSharedWalletLifecycleClosedPosition[] = []
  const rejected: string[] = []
  const fundingByLane = new Map<string, ReplayFundingEvent[]>()
  let walletValue: ReplayRuntimeSharedWalletSnapshot = {
    settled_cash: value.shared_initial_cash,
    reserved_isolated_collateral: 0,
    available_cash: value.shared_initial_cash,
  }
  let entryFees = 0
  let exitFees = 0
  let realized = 0
  let fundingCashflow = 0
  let previousTime = Number.NEGATIVE_INFINITY
  let previousRole = -1
  let previousPriority = -1
  for (const [index, event] of value.global_source_event_queue.entries()) {
    const lane = planByLane.get(event.lane_id)
    if (!lane || event.queue_ordinal !== index + 1 || event.symbol !== lane.symbol
        || event.request_hash !== lane.request_hash || event.priority_rank !== rank.get(event.lane_id)) {
      throw new Error("runtime shared wallet funding event authority drift")
    }
    const time = Date.parse(event.event_time)
    const role = event.event_role_rank
    if (time < previousTime || (time === previousTime && (role < previousRole
        || (role === previousRole && event.priority_rank <= previousPriority)))) {
      throw new Error("runtime shared wallet funding global queue order drift")
    }
    previousTime = time
    previousRole = role
    previousPriority = event.priority_rank
    if (JSON.stringify(event.wallet_before) !== JSON.stringify(walletValue)) {
      throw new Error("runtime shared wallet funding cash chain is discontinuous")
    }
    if (event.event_role === "funding") {
      assertReplayRuntimeSharedWalletFundingEvent(event, lane, positions.get(event.lane_id))
      const events = fundingByLane.get(event.lane_id) ?? []
      if (event.funding_event_index !== events.length) {
        throw new Error("runtime shared wallet funding lane event sequence drift")
      }
      events.push({ timestamp: event.event_time, rate: event.rate, mark_price: event.mark_price })
      fundingByLane.set(event.lane_id, events)
      if (event.outcome === "applied") fundingCashflow = addReplayDecimalValues(fundingCashflow, event.funding_cashflow)
    } else {
      assertReplayRuntimeSharedWalletLifecycleEvent(event, value.portfolio_id)
      if (event.event_role === "entry") {
        if (event.outcome === "filled") {
          positions.set(event.lane_id, {
            lane_id: event.lane_id, symbol: event.symbol, side: event.position_side, quantity: event.quantity,
            entry_price: event.execution_price, isolated_collateral: event.isolated_collateral,
            entry_fill_hash: event.fill_hash!, entry_fee: event.fee,
          })
          entryFees = addReplayDecimalValues(entryFees, event.fee)
        } else rejected.push(event.lane_id)
      } else if (event.outcome === "filled") {
        const position = positions.get(event.lane_id)
        if (!position || event.quantity !== position.quantity || event.position_side !== position.side
            || event.isolated_collateral !== position.isolated_collateral) {
          throw new Error("runtime shared wallet funding exit does not bind an open Position")
        }
        closed.push({
          lane_id: position.lane_id, symbol: position.symbol, side: position.side, quantity: position.quantity,
          entry_price: position.entry_price, isolated_collateral: position.isolated_collateral,
          entry_fill_hash: position.entry_fill_hash, exit_price: event.execution_price,
          exit_fill_hash: event.fill_hash!, realized_pnl: event.realized_pnl,
          entry_fee: position.entry_fee, exit_fee: event.fee,
        })
        positions.delete(event.lane_id)
        exitFees = addReplayDecimalValues(exitFees, event.fee)
        realized = addReplayDecimalValues(realized, event.realized_pnl)
      } else if (positions.has(event.lane_id)) {
        throw new Error("runtime shared wallet funding reached exit cannot remain not_reached")
      }
    }
    walletValue = event.wallet_after
  }
  for (const lane of plan.lanes) {
    const events = fundingByLane.get(lane.lane_id) ?? []
    if (events.length !== lane.funding_event_count || canonicalHash(events) !== lane.funding_events_hash) {
      throw new Error("runtime shared wallet funding Result does not bind the frozen funding events")
    }
  }
  const open = [...positions.values()].map(({ entry_fee: _fee, ...position }) => position)
  const endingSettled = addReplayDecimalValues(
    value.shared_initial_cash, realized, fundingCashflow, -entryFees, -exitFees,
  )
  const endingReserved = sum(open.map((position) => position.isolated_collateral))
  const endingAvailable = addReplayDecimalValues(endingSettled, -endingReserved)
  if (JSON.stringify(value.open_positions) !== JSON.stringify(open)
      || JSON.stringify(value.closed_positions) !== JSON.stringify(closed)
      || JSON.stringify(value.rejected_lane_ids) !== JSON.stringify(rejected)
      || value.total_entry_fees !== entryFees || value.total_exit_fees !== exitFees
      || value.total_realized_pnl !== realized || value.total_funding_cashflow !== fundingCashflow
      || value.ending_settled_cash !== endingSettled || value.ending_reserved_isolated_collateral !== endingReserved
      || value.ending_available_cash !== endingAvailable || value.portfolio_nav_at_entry_marks !== endingSettled
      || JSON.stringify(walletValue) !== JSON.stringify({
        settled_cash: endingSettled, reserved_isolated_collateral: endingReserved, available_cash: endingAvailable,
      })) {
    throw new Error("runtime shared wallet funding Result capital conservation failed")
  }
  const limitations: ReplayRuntimeSharedWalletFundingResult["limitations"] = [
    "market_next_open_entry_full_exit_and_exact_funding_only",
    "no_liquidation_partial_position_cross_margin_or_borrow",
    "open_positions_marked_at_entry_price",
  ]
  if (JSON.stringify(value.limitations) !== JSON.stringify(limitations)) {
    throw new Error("runtime shared wallet funding Result limitations were weakened")
  }
  digest(value.result_hash, "result_hash")
  if (value.result_hash !== replayRuntimeSharedWalletFundingResultHash(value)) {
    throw new Error("runtime shared wallet funding Result hash mismatch")
  }
}

export function assertReplayRuntimeSharedWalletFundingEvent(
  event: ReplayRuntimeSharedWalletFundingEvent,
  lane: ReplayRuntimeSharedWalletFundingPlan["lanes"][number],
  position: (ReplayRuntimeSharedWalletLifecyclePosition & { entry_fee: number }) | undefined,
): void {
  exact(event, [
    "event_hash", "queue_ordinal", "event_time", "boundary_phase", "source_kind", "event_role",
    "event_role_rank", "lane_id", "symbol", "priority_rank", "request_hash", "funding_event_index",
    "funding_event_hash", "rate", "mark_price", "position_side", "quantity", "funding_cashflow",
    "outcome", "outcome_reason", "wallet_before", "wallet_after",
  ], "funding event")
  timestamp(event.event_time, "funding.event_time")
  digest(event.funding_event_hash, "funding_event_hash")
  wallet(event.wallet_before)
  wallet(event.wallet_after)
  if (event.boundary_phase !== 10 || event.source_kind !== "funding" || event.event_role_rank !== 0
      || !Number.isSafeInteger(event.funding_event_index) || event.funding_event_index < 0
      || !Number.isFinite(event.rate) || !Number.isFinite(event.mark_price) || event.mark_price <= 0
      || event.funding_event_hash !== canonicalHash({
        timestamp: event.event_time, rate: event.rate, mark_price: event.mark_price,
      })) throw new Error("runtime shared wallet funding event fact is invalid")
  const expectedEventHash = replayRuntimeSharedWalletFundingEventHash(event)
  if (event.event_hash !== expectedEventHash) throw new Error("runtime shared wallet funding event hash mismatch")
  if (position) {
    const expectedCashflow = quantizeReplayProduct(
      [event.mark_price, position.quantity, event.rate, position.side === "long" ? -1 : 1],
      1, lane.settlement_increment, "floor",
    )
    if (event.outcome !== "applied" || event.outcome_reason !== "position_open_t_minus"
        || event.position_side !== position.side || event.quantity !== position.quantity
        || event.funding_cashflow !== expectedCashflow
        || event.wallet_after.settled_cash !== addReplayDecimalValues(event.wallet_before.settled_cash, expectedCashflow)
        || event.wallet_after.reserved_isolated_collateral !== event.wallet_before.reserved_isolated_collateral
        || event.wallet_after.available_cash !== addReplayDecimalValues(event.wallet_before.available_cash, expectedCashflow)) {
      throw new Error("runtime shared wallet funding applied event economics are invalid")
    }
  } else if (event.outcome !== "not_reached" || event.outcome_reason !== "no_open_position_t_minus"
      || event.position_side !== null || event.quantity !== 0 || event.funding_cashflow !== 0
      || JSON.stringify(event.wallet_after) !== JSON.stringify(event.wallet_before)) {
    throw new Error("runtime shared wallet funding not-reached event mutated cash")
  }
}

function wallet(value: ReplayRuntimeSharedWalletSnapshot): void {
  exact(value, ["settled_cash", "reserved_isolated_collateral", "available_cash"], "wallet")
  for (const amount of Object.values(value)) {
    if (!Number.isFinite(amount) || amount < 0) throw new Error("runtime shared wallet funding wallet is invalid")
  }
  if (value.available_cash !== addReplayDecimalValues(value.settled_cash, -value.reserved_isolated_collateral)) {
    throw new Error("runtime shared wallet funding wallet does not reconcile")
  }
}

function exact(value: object, fields: string[], label: string): void {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...fields].sort())) {
    throw new Error(`runtime shared wallet funding ${label} fields are not exact`)
  }
}
function required(value: string, field: string): void {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`runtime shared wallet funding ${field} is required`)
}
function digest(value: string, field: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`runtime shared wallet funding ${field} must be a hash`)
}
function timestamp(value: string, field: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
      || !Number.isFinite(Date.parse(value))) throw new Error(`runtime shared wallet funding ${field} must be UTC time`)
}
function decimalIncrement(value: string): void {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) || Number(value) <= 0) {
    throw new Error("runtime shared wallet funding settlement_increment is invalid")
  }
}
function sum(values: number[]): number {
  return values.reduce((total, value) => addReplayDecimalValues(total, value), 0)
}
