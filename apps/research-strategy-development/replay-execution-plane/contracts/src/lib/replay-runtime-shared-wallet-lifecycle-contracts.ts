import { canonicalHash } from "./replay-contracts"
import { addReplayDecimalValues } from "./replay-decimal"
import type { ReplayRuntimeSharedWalletAuthorityBinding, ReplayRuntimeSharedWalletSnapshot } from "./replay-runtime-shared-wallet-contracts"

export const REPLAY_RUNTIME_SHARED_WALLET_LIFECYCLE_PLAN_SCHEMA_VERSION =
  "trade.rd-replay-runtime-shared-wallet-lifecycle-plan.v1" as const
export const REPLAY_RUNTIME_SHARED_WALLET_LIFECYCLE_RESULT_SCHEMA_VERSION =
  "trade.rd-replay-runtime-shared-wallet-lifecycle-result.v1" as const
export const REPLAY_RUNTIME_SHARED_WALLET_LIFECYCLE_OUTCOME_SCHEMA_VERSION =
  "trade.rd-replay-runtime-shared-wallet-lifecycle-outcome.v1" as const

export interface ReplayRuntimeSharedWalletLifecyclePlan {
  schema_version: typeof REPLAY_RUNTIME_SHARED_WALLET_LIFECYCLE_PLAN_SCHEMA_VERSION
  portfolio_id: string
  execution_mode: "runtime_shared_wallet_entry_exit_release_v1"
  capital_semantics: "single_runtime_wallet_event_committed_cash_reuse"
  matching_scope: "market_next_open_full_fill"
  margin_scope: "isolated_positions_shared_admission_cash"
  same_time_cash_policy: "exit_release_before_entry_admission_then_control_plane_priority"
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
  }>
  plan_hash: string
}

interface ReplayRuntimeSharedWalletLifecycleEventBase {
  event_hash: string
  queue_ordinal: number
  event_time: string
  boundary_phase: 20
  source_kind: "bar_open"
  lane_id: string
  symbol: string
  priority_rank: number
  request_hash: string
  bar_hash: string
  wallet_before: ReplayRuntimeSharedWalletSnapshot
  wallet_after: ReplayRuntimeSharedWalletSnapshot
}

export interface ReplayRuntimeSharedWalletLifecycleEntryEvent extends ReplayRuntimeSharedWalletLifecycleEventBase {
  event_role: "entry"
  event_role_rank: 2
  position_side: "long" | "short"
  execution_price: number
  quantity: number
  isolated_collateral: number
  fee: number
  required_available_cash: number
  outcome: "filled" | "rejected"
  outcome_reason: "cash_reserved_and_fill_committed" | "insufficient_available_cash"
  fill_hash: string | null
  realized_pnl: 0
  released_collateral: 0
}

export interface ReplayRuntimeSharedWalletLifecycleExitEvent extends ReplayRuntimeSharedWalletLifecycleEventBase {
  event_role: "exit"
  event_role_rank: 1
  position_side: "long" | "short"
  execution_price: number
  quantity: number
  isolated_collateral: number
  fee: number
  required_available_cash: 0
  outcome: "filled" | "not_reached"
  outcome_reason: "realized_pnl_fee_and_collateral_release_committed" | "entry_not_filled"
  fill_hash: string | null
  realized_pnl: number
  released_collateral: number
}

export type ReplayRuntimeSharedWalletLifecycleEvent =
  | ReplayRuntimeSharedWalletLifecycleEntryEvent
  | ReplayRuntimeSharedWalletLifecycleExitEvent

export type ReplayRuntimeSharedWalletLifecycleEventBody =
  | Omit<ReplayRuntimeSharedWalletLifecycleEntryEvent, "event_hash">
  | Omit<ReplayRuntimeSharedWalletLifecycleExitEvent, "event_hash">

export interface ReplayRuntimeSharedWalletLifecyclePosition {
  lane_id: string
  symbol: string
  side: "long" | "short"
  quantity: number
  entry_price: number
  isolated_collateral: number
  entry_fill_hash: string
}

export interface ReplayRuntimeSharedWalletLifecycleClosedPosition extends ReplayRuntimeSharedWalletLifecyclePosition {
  exit_price: number
  exit_fill_hash: string
  realized_pnl: number
  entry_fee: number
  exit_fee: number
}

export interface ReplayRuntimeSharedWalletLifecycleResult {
  schema_version: typeof REPLAY_RUNTIME_SHARED_WALLET_LIFECYCLE_RESULT_SCHEMA_VERSION
  portfolio_id: string
  portfolio_plan_hash: string
  lifecycle_reservation_hash: string
  execution_mode: "runtime_shared_wallet_entry_exit_release_v1"
  settlement_asset: string
  shared_initial_cash: number
  global_source_event_queue: ReplayRuntimeSharedWalletLifecycleEvent[]
  open_positions: ReplayRuntimeSharedWalletLifecyclePosition[]
  closed_positions: ReplayRuntimeSharedWalletLifecycleClosedPosition[]
  rejected_lane_ids: string[]
  total_entry_fees: number
  total_exit_fees: number
  total_realized_pnl: number
  ending_settled_cash: number
  ending_reserved_isolated_collateral: number
  ending_available_cash: number
  portfolio_nav_at_entry_marks: number
  limitations: [
    "market_next_open_entry_and_full_exit_only",
    "no_funding_liquidation_partial_position_or_cross_margin",
    "open_positions_marked_at_entry_price",
  ]
  result_hash: string
}

export interface ReplayRuntimeSharedWalletLifecycleOutcome {
  schema_version: typeof REPLAY_RUNTIME_SHARED_WALLET_LIFECYCLE_OUTCOME_SCHEMA_VERSION
  portfolio_id: string
  portfolio_plan_hash: string
  lifecycle_reservation_hash: string
  status: "completed" | "failed"
  result: ReplayRuntimeSharedWalletLifecycleResult | null
  failure: {
    code: "runtime-shared-wallet-lifecycle-input-invalid" | "runtime-shared-wallet-lifecycle-engine-failed"
    message: string
    partial_result_published: false
  } | null
  outcome_hash: string
}

export function replayRuntimeSharedWalletLifecyclePlanHash(
  value: Omit<ReplayRuntimeSharedWalletLifecyclePlan, "plan_hash"> | ReplayRuntimeSharedWalletLifecyclePlan,
): string {
  const { plan_hash: _hash, ...body } = value as ReplayRuntimeSharedWalletLifecyclePlan
  return canonicalHash(body)
}

export function replayRuntimeSharedWalletLifecycleEventHash(
  value: ReplayRuntimeSharedWalletLifecycleEventBody | ReplayRuntimeSharedWalletLifecycleEvent,
): string {
  const { event_hash: _hash, ...body } = value as ReplayRuntimeSharedWalletLifecycleEvent
  return canonicalHash(body)
}

export function replayRuntimeSharedWalletLifecycleResultHash(
  value: Omit<ReplayRuntimeSharedWalletLifecycleResult, "result_hash"> | ReplayRuntimeSharedWalletLifecycleResult,
): string {
  const { result_hash: _hash, ...body } = value as ReplayRuntimeSharedWalletLifecycleResult
  return canonicalHash(body)
}

export function replayRuntimeSharedWalletLifecycleOutcomeHash(
  value: Omit<ReplayRuntimeSharedWalletLifecycleOutcome, "outcome_hash"> | ReplayRuntimeSharedWalletLifecycleOutcome,
): string {
  const { outcome_hash: _hash, ...body } = value as ReplayRuntimeSharedWalletLifecycleOutcome
  return canonicalHash(body)
}

export function assertReplayRuntimeSharedWalletLifecyclePlan(value: ReplayRuntimeSharedWalletLifecyclePlan): void {
  exact(value, [
    "schema_version", "portfolio_id", "execution_mode", "capital_semantics", "matching_scope", "margin_scope",
    "same_time_cash_policy", "failure_policy", "lanes", "plan_hash",
  ], "Plan")
  if (value.schema_version !== REPLAY_RUNTIME_SHARED_WALLET_LIFECYCLE_PLAN_SCHEMA_VERSION
      || value.execution_mode !== "runtime_shared_wallet_entry_exit_release_v1"
      || value.capital_semantics !== "single_runtime_wallet_event_committed_cash_reuse"
      || value.matching_scope !== "market_next_open_full_fill"
      || value.margin_scope !== "isolated_positions_shared_admission_cash"
      || value.same_time_cash_policy !== "exit_release_before_entry_admission_then_control_plane_priority"
      || value.failure_policy !== "engine_failure_no_partial_portfolio_result") {
    throw new Error("runtime shared wallet lifecycle Plan policy is unsupported")
  }
  required(value.portfolio_id, "portfolio_id")
  if (value.lanes.length < 2) throw new Error("runtime shared wallet lifecycle Plan requires at least two lanes")
  let previous = ""
  const symbols = new Set<string>()
  const runs = new Set<string>()
  let exits = 0
  for (const lane of value.lanes) {
    exact(lane, [
      "lane_id", "symbol", "run_id", "request_hash", "trial_reservation_hash", "attempt_lease_hash",
      "scheduled_exit_time", "exit_intent_hash",
    ], "Plan lane")
    required(lane.lane_id, "lane_id")
    required(lane.symbol, "symbol")
    required(lane.run_id, "run_id")
    digest(lane.request_hash, "request_hash")
    digest(lane.trial_reservation_hash, "trial_reservation_hash")
    digest(lane.attempt_lease_hash, "attempt_lease_hash")
    if ((lane.scheduled_exit_time === null) !== (lane.exit_intent_hash === null)) {
      throw new Error("runtime shared wallet lifecycle exit time and intent hash must be jointly present")
    }
    if (lane.scheduled_exit_time !== null) {
      timestamp(lane.scheduled_exit_time, "scheduled_exit_time")
      digest(lane.exit_intent_hash!, "exit_intent_hash")
      exits += 1
    }
    if (lane.lane_id <= previous || symbols.has(lane.symbol) || runs.has(lane.run_id)) {
      throw new Error("runtime shared wallet lifecycle Plan lanes require canonical unique identities")
    }
    previous = lane.lane_id
    symbols.add(lane.symbol)
    runs.add(lane.run_id)
  }
  if (exits < 1) throw new Error("runtime shared wallet lifecycle Plan requires at least one frozen full exit")
  digest(value.plan_hash, "plan_hash")
  if (value.plan_hash !== replayRuntimeSharedWalletLifecyclePlanHash(value)) {
    throw new Error("runtime shared wallet lifecycle Plan hash mismatch")
  }
}

export function assertReplayRuntimeSharedWalletLifecycleResult(
  value: ReplayRuntimeSharedWalletLifecycleResult,
  plan: ReplayRuntimeSharedWalletLifecyclePlan,
  authority: ReplayRuntimeSharedWalletAuthorityBinding,
): void {
  assertReplayRuntimeSharedWalletLifecyclePlan(plan)
  exact(value, [
    "schema_version", "portfolio_id", "portfolio_plan_hash", "lifecycle_reservation_hash", "execution_mode",
    "settlement_asset", "shared_initial_cash", "global_source_event_queue", "open_positions", "closed_positions",
    "rejected_lane_ids", "total_entry_fees", "total_exit_fees", "total_realized_pnl", "ending_settled_cash",
    "ending_reserved_isolated_collateral", "ending_available_cash", "portfolio_nav_at_entry_marks",
    "limitations", "result_hash",
  ], "Result")
  if (value.schema_version !== REPLAY_RUNTIME_SHARED_WALLET_LIFECYCLE_RESULT_SCHEMA_VERSION
      || value.portfolio_id !== plan.portfolio_id || value.portfolio_id !== authority.portfolio_id
      || value.portfolio_plan_hash !== plan.plan_hash || value.portfolio_plan_hash !== authority.portfolio_plan_hash
      || value.lifecycle_reservation_hash !== authority.reservation_hash
      || value.execution_mode !== "runtime_shared_wallet_entry_exit_release_v1"
      || value.settlement_asset !== authority.settlement_asset
      || value.shared_initial_cash !== authority.shared_initial_cash) {
    throw new Error("runtime shared wallet lifecycle Result authority binding is invalid")
  }
  const expectedEventCount = plan.lanes.length + plan.lanes.filter((lane) => lane.scheduled_exit_time !== null).length
  if (value.global_source_event_queue.length !== expectedEventCount) {
    throw new Error("runtime shared wallet lifecycle Result event coverage is incomplete")
  }
  const rank = new Map(authority.lanes.map((lane) => [lane.lane_id, lane.priority_rank]))
  const planByLane = new Map(plan.lanes.map((lane) => [lane.lane_id, lane]))
  const positions = new Map<string, ReplayRuntimeSharedWalletLifecyclePosition & { entry_fee: number }>()
  const closed: ReplayRuntimeSharedWalletLifecycleClosedPosition[] = []
  const rejected: string[] = []
  let wallet: ReplayRuntimeSharedWalletSnapshot = {
    settled_cash: value.shared_initial_cash,
    reserved_isolated_collateral: 0,
    available_cash: value.shared_initial_cash,
  }
  let entryFees = 0
  let exitFees = 0
  let realized = 0
  let previousKey = ""
  for (const [index, event] of value.global_source_event_queue.entries()) {
    const lane = planByLane.get(event.lane_id)
    if (!lane || event.queue_ordinal !== index + 1 || event.symbol !== lane.symbol
        || event.request_hash !== lane.request_hash || event.priority_rank !== rank.get(event.lane_id)) {
      throw new Error("runtime shared wallet lifecycle event authority drift")
    }
    assertReplayRuntimeSharedWalletLifecycleEvent(event, value.portfolio_id)
    const key = `${event.event_time}|${event.event_role_rank}|${String(event.priority_rank).padStart(12, "0")}`
    if (key <= previousKey) throw new Error("runtime shared wallet lifecycle global queue order drift")
    previousKey = key
    if (JSON.stringify(event.wallet_before) !== JSON.stringify(wallet)) {
      throw new Error("runtime shared wallet lifecycle cash chain is discontinuous")
    }
    if (event.event_role === "entry") {
      if (event.outcome === "filled") {
        const position = {
          lane_id: event.lane_id, symbol: event.symbol, side: event.position_side, quantity: event.quantity,
          entry_price: event.execution_price, isolated_collateral: event.isolated_collateral,
          entry_fill_hash: event.fill_hash!, entry_fee: event.fee,
        }
        positions.set(event.lane_id, position)
        entryFees = addReplayDecimalValues(entryFees, event.fee)
      } else rejected.push(event.lane_id)
    } else {
      const position = positions.get(event.lane_id)
      if (event.outcome === "filled") {
        if (!position || event.quantity !== position.quantity || event.position_side !== position.side
            || event.isolated_collateral !== position.isolated_collateral) {
          throw new Error("runtime shared wallet lifecycle exit does not bind an open Position")
        }
        closed.push({
          lane_id: position.lane_id,
          symbol: position.symbol,
          side: position.side,
          quantity: position.quantity,
          entry_price: position.entry_price,
          isolated_collateral: position.isolated_collateral,
          entry_fill_hash: position.entry_fill_hash,
          exit_price: event.execution_price,
          exit_fill_hash: event.fill_hash!,
          realized_pnl: event.realized_pnl,
          entry_fee: position.entry_fee,
          exit_fee: event.fee,
        })
        positions.delete(event.lane_id)
        exitFees = addReplayDecimalValues(exitFees, event.fee)
        realized = addReplayDecimalValues(realized, event.realized_pnl)
      } else if (position) {
        throw new Error("runtime shared wallet lifecycle reached exit cannot remain not_reached")
      }
    }
    wallet = event.wallet_after
  }
  const open = [...positions.values()].map(({ entry_fee: _fee, ...position }) => position)
  if (JSON.stringify(value.open_positions) !== JSON.stringify(open)
      || JSON.stringify(value.closed_positions) !== JSON.stringify(closed)
      || JSON.stringify(value.rejected_lane_ids) !== JSON.stringify(rejected)
      || value.total_entry_fees !== entryFees || value.total_exit_fees !== exitFees
      || value.total_realized_pnl !== realized
      || value.ending_settled_cash !== addReplayDecimalValues(value.shared_initial_cash, realized, -entryFees, -exitFees)
      || value.ending_reserved_isolated_collateral !== sum(open.map((position) => position.isolated_collateral))
      || value.ending_available_cash !== addReplayDecimalValues(
        value.ending_settled_cash, -value.ending_reserved_isolated_collateral,
      )
      || value.portfolio_nav_at_entry_marks !== value.ending_settled_cash
      || JSON.stringify(wallet) !== JSON.stringify({
        settled_cash: value.ending_settled_cash,
        reserved_isolated_collateral: value.ending_reserved_isolated_collateral,
        available_cash: value.ending_available_cash,
      })) {
    throw new Error("runtime shared wallet lifecycle Result capital conservation failed")
  }
  const limitations: ReplayRuntimeSharedWalletLifecycleResult["limitations"] = [
    "market_next_open_entry_and_full_exit_only",
    "no_funding_liquidation_partial_position_or_cross_margin",
    "open_positions_marked_at_entry_price",
  ]
  if (JSON.stringify(value.limitations) !== JSON.stringify(limitations)) {
    throw new Error("runtime shared wallet lifecycle Result limitations were weakened")
  }
  digest(value.result_hash, "result_hash")
  if (value.result_hash !== replayRuntimeSharedWalletLifecycleResultHash(value)) {
    throw new Error("runtime shared wallet lifecycle Result hash mismatch")
  }
}

export function assertReplayRuntimeSharedWalletLifecycleOutcome(
  value: ReplayRuntimeSharedWalletLifecycleOutcome,
  plan: ReplayRuntimeSharedWalletLifecyclePlan,
  authority: ReplayRuntimeSharedWalletAuthorityBinding,
): void {
  exact(value, [
    "schema_version", "portfolio_id", "portfolio_plan_hash", "lifecycle_reservation_hash", "status",
    "result", "failure", "outcome_hash",
  ], "Outcome")
  if (value.schema_version !== REPLAY_RUNTIME_SHARED_WALLET_LIFECYCLE_OUTCOME_SCHEMA_VERSION
      || value.portfolio_id !== plan.portfolio_id || value.portfolio_plan_hash !== plan.plan_hash
      || value.lifecycle_reservation_hash !== authority.reservation_hash) {
    throw new Error("runtime shared wallet lifecycle Outcome authority binding is invalid")
  }
  if (value.status === "completed") {
    if (!value.result || value.failure !== null) throw new Error("completed lifecycle Outcome requires Result")
    assertReplayRuntimeSharedWalletLifecycleResult(value.result, plan, authority)
  } else {
    if (value.result !== null || !value.failure || value.failure.partial_result_published !== false) {
      throw new Error("failed lifecycle Outcome cannot publish partial Result")
    }
    exact(value.failure, ["code", "message", "partial_result_published"], "Outcome failure")
    if (!["runtime-shared-wallet-lifecycle-input-invalid", "runtime-shared-wallet-lifecycle-engine-failed"]
      .includes(value.failure.code)) {
      throw new Error("failed lifecycle Outcome code is unsupported")
    }
    required(value.failure.message, "failure.message")
  }
  digest(value.outcome_hash, "outcome_hash")
  if (value.outcome_hash !== replayRuntimeSharedWalletLifecycleOutcomeHash(value)) {
    throw new Error("runtime shared wallet lifecycle Outcome hash mismatch")
  }
}

export function assertReplayRuntimeSharedWalletLifecycleEvent(
  event: ReplayRuntimeSharedWalletLifecycleEvent,
  portfolioId: string,
): void {
  const common = [
    "event_hash", "queue_ordinal", "event_time", "boundary_phase", "source_kind", "lane_id", "symbol",
    "priority_rank", "request_hash", "bar_hash", "wallet_before", "wallet_after", "event_role",
    "event_role_rank", "position_side", "execution_price", "quantity", "isolated_collateral", "fee",
    "required_available_cash", "outcome", "outcome_reason", "fill_hash", "realized_pnl", "released_collateral",
  ]
  exact(event, common, "event")
  timestamp(event.event_time, "event_time")
  digest(event.request_hash, "request_hash")
  digest(event.bar_hash, "bar_hash")
  if (event.fill_hash !== null) digest(event.fill_hash, "fill_hash")
  wallet(event.wallet_before)
  wallet(event.wallet_after)
  positive(event.execution_price, "execution_price")
  positive(event.quantity, "quantity")
  positive(event.isolated_collateral, "isolated_collateral")
  nonnegative(event.fee, "fee")
  if (event.boundary_phase !== 20 || event.source_kind !== "bar_open") {
    throw new Error("runtime shared wallet lifecycle event boundary is invalid")
  }
  if (event.event_role === "entry") {
    const requiredCash = addReplayDecimalValues(event.isolated_collateral, event.fee)
    if (event.event_role_rank !== 2 || event.realized_pnl !== 0 || event.released_collateral !== 0
        || event.required_available_cash !== requiredCash) {
      throw new Error("runtime shared wallet lifecycle entry event economics are invalid")
    }
    if (event.outcome === "filled") {
      const expectedFillHash = canonicalHash({
        portfolio_id: portfolioId,
        lane_id: event.lane_id,
        request_hash: event.request_hash,
        event_role: "entry",
        event_time: event.event_time,
        side: event.position_side === "long" ? "buy" : "sell",
        quantity: event.quantity,
        price: event.execution_price,
        fee: event.fee,
        reduce_only: false,
      })
      if (event.outcome_reason !== "cash_reserved_and_fill_committed" || event.fill_hash === null
          || event.fill_hash !== expectedFillHash
          || event.wallet_before.available_cash < requiredCash
          || event.wallet_after.settled_cash !== addReplayDecimalValues(event.wallet_before.settled_cash, -event.fee)
          || event.wallet_after.reserved_isolated_collateral !== addReplayDecimalValues(
            event.wallet_before.reserved_isolated_collateral, event.isolated_collateral,
          ) || event.wallet_after.available_cash !== addReplayDecimalValues(
            event.wallet_before.available_cash, -requiredCash,
          )) throw new Error("runtime shared wallet lifecycle entry commit is invalid")
    } else if (event.outcome_reason !== "insufficient_available_cash" || event.fill_hash !== null
        || event.wallet_before.available_cash >= requiredCash
        || JSON.stringify(event.wallet_after) !== JSON.stringify(event.wallet_before)) {
      throw new Error("runtime shared wallet lifecycle rejected entry mutated cash")
    }
  } else {
    if (event.event_role_rank !== 1 || event.required_available_cash !== 0) {
      throw new Error("runtime shared wallet lifecycle exit ordering is invalid")
    }
    if (event.outcome === "filled") {
      const expectedFillHash = canonicalHash({
        portfolio_id: portfolioId,
        lane_id: event.lane_id,
        request_hash: event.request_hash,
        event_role: "exit",
        event_time: event.event_time,
        side: event.position_side === "long" ? "sell" : "buy",
        quantity: event.quantity,
        price: event.execution_price,
        fee: event.fee,
        realized_pnl: event.realized_pnl,
        reduce_only: true,
      })
      if (event.outcome_reason !== "realized_pnl_fee_and_collateral_release_committed"
          || event.fill_hash === null || event.fill_hash !== expectedFillHash
          || event.released_collateral !== event.isolated_collateral
          || event.wallet_after.settled_cash !== addReplayDecimalValues(
            event.wallet_before.settled_cash, event.realized_pnl, -event.fee,
          ) || event.wallet_after.reserved_isolated_collateral !== addReplayDecimalValues(
            event.wallet_before.reserved_isolated_collateral, -event.released_collateral,
          ) || event.wallet_after.available_cash !== addReplayDecimalValues(
            event.wallet_before.available_cash, event.released_collateral, event.realized_pnl, -event.fee,
          )) throw new Error("runtime shared wallet lifecycle exit release commit is invalid")
    } else if (event.outcome_reason !== "entry_not_filled" || event.fill_hash !== null
        || event.fee !== 0 || event.realized_pnl !== 0 || event.released_collateral !== 0
        || JSON.stringify(event.wallet_after) !== JSON.stringify(event.wallet_before)) {
      throw new Error("runtime shared wallet lifecycle not-reached exit mutated cash")
    }
  }
  if (event.event_hash !== replayRuntimeSharedWalletLifecycleEventHash(event)) {
    throw new Error("runtime shared wallet lifecycle event hash mismatch")
  }
}

function wallet(value: ReplayRuntimeSharedWalletSnapshot): void {
  exact(value, ["settled_cash", "reserved_isolated_collateral", "available_cash"], "wallet")
  for (const item of Object.values(value)) nonnegative(item, "wallet amount")
  if (value.available_cash !== addReplayDecimalValues(value.settled_cash, -value.reserved_isolated_collateral)) {
    throw new Error("runtime shared wallet lifecycle wallet does not reconcile")
  }
}

function exact(value: object, fields: string[], label: string): void {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...fields].sort())) {
    throw new Error(`runtime shared wallet lifecycle ${label} fields are not exact`)
  }
}
function required(value: string, field: string): void {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`runtime shared wallet lifecycle ${field} is required`)
}
function digest(value: string, field: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`runtime shared wallet lifecycle ${field} must be a hash`)
}
function timestamp(value: string, field: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`runtime shared wallet lifecycle ${field} must be UTC time`)
}
function positive(value: number, field: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`runtime shared wallet lifecycle ${field} must be positive`)
}
function nonnegative(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`runtime shared wallet lifecycle ${field} must be non-negative`)
}
function sum(values: number[]): number {
  return values.reduce((total, value) => addReplayDecimalValues(total, value), 0)
}
