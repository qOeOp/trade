import {
  assertReplayVenueRiskPolicySnapshot,
  assertReplayInstrumentStatusSnapshot,
  canonicalHash,
  type ReplayFundingEvent,
  type ReplayInstrumentStatusSnapshot,
  type ReplayMarkEvent,
  type ReplayVenueRiskPolicySnapshot,
} from "./replay-contracts"
import {
  addReplayDecimalValues,
  isReplayIncrementAligned,
  quantizeReplayDifferenceProduct,
  quantizeReplayBasisPointPrice,
  quantizeReplayProduct,
} from "./replay-decimal"
import {
  assertReplayRuntimeSharedWalletFundingEvent,
  type ReplayRuntimeSharedWalletFundingEvent,
} from "./replay-runtime-shared-wallet-funding-contracts"
import type {
  ReplayRuntimeSharedWalletAuthorityBinding,
  ReplayRuntimeSharedWalletSnapshot,
} from "./replay-runtime-shared-wallet-contracts"
import type {
  ReplayPortfolioAllocationEntryEvent,
  ReplayPortfolioAllocationResult,
  ReplayPortfolioAllocationRejectionReason,
} from "./replay-portfolio-allocation-contracts"

export const REPLAY_RUNTIME_SHARED_WALLET_RISK_PLAN_SCHEMA_VERSION =
  "trade.rd-replay-runtime-shared-wallet-risk-plan.v1" as const
export const REPLAY_RUNTIME_SHARED_WALLET_RISK_RESULT_SCHEMA_VERSION =
  "trade.rd-replay-runtime-shared-wallet-risk-result.v1" as const
export const REPLAY_RUNTIME_SHARED_WALLET_RISK_OUTCOME_SCHEMA_VERSION =
  "trade.rd-replay-runtime-shared-wallet-risk-outcome.v1" as const

export interface ReplayRuntimeSharedWalletRiskPlan {
  schema_version: typeof REPLAY_RUNTIME_SHARED_WALLET_RISK_PLAN_SCHEMA_VERSION
  portfolio_id: string
  execution_mode: "runtime_shared_wallet_exact_risk_full_liquidation_v1"
  capital_semantics: "single_runtime_wallet_event_committed_risk_cash_reuse"
  matching_scope: "market_next_open_and_trigger_mark_full_fill"
  margin_scope: "isolated_positions_shared_admission_cash"
  funding_scope: "frozen_exact_events_t_minus_position"
  risk_scope: "complete_exact_mark_grid_isolated_maintenance_full_liquidation"
  same_time_cash_policy: "funding_then_exact_risk_then_liquidation_then_exit_then_entry_then_control_plane_priority"
  failure_policy: "engine_failure_or_liquidation_deficit_no_partial_portfolio_result"
  lanes: Array<{
    lane_id: string
    symbol: string
    run_id: string
    request_hash: string
    trial_reservation_hash: string
    attempt_lease_hash: string
    scheduled_exit_time: string | null
    exit_intent_hash: string | null
    price_increment: string
    settlement_increment: string
    contract_multiplier: "1"
    fee_bps: number
    slippage_bps: number
    funding_event_count: number
    funding_events_hash: string
    mark_event_count: number
    mark_events_hash: string
    venue_risk_policy_epochs: ReplayVenueRiskPolicySnapshot[]
    venue_risk_policy_epochs_hash: string
    instrument_status_epochs: ReplayInstrumentStatusSnapshot[]
    instrument_status_epochs_hash: string
  }>
  plan_hash: string
}

interface ReplayRuntimeSharedWalletRiskEventBase {
  event_hash: string
  queue_ordinal: number
  event_time: string
  lane_id: string
  symbol: string
  priority_rank: number
  request_hash: string
  wallet_before: ReplayRuntimeSharedWalletSnapshot
  wallet_after: ReplayRuntimeSharedWalletSnapshot
}

export interface ReplayRuntimeSharedWalletRiskEntryEvent extends ReplayRuntimeSharedWalletRiskEventBase {
  boundary_phase: 20
  source_kind: "bar_open"
  event_role: "entry"
  event_role_rank: 4
  bar_hash: string
  position_side: "long" | "short"
  execution_price: number
  quantity: number
  isolated_collateral: number
  fee: number
  required_available_cash: number
  outcome: "filled" | "rejected"
  outcome_reason:
    | "cash_reserved_and_fill_committed"
    | "insufficient_available_cash"
    | "allocation_admitted_and_fill_committed"
    | ReplayPortfolioAllocationRejectionReason
  fill_hash: string | null
  realized_pnl: 0
  released_collateral: 0
}

export interface ReplayRuntimeSharedWalletRiskExitEvent extends ReplayRuntimeSharedWalletRiskEventBase {
  boundary_phase: 20
  source_kind: "bar_open"
  event_role: "exit"
  event_role_rank: 3
  bar_hash: string
  position_side: "long" | "short"
  execution_price: number
  quantity: number
  isolated_collateral: number
  fee: number
  required_available_cash: 0
  outcome: "filled" | "not_reached"
  outcome_reason: "realized_pnl_fee_and_collateral_release_committed" | "no_open_position_after_risk"
  fill_hash: string | null
  realized_pnl: number
  released_collateral: number
}

export interface ReplayRuntimeSharedWalletRiskObservationEvent extends ReplayRuntimeSharedWalletRiskEventBase {
  boundary_phase: 15
  source_kind: "mark"
  event_role: "risk_observation"
  event_role_rank: 1
  mark_event_index: number
  mark_event_hash: string
  available_at: string
  source_sequence: number
  mark_price: number
  venue_risk_policy_snapshot: ReplayVenueRiskPolicySnapshot
  venue_risk_policy_snapshot_hash: string
  position_side: "long" | "short" | null
  quantity: number
  entry_price: number | null
  isolated_collateral: number
  attributed_settled_cashflow: number
  unrealized_pnl: number
  notional: number
  margin_balance: number
  maintenance_margin_requirement: number
  maintenance_margin_headroom: number
  outcome: "healthy" | "maintenance_breached" | "not_reached"
  outcome_reason: "maintenance_sufficient" | "full_liquidation_required" | "no_open_position"
}

export interface ReplayRuntimeSharedWalletRiskLiquidationEvent extends ReplayRuntimeSharedWalletRiskEventBase {
  boundary_phase: 15
  source_kind: "mark"
  event_role: "liquidation"
  event_role_rank: 2
  trigger_risk_event_hash: string
  venue_risk_policy_snapshot_hash: string
  position_side: "long" | "short"
  quantity: number
  trigger_mark_price: number
  execution_price: number
  isolated_collateral: number
  attributed_settled_cashflow_before_liquidation: number
  realized_pnl: number
  trading_fee: number
  liquidation_fee: number
  released_collateral: number
  entry_fill_hash: string
  fill_hash: string
  outcome: "filled"
  outcome_reason: "exact_maintenance_breach_forced_full_close"
  settlement_state: "flat_without_deficit"
}

export type ReplayRuntimeSharedWalletRiskQueueEvent =
  | ReplayRuntimeSharedWalletFundingEvent
  | ReplayRuntimeSharedWalletRiskObservationEvent
  | ReplayRuntimeSharedWalletRiskLiquidationEvent
  | ReplayRuntimeSharedWalletRiskExitEvent
  | ReplayRuntimeSharedWalletRiskEntryEvent

export interface ReplayRuntimeSharedWalletRiskPosition {
  lane_id: string
  symbol: string
  side: "long" | "short"
  quantity: number
  entry_price: number
  isolated_collateral: number
  entry_fill_hash: string
  attributed_settled_cashflow: number
  last_exact_mark_price: number
  unrealized_pnl: number
}

export interface ReplayRuntimeSharedWalletRiskClosedPosition {
  lane_id: string
  symbol: string
  side: "long" | "short"
  quantity: number
  entry_price: number
  isolated_collateral: number
  entry_fill_hash: string
  exit_role: "strategy_exit" | "liquidation"
  exit_price: number
  exit_fill_hash: string
  realized_pnl: number
  entry_fee: number
  exit_trading_fee: number
  liquidation_fee: number
}

export interface ReplayRuntimeSharedWalletRiskResult {
  schema_version: typeof REPLAY_RUNTIME_SHARED_WALLET_RISK_RESULT_SCHEMA_VERSION
  portfolio_id: string
  portfolio_plan_hash: string
  risk_reservation_hash: string
  execution_mode: "runtime_shared_wallet_exact_risk_full_liquidation_v1"
  settlement_asset: string
  shared_initial_cash: number
  global_source_event_queue: ReplayRuntimeSharedWalletRiskQueueEvent[]
  open_positions: ReplayRuntimeSharedWalletRiskPosition[]
  closed_positions: ReplayRuntimeSharedWalletRiskClosedPosition[]
  rejected_lane_ids: string[]
  total_entry_fees: number
  total_strategy_exit_fees: number
  total_liquidation_trading_fees: number
  total_liquidation_fees: number
  total_realized_pnl: number
  total_funding_cashflow: number
  ending_unrealized_pnl: number
  ending_settled_cash: number
  ending_reserved_isolated_collateral: number
  ending_available_cash: number
  ending_portfolio_nav: number
  exact_mark_observation_count: number
  liquidation_count: number
  limitations: [
    "complete_exact_mark_grid_and_simulated_trigger_mark_full_close_only",
    "isolated_margin_no_cross_margin_partial_liquidation_borrow_insurance_or_adl",
    "liquidation_execution_is_model_evidence_not_exchange_trade_reconstruction",
  ]
  result_hash: string
}

export interface ReplayRuntimeSharedWalletRiskOutcome {
  schema_version: typeof REPLAY_RUNTIME_SHARED_WALLET_RISK_OUTCOME_SCHEMA_VERSION
  portfolio_id: string
  portfolio_plan_hash: string
  risk_reservation_hash: string
  status: "completed" | "failed"
  result: ReplayRuntimeSharedWalletRiskResult | null
  failure: {
    code: "runtime-shared-wallet-risk-input-invalid" | "runtime-shared-wallet-risk-engine-failed"
    message: string
    partial_result_published: false
  } | null
  outcome_hash: string
}

export function replayRuntimeSharedWalletRiskPlanHash(
  value: Omit<ReplayRuntimeSharedWalletRiskPlan, "plan_hash"> | ReplayRuntimeSharedWalletRiskPlan,
): string {
  const { plan_hash: _hash, ...body } = value as ReplayRuntimeSharedWalletRiskPlan
  return canonicalHash(body)
}

export function replayRuntimeSharedWalletRiskEventHash(
  value: Omit<ReplayRuntimeSharedWalletRiskQueueEvent, "event_hash"> | ReplayRuntimeSharedWalletRiskQueueEvent,
): string {
  const { event_hash: _hash, ...body } = value as ReplayRuntimeSharedWalletRiskQueueEvent
  return canonicalHash(body)
}

export function replayRuntimeSharedWalletRiskResultHash(
  value: Omit<ReplayRuntimeSharedWalletRiskResult, "result_hash"> | ReplayRuntimeSharedWalletRiskResult,
): string {
  const { result_hash: _hash, ...body } = value as ReplayRuntimeSharedWalletRiskResult
  return canonicalHash(body)
}

export function replayRuntimeSharedWalletRiskOutcomeHash(
  value: Omit<ReplayRuntimeSharedWalletRiskOutcome, "outcome_hash"> | ReplayRuntimeSharedWalletRiskOutcome,
): string {
  const { outcome_hash: _hash, ...body } = value as ReplayRuntimeSharedWalletRiskOutcome
  return canonicalHash(body)
}

export function assertReplayRuntimeSharedWalletRiskPlan(value: ReplayRuntimeSharedWalletRiskPlan): void {
  exact(value, [
    "schema_version", "portfolio_id", "execution_mode", "capital_semantics", "matching_scope", "margin_scope",
    "funding_scope", "risk_scope", "same_time_cash_policy", "failure_policy", "lanes", "plan_hash",
  ], "Plan")
  if (value.schema_version !== REPLAY_RUNTIME_SHARED_WALLET_RISK_PLAN_SCHEMA_VERSION
      || value.execution_mode !== "runtime_shared_wallet_exact_risk_full_liquidation_v1"
      || value.capital_semantics !== "single_runtime_wallet_event_committed_risk_cash_reuse"
      || value.matching_scope !== "market_next_open_and_trigger_mark_full_fill"
      || value.margin_scope !== "isolated_positions_shared_admission_cash"
      || value.funding_scope !== "frozen_exact_events_t_minus_position"
      || value.risk_scope !== "complete_exact_mark_grid_isolated_maintenance_full_liquidation"
      || value.same_time_cash_policy !== "funding_then_exact_risk_then_liquidation_then_exit_then_entry_then_control_plane_priority"
      || value.failure_policy !== "engine_failure_or_liquidation_deficit_no_partial_portfolio_result") {
    throw new Error("runtime shared wallet risk Plan policy is unsupported")
  }
  required(value.portfolio_id, "portfolio_id")
  if (value.lanes.length < 2) throw new Error("runtime shared wallet risk Plan requires at least two lanes")
  let previous = ""
  let exits = 0
  let funding = 0
  const symbols = new Set<string>()
  const runs = new Set<string>()
  for (const lane of value.lanes) {
    exact(lane, [
      "lane_id", "symbol", "run_id", "request_hash", "trial_reservation_hash", "attempt_lease_hash",
      "scheduled_exit_time", "exit_intent_hash", "price_increment", "settlement_increment",
      "contract_multiplier", "funding_event_count", "funding_events_hash", "mark_event_count",
      "fee_bps", "slippage_bps",
      "mark_events_hash", "venue_risk_policy_epochs", "venue_risk_policy_epochs_hash",
      "instrument_status_epochs", "instrument_status_epochs_hash",
    ], "Plan lane")
    required(lane.lane_id, "lane_id")
    required(lane.symbol, "symbol")
    required(lane.run_id, "run_id")
    digest(lane.request_hash, "request_hash")
    digest(lane.trial_reservation_hash, "trial_reservation_hash")
    digest(lane.attempt_lease_hash, "attempt_lease_hash")
    digest(lane.funding_events_hash, "funding_events_hash")
    digest(lane.mark_events_hash, "mark_events_hash")
    digest(lane.venue_risk_policy_epochs_hash, "venue_risk_policy_epochs_hash")
    digest(lane.instrument_status_epochs_hash, "instrument_status_epochs_hash")
    increment(lane.price_increment, "price_increment")
    increment(lane.settlement_increment, "settlement_increment")
    if (lane.contract_multiplier !== "1") throw new Error("runtime shared wallet risk only certifies linear unit multiplier")
    if (!Number.isFinite(lane.fee_bps) || lane.fee_bps < 0
        || !Number.isFinite(lane.slippage_bps) || lane.slippage_bps < 0) {
      throw new Error("runtime shared wallet risk cost policy is invalid")
    }
    if (!Number.isSafeInteger(lane.funding_event_count) || lane.funding_event_count < 0
        || !Number.isSafeInteger(lane.mark_event_count) || lane.mark_event_count <= 0) {
      throw new Error("runtime shared wallet risk source event count is invalid")
    }
    if ((lane.scheduled_exit_time === null) !== (lane.exit_intent_hash === null)) {
      throw new Error("runtime shared wallet risk exit time and intent hash must be jointly present")
    }
    if (lane.scheduled_exit_time !== null) {
      timestamp(lane.scheduled_exit_time, "scheduled_exit_time")
      digest(lane.exit_intent_hash!, "exit_intent_hash")
      exits += 1
    }
    if (lane.venue_risk_policy_epochs.length === 0
        || canonicalHash(lane.venue_risk_policy_epochs) !== lane.venue_risk_policy_epochs_hash) {
      throw new Error("runtime shared wallet risk policy schedule binding is invalid")
    }
    for (const snapshot of lane.venue_risk_policy_epochs) {
      assertReplayVenueRiskPolicySnapshot(snapshot)
      if (snapshot.symbol !== lane.symbol) throw new Error("runtime shared wallet risk policy symbol drift")
    }
    if (lane.instrument_status_epochs.length === 0
        || canonicalHash(lane.instrument_status_epochs) !== lane.instrument_status_epochs_hash
        || lane.instrument_status_epochs.some((snapshot) => snapshot.symbol !== lane.symbol)) {
      throw new Error("runtime shared wallet instrument status schedule binding is invalid")
    }
    for (const snapshot of lane.instrument_status_epochs) assertReplayInstrumentStatusSnapshot(snapshot)
    if (lane.lane_id <= previous || symbols.has(lane.symbol) || runs.has(lane.run_id)) {
      throw new Error("runtime shared wallet risk Plan lanes require canonical unique identities")
    }
    previous = lane.lane_id
    symbols.add(lane.symbol)
    runs.add(lane.run_id)
    funding += lane.funding_event_count
  }
  if (exits < 1 || funding < 1) {
    throw new Error("runtime shared wallet risk Plan requires a frozen full exit and exact funding event")
  }
  digest(value.plan_hash, "plan_hash")
  if (value.plan_hash !== replayRuntimeSharedWalletRiskPlanHash(value)) {
    throw new Error("runtime shared wallet risk Plan hash mismatch")
  }
}

export function assertReplayRuntimeSharedWalletRiskOutcome(
  value: ReplayRuntimeSharedWalletRiskOutcome,
  plan: ReplayRuntimeSharedWalletRiskPlan,
  authority: ReplayRuntimeSharedWalletAuthorityBinding,
): void {
  exact(value, [
    "schema_version", "portfolio_id", "portfolio_plan_hash", "risk_reservation_hash", "status",
    "result", "failure", "outcome_hash",
  ], "Outcome")
  if (value.schema_version !== REPLAY_RUNTIME_SHARED_WALLET_RISK_OUTCOME_SCHEMA_VERSION
      || value.portfolio_id !== plan.portfolio_id || value.portfolio_plan_hash !== plan.plan_hash
      || value.risk_reservation_hash !== authority.reservation_hash) {
    throw new Error("runtime shared wallet risk Outcome authority binding is invalid")
  }
  if (value.status === "completed") {
    if (!value.result || value.failure !== null) throw new Error("completed risk Outcome requires Result")
    assertReplayRuntimeSharedWalletRiskResult(value.result, plan, authority)
  } else {
    if (value.result !== null || !value.failure || value.failure.partial_result_published !== false) {
      throw new Error("failed risk Outcome cannot publish partial Result")
    }
    exact(value.failure, ["code", "message", "partial_result_published"], "Outcome failure")
    if (!["runtime-shared-wallet-risk-input-invalid", "runtime-shared-wallet-risk-engine-failed"]
      .includes(value.failure.code)) throw new Error("failed risk Outcome code is unsupported")
    required(value.failure.message, "failure.message")
  }
  digest(value.outcome_hash, "outcome_hash")
  if (value.outcome_hash !== replayRuntimeSharedWalletRiskOutcomeHash(value)) {
    throw new Error("runtime shared wallet risk Outcome hash mismatch")
  }
}

export function assertReplayRuntimeSharedWalletRiskResult(
  value: ReplayRuntimeSharedWalletRiskResult,
  plan: ReplayRuntimeSharedWalletRiskPlan,
  authority: ReplayRuntimeSharedWalletAuthorityBinding,
  allocationResult?: ReplayPortfolioAllocationResult,
): void {
  assertReplayRuntimeSharedWalletRiskPlan(plan)
  exact(value, [
    "schema_version", "portfolio_id", "portfolio_plan_hash", "risk_reservation_hash", "execution_mode",
    "settlement_asset", "shared_initial_cash", "global_source_event_queue", "open_positions", "closed_positions",
    "rejected_lane_ids", "total_entry_fees", "total_strategy_exit_fees", "total_liquidation_trading_fees",
    "total_liquidation_fees", "total_realized_pnl", "total_funding_cashflow", "ending_unrealized_pnl",
    "ending_settled_cash", "ending_reserved_isolated_collateral", "ending_available_cash",
    "ending_portfolio_nav", "exact_mark_observation_count", "liquidation_count", "limitations", "result_hash",
  ], "Result")
  if (value.schema_version !== REPLAY_RUNTIME_SHARED_WALLET_RISK_RESULT_SCHEMA_VERSION
      || value.portfolio_id !== plan.portfolio_id || value.portfolio_id !== authority.portfolio_id
      || value.portfolio_plan_hash !== plan.plan_hash || value.portfolio_plan_hash !== authority.portfolio_plan_hash
      || value.risk_reservation_hash !== authority.reservation_hash
      || value.execution_mode !== "runtime_shared_wallet_exact_risk_full_liquidation_v1"
      || value.settlement_asset !== authority.settlement_asset
      || value.shared_initial_cash !== authority.shared_initial_cash) {
    throw new Error("runtime shared wallet risk Result authority binding is invalid")
  }
  const planByLane = new Map(plan.lanes.map((lane) => [lane.lane_id, lane]))
  const rank = new Map(authority.lanes.map((lane) => [lane.lane_id, lane.priority_rank]))
  const positions = new Map<string, ReplayRuntimeSharedWalletRiskPosition & { entry_fee: number }>()
  const closed: ReplayRuntimeSharedWalletRiskClosedPosition[] = []
  const rejected: string[] = []
  const fundingByLane = new Map<string, ReplayFundingEvent[]>()
  const marksByLane = new Map<string, ReplayMarkEvent[]>()
  const pendingBreach = new Map<string, ReplayRuntimeSharedWalletRiskObservationEvent>()
  const allocationEvents = allocationResult === undefined ? null : new Map(
    allocationResult.global_source_event_queue.map((event) => [`${event.lane_id}\u0000${event.event_time}`, event]),
  )
  let walletValue: ReplayRuntimeSharedWalletSnapshot = {
    settled_cash: value.shared_initial_cash,
    reserved_isolated_collateral: 0,
    available_cash: value.shared_initial_cash,
  }
  let entryFees = 0
  let exitFees = 0
  let liquidationTradingFees = 0
  let liquidationFees = 0
  let realized = 0
  let fundingCashflow = 0
  let markCount = 0
  let liquidationCount = 0
  let previousKey: [number, number, number] = [Number.NEGATIVE_INFINITY, -1, -1]
  for (const [index, event] of value.global_source_event_queue.entries()) {
    const lane = planByLane.get(event.lane_id)
    const priority = rank.get(event.lane_id)
    if (!lane || priority === undefined || event.queue_ordinal !== index + 1 || event.symbol !== lane.symbol
        || event.request_hash !== lane.request_hash || event.priority_rank !== priority) {
      throw new Error("runtime shared wallet risk event authority drift")
    }
    timestamp(event.event_time, "event_time")
    digest(event.event_hash, "event_hash")
    digest(event.request_hash, "request_hash")
    wallet(event.wallet_before)
    wallet(event.wallet_after)
    const key: [number, number, number] = [Date.parse(event.event_time), event.event_role_rank, priority]
    if (key[0] < previousKey[0] || (key[0] === previousKey[0] && (key[1] < previousKey[1]
        || (key[1] === previousKey[1] && key[2] <= previousKey[2])))) {
      throw new Error("runtime shared wallet risk global queue order drift")
    }
    previousKey = key
    if (canonicalHash(event.wallet_before) !== canonicalHash(walletValue)) {
      throw new Error("runtime shared wallet risk cash chain is discontinuous")
    }
    if (event.event_role === "funding") {
      const position = positions.get(event.lane_id)
      assertReplayRuntimeSharedWalletFundingEvent(event, lane, position)
      const events = fundingByLane.get(event.lane_id) ?? []
      if (event.funding_event_index !== events.length) throw new Error("runtime shared wallet risk funding sequence drift")
      events.push({ timestamp: event.event_time, rate: event.rate, mark_price: event.mark_price })
      fundingByLane.set(event.lane_id, events)
      if (position && event.outcome === "applied") {
        position.attributed_settled_cashflow = addReplayDecimalValues(
          position.attributed_settled_cashflow, event.funding_cashflow,
        )
        fundingCashflow = addReplayDecimalValues(fundingCashflow, event.funding_cashflow)
      }
    } else if (event.event_role === "entry") {
      const allocationEvent = allocationEvents?.get(`${event.lane_id}\u0000${event.event_time}`)
      if (allocationEvents && !allocationEvent) {
        throw new Error("runtime shared wallet integrated entry lacks Allocation authority")
      }
      assertRiskEntry(event, lane, positions.get(event.lane_id), allocationEvent)
      if (event.outcome === "filled") {
        positions.set(event.lane_id, {
          lane_id: event.lane_id, symbol: event.symbol, side: event.position_side, quantity: event.quantity,
          entry_price: event.execution_price, isolated_collateral: event.isolated_collateral,
          entry_fill_hash: event.fill_hash!, attributed_settled_cashflow: -event.fee,
          last_exact_mark_price: event.execution_price, unrealized_pnl: 0, entry_fee: event.fee,
        })
        entryFees = addReplayDecimalValues(entryFees, event.fee)
      } else rejected.push(event.lane_id)
    } else if (event.event_role === "risk_observation") {
      assertRiskObservation(event, lane, positions.get(event.lane_id))
      const marks = marksByLane.get(event.lane_id) ?? []
      if (event.mark_event_index !== marks.length) throw new Error("runtime shared wallet risk mark sequence drift")
      marks.push({
        timestamp: event.event_time, available_at: event.available_at,
        source_sequence: event.source_sequence, mark_price: event.mark_price,
      })
      marksByLane.set(event.lane_id, marks)
      markCount += 1
      const position = positions.get(event.lane_id)
      if (position) {
        position.last_exact_mark_price = event.mark_price
        position.unrealized_pnl = event.unrealized_pnl
      }
      if (event.outcome === "maintenance_breached") pendingBreach.set(event.lane_id, event)
    } else if (event.event_role === "liquidation") {
      const position = positions.get(event.lane_id)
      const breach = pendingBreach.get(event.lane_id)
      if (!position || !breach) throw new Error("runtime shared wallet liquidation lacks its exact breach")
      assertLiquidation(event, lane, position, breach)
      closed.push({
        lane_id: position.lane_id, symbol: position.symbol, side: position.side, quantity: position.quantity,
        entry_price: position.entry_price, isolated_collateral: position.isolated_collateral,
        entry_fill_hash: position.entry_fill_hash, exit_role: "liquidation", exit_price: event.execution_price,
        exit_fill_hash: event.fill_hash, realized_pnl: event.realized_pnl, entry_fee: position.entry_fee,
        exit_trading_fee: event.trading_fee, liquidation_fee: event.liquidation_fee,
      })
      positions.delete(event.lane_id)
      pendingBreach.delete(event.lane_id)
      realized = addReplayDecimalValues(realized, event.realized_pnl)
      liquidationTradingFees = addReplayDecimalValues(liquidationTradingFees, event.trading_fee)
      liquidationFees = addReplayDecimalValues(liquidationFees, event.liquidation_fee)
      liquidationCount += 1
    } else {
      const position = positions.get(event.lane_id)
      assertRiskExit(event, lane, position)
      if (event.outcome === "filled") {
        if (!position) throw new Error("runtime shared wallet strategy exit lacks an open Position")
        closed.push({
          lane_id: position.lane_id, symbol: position.symbol, side: position.side, quantity: position.quantity,
          entry_price: position.entry_price, isolated_collateral: position.isolated_collateral,
          entry_fill_hash: position.entry_fill_hash, exit_role: "strategy_exit", exit_price: event.execution_price,
          exit_fill_hash: event.fill_hash!, realized_pnl: event.realized_pnl, entry_fee: position.entry_fee,
          exit_trading_fee: event.fee, liquidation_fee: 0,
        })
        positions.delete(event.lane_id)
        realized = addReplayDecimalValues(realized, event.realized_pnl)
        exitFees = addReplayDecimalValues(exitFees, event.fee)
      } else if (position) throw new Error("runtime shared wallet reached strategy exit remained open")
    }
    walletValue = event.wallet_after
  }
  if (pendingBreach.size !== 0) throw new Error("runtime shared wallet risk breach lacks full liquidation")
  if (allocationEvents && value.global_source_event_queue.filter((event) => event.event_role === "entry").length
      !== allocationResult!.global_source_event_queue.length) {
    throw new Error("runtime shared wallet integrated entry coverage drift")
  }
  for (const lane of plan.lanes) {
    const funding = fundingByLane.get(lane.lane_id) ?? []
    const marks = marksByLane.get(lane.lane_id) ?? []
    if (funding.length !== lane.funding_event_count || canonicalHash(funding) !== lane.funding_events_hash
        || marks.length !== lane.mark_event_count || canonicalHash(marks) !== lane.mark_events_hash) {
      throw new Error("runtime shared wallet risk Result does not bind frozen source events")
    }
  }
  const open = [...positions.values()].map(({ entry_fee: _fee, ...position }) => position)
  const endingSettled = addReplayDecimalValues(
    value.shared_initial_cash, realized, fundingCashflow, -entryFees, -exitFees,
    -liquidationTradingFees, -liquidationFees,
  )
  const endingReserved = sum(open.map((position) => position.isolated_collateral))
  const endingAvailable = addReplayDecimalValues(endingSettled, -endingReserved)
  const endingUnrealized = sum(open.map((position) => position.unrealized_pnl))
  const endingNav = addReplayDecimalValues(endingSettled, endingUnrealized)
  if (canonicalHash(value.open_positions) !== canonicalHash(open)
      || canonicalHash(value.closed_positions) !== canonicalHash(closed)
      || JSON.stringify(value.rejected_lane_ids) !== JSON.stringify(rejected)
      || value.total_entry_fees !== entryFees || value.total_strategy_exit_fees !== exitFees
      || value.total_liquidation_trading_fees !== liquidationTradingFees
      || value.total_liquidation_fees !== liquidationFees || value.total_realized_pnl !== realized
      || value.total_funding_cashflow !== fundingCashflow || value.ending_unrealized_pnl !== endingUnrealized
      || value.ending_settled_cash !== endingSettled || value.ending_reserved_isolated_collateral !== endingReserved
      || value.ending_available_cash !== endingAvailable || value.ending_portfolio_nav !== endingNav
      || value.exact_mark_observation_count !== markCount || value.liquidation_count !== liquidationCount
      || canonicalHash(walletValue) !== canonicalHash({
        settled_cash: endingSettled, reserved_isolated_collateral: endingReserved, available_cash: endingAvailable,
      })) {
    throw new Error("runtime shared wallet risk Result capital conservation failed")
  }
  const limitations: ReplayRuntimeSharedWalletRiskResult["limitations"] = [
    "complete_exact_mark_grid_and_simulated_trigger_mark_full_close_only",
    "isolated_margin_no_cross_margin_partial_liquidation_borrow_insurance_or_adl",
    "liquidation_execution_is_model_evidence_not_exchange_trade_reconstruction",
  ]
  if (JSON.stringify(value.limitations) !== JSON.stringify(limitations)) {
    throw new Error("runtime shared wallet risk Result limitations were weakened")
  }
  digest(value.result_hash, "result_hash")
  if (value.result_hash !== replayRuntimeSharedWalletRiskResultHash(value)) {
    throw new Error("runtime shared wallet risk Result hash mismatch")
  }
}

function assertRiskObservation(
  event: ReplayRuntimeSharedWalletRiskObservationEvent,
  lane: ReplayRuntimeSharedWalletRiskPlan["lanes"][number],
  position: (ReplayRuntimeSharedWalletRiskPosition & { entry_fee: number }) | undefined,
): void {
  exact(event, [
    "event_hash", "queue_ordinal", "event_time", "boundary_phase", "source_kind", "event_role",
    "event_role_rank", "lane_id", "symbol", "priority_rank", "request_hash", "mark_event_index",
    "mark_event_hash", "available_at", "source_sequence", "mark_price", "venue_risk_policy_snapshot",
    "venue_risk_policy_snapshot_hash", "position_side", "quantity", "entry_price", "isolated_collateral",
    "attributed_settled_cashflow", "unrealized_pnl", "notional", "margin_balance",
    "maintenance_margin_requirement", "maintenance_margin_headroom", "outcome", "outcome_reason",
    "wallet_before", "wallet_after",
  ], "risk observation event")
  if (event.event_hash !== replayRuntimeSharedWalletRiskEventHash(event)
      || event.boundary_phase !== 15 || event.event_role_rank !== 1
      || !Number.isSafeInteger(event.mark_event_index) || event.mark_event_index < 0
      || event.available_at !== event.event_time || !Number.isSafeInteger(event.source_sequence)
      || event.source_sequence < 0 || event.mark_event_hash !== canonicalHash({
        timestamp: event.event_time, available_at: event.available_at,
        source_sequence: event.source_sequence, mark_price: event.mark_price,
      }) || !Number.isFinite(event.mark_price) || event.mark_price <= 0
      || !isReplayIncrementAligned(event.mark_price, lane.price_increment)) {
    throw new Error("runtime shared wallet risk observation fact is invalid")
  }
  const snapshot = resolveRisk(lane.venue_risk_policy_epochs, event.event_time)
  assertReplayVenueRiskPolicySnapshot(event.venue_risk_policy_snapshot)
  if (event.venue_risk_policy_snapshot_hash !== canonicalHash(snapshot)
      || canonicalHash(event.venue_risk_policy_snapshot) !== canonicalHash(snapshot)
      || canonicalHash(event.wallet_after) !== canonicalHash(event.wallet_before)) {
    throw new Error("runtime shared wallet risk observation policy or wallet drift")
  }
  if (!position) {
    if (event.position_side !== null || event.quantity !== 0 || event.entry_price !== null
        || event.isolated_collateral !== 0 || event.attributed_settled_cashflow !== 0
        || event.unrealized_pnl !== 0 || event.notional !== 0 || event.margin_balance !== 0
        || event.maintenance_margin_requirement !== 0 || event.maintenance_margin_headroom !== 0
        || event.outcome !== "not_reached" || event.outcome_reason !== "no_open_position") {
      throw new Error("runtime shared wallet flat risk observation is invalid")
    }
    return
  }
  const unrealized = quantizeReplayDifferenceProduct(
    event.mark_price, position.entry_price, position.quantity, position.side === "long" ? 1 : -1,
    lane.settlement_increment, "floor",
  )
  const notional = quantizeReplayProduct(
    [event.mark_price, position.quantity], 1, lane.settlement_increment, "ceil",
  )
  const grossMaintenance = quantizeReplayProduct(
    [notional, snapshot.maintenance_tier.maintenance_margin_rate], 1, lane.settlement_increment, "ceil",
  )
  const maintenance = Math.max(0, addReplayDecimalValues(
    grossMaintenance, -snapshot.maintenance_tier.maintenance_amount,
  ))
  const balance = addReplayDecimalValues(
    position.isolated_collateral, position.attributed_settled_cashflow, unrealized,
  )
  const headroom = addReplayDecimalValues(balance, -maintenance)
  const breached = headroom < 0
  if (event.position_side !== position.side || event.quantity !== position.quantity
      || event.entry_price !== position.entry_price || event.isolated_collateral !== position.isolated_collateral
      || event.attributed_settled_cashflow !== position.attributed_settled_cashflow
      || event.unrealized_pnl !== unrealized || event.notional !== notional || event.margin_balance !== balance
      || event.maintenance_margin_requirement !== maintenance || event.maintenance_margin_headroom !== headroom
      || event.outcome !== (breached ? "maintenance_breached" : "healthy")
      || event.outcome_reason !== (breached ? "full_liquidation_required" : "maintenance_sufficient")) {
    throw new Error("runtime shared wallet risk observation economics are invalid")
  }
}

function assertLiquidation(
  event: ReplayRuntimeSharedWalletRiskLiquidationEvent,
  lane: ReplayRuntimeSharedWalletRiskPlan["lanes"][number],
  position: ReplayRuntimeSharedWalletRiskPosition & { entry_fee: number },
  breach: ReplayRuntimeSharedWalletRiskObservationEvent,
): void {
  exact(event, [
    "event_hash", "queue_ordinal", "event_time", "boundary_phase", "source_kind", "event_role",
    "event_role_rank", "lane_id", "symbol", "priority_rank", "request_hash", "trigger_risk_event_hash",
    "venue_risk_policy_snapshot_hash", "position_side", "quantity", "trigger_mark_price", "execution_price",
    "isolated_collateral", "attributed_settled_cashflow_before_liquidation", "realized_pnl", "trading_fee",
    "liquidation_fee", "released_collateral", "entry_fill_hash", "fill_hash", "outcome", "outcome_reason",
    "settlement_state", "wallet_before", "wallet_after",
  ], "liquidation event")
  if (event.event_hash !== replayRuntimeSharedWalletRiskEventHash(event)
      || event.boundary_phase !== 15 || event.event_role_rank !== 2
      || event.trigger_risk_event_hash !== breach.event_hash
      || event.venue_risk_policy_snapshot_hash !== breach.venue_risk_policy_snapshot_hash
      || event.position_side !== position.side || event.quantity !== position.quantity
      || event.trigger_mark_price !== breach.mark_price || event.isolated_collateral !== position.isolated_collateral
      || event.attributed_settled_cashflow_before_liquidation !== position.attributed_settled_cashflow
      || event.released_collateral !== position.isolated_collateral || event.entry_fill_hash !== position.entry_fill_hash
      || event.outcome !== "filled" || event.outcome_reason !== "exact_maintenance_breach_forced_full_close"
      || event.settlement_state !== "flat_without_deficit") {
    throw new Error("runtime shared wallet liquidation lineage is invalid")
  }
  const expectedRealized = quantizeReplayDifferenceProduct(
    event.execution_price, position.entry_price, position.quantity, position.side === "long" ? 1 : -1,
    lane.settlement_increment, "floor",
  )
  const side = position.side === "long" ? "sell" : "buy"
  const expectedExecutionPrice = quantizeReplayBasisPointPrice(
    event.trigger_mark_price, side, lane.slippage_bps, lane.price_increment,
  )
  const expectedTradingFee = quantizeReplayProduct(
    [expectedExecutionPrice, position.quantity, lane.fee_bps], 10_000,
    lane.settlement_increment, "ceil",
  )
  const expectedLiquidationFee = quantizeReplayProduct(
    [expectedExecutionPrice, position.quantity, breach.venue_risk_policy_snapshot.liquidation_fee_bps], 10_000,
    lane.settlement_increment, "ceil",
  )
  const next = {
    settled_cash: addReplayDecimalValues(
      event.wallet_before.settled_cash, expectedRealized, -event.trading_fee, -event.liquidation_fee,
    ),
    reserved_isolated_collateral: addReplayDecimalValues(
      event.wallet_before.reserved_isolated_collateral, -position.isolated_collateral,
    ),
    available_cash: addReplayDecimalValues(
      event.wallet_before.available_cash, position.isolated_collateral, expectedRealized,
      -event.trading_fee, -event.liquidation_fee,
    ),
  }
  if (event.execution_price !== expectedExecutionPrice || event.trading_fee !== expectedTradingFee
      || event.liquidation_fee !== expectedLiquidationFee || event.realized_pnl !== expectedRealized
      || canonicalHash(event.wallet_after) !== canonicalHash(next)
      || event.fill_hash !== canonicalHash({
        lane_id: event.lane_id, request_hash: event.request_hash,
        event_role: "liquidation", event_time: event.event_time,
        side, quantity: position.quantity,
        trigger_mark_price: event.trigger_mark_price, price: event.execution_price,
        trading_fee: event.trading_fee, liquidation_fee: event.liquidation_fee, reduce_only: true,
      })) {
    throw new Error("runtime shared wallet liquidation economics are invalid")
  }
}

function assertRiskEntry(
  event: ReplayRuntimeSharedWalletRiskEntryEvent,
  lane: ReplayRuntimeSharedWalletRiskPlan["lanes"][number],
  position: (ReplayRuntimeSharedWalletRiskPosition & { entry_fee: number }) | undefined,
  allocationEvent?: ReplayPortfolioAllocationEntryEvent,
): void {
  exact(event, [
    "event_hash", "queue_ordinal", "event_time", "boundary_phase", "source_kind", "event_role",
    "event_role_rank", "lane_id", "symbol", "priority_rank", "request_hash", "bar_hash", "position_side",
    "execution_price", "quantity", "isolated_collateral", "fee", "required_available_cash", "outcome",
    "outcome_reason", "fill_hash", "realized_pnl", "released_collateral", "wallet_before", "wallet_after",
  ], "entry event")
  const expectedFee = quantizeReplayProduct(
    [event.execution_price, event.quantity, lane.fee_bps], 10_000, lane.settlement_increment, "ceil",
  )
  const risk = resolveRisk(lane.venue_risk_policy_epochs, event.event_time)
  const notional = quantizeReplayProduct(
    [event.execution_price, event.quantity], 1, lane.settlement_increment, "ceil",
  )
  const initialMargin = quantizeReplayProduct(
    [notional, risk.initial_margin_rate], 1, lane.settlement_increment, "ceil",
  )
  const tier = risk.maintenance_tier
  const tierValid = notional >= tier.notional_floor && (tier.notional_cap === null || notional < tier.notional_cap)
  const required = addReplayDecimalValues(event.isolated_collateral, expectedFee)
  const admitted = allocationEvent ? allocationEvent.admission === "filled"
    : event.wallet_before.available_cash >= required
  const expectedWallet = admitted ? {
    settled_cash: addReplayDecimalValues(event.wallet_before.settled_cash, -expectedFee),
    reserved_isolated_collateral: addReplayDecimalValues(
      event.wallet_before.reserved_isolated_collateral, event.isolated_collateral,
    ),
    available_cash: addReplayDecimalValues(event.wallet_before.available_cash, -required),
  } : event.wallet_before
  const side = event.position_side === "long" ? "buy" : "sell"
  const fillHash = allocationEvent ? allocationEvent.fill_hash : admitted ? canonicalHash({
    lane_id: event.lane_id, request_hash: event.request_hash, event_role: "entry", event_time: event.event_time,
    side, quantity: event.quantity, price: event.execution_price, fee: expectedFee, reduce_only: false,
  }) : null
  const expectedReason = allocationEvent
    ? allocationEvent.admission_reason
    : admitted ? "cash_reserved_and_fill_committed" : "insufficient_available_cash"
  if (allocationEvent) {
    const bindings: Array<[string, unknown, unknown]> = [
      ["lane_id", allocationEvent.lane_id, event.lane_id], ["symbol", allocationEvent.symbol, event.symbol],
      ["priority_rank", allocationEvent.priority_rank, event.priority_rank],
      ["request_hash", allocationEvent.request_hash, event.request_hash],
      ["event_time", allocationEvent.event_time, event.event_time], ["bar_hash", allocationEvent.bar_hash, event.bar_hash],
      ["execution_price", allocationEvent.execution_price, event.execution_price],
      ["position_side", allocationEvent.position_side, event.position_side],
      ["quantity", allocationEvent.quantity, event.quantity],
      ["isolated_collateral", allocationEvent.isolated_collateral, event.isolated_collateral],
      ["entry_fee", allocationEvent.entry_fee, event.fee],
      ["required_available_cash", allocationEvent.required_available_cash, event.required_available_cash],
      ["fill_hash", allocationEvent.fill_hash, event.fill_hash],
      ["wallet_before", allocationEvent.wallet_before, event.wallet_before],
      ["wallet_after", allocationEvent.wallet_after, event.wallet_after],
    ]
    const drift = bindings.find(([, left, right]) => canonicalHash(left) !== canonicalHash(right))
    if (drift) throw new Error(`runtime shared wallet integrated entry Allocation ${drift[0]} binding drift`)
  }
  if (event.event_hash !== replayRuntimeSharedWalletRiskEventHash(event) || position
      || event.boundary_phase !== 20 || event.event_role_rank !== 4 || event.fee !== expectedFee
      || !Number.isFinite(event.execution_price) || event.execution_price <= 0
      || !isReplayIncrementAligned(event.execution_price, lane.price_increment)
      || !Number.isFinite(event.quantity) || event.quantity <= 0
      || !tierValid || event.isolated_collateral < initialMargin
      || event.required_available_cash !== required || event.outcome !== (admitted ? "filled" : "rejected")
      || event.outcome_reason !== expectedReason
      || event.fill_hash !== fillHash || event.realized_pnl !== 0 || event.released_collateral !== 0
      || canonicalHash(event.wallet_after) !== canonicalHash(expectedWallet)) {
    throw new Error("runtime shared wallet risk entry economics are invalid")
  }
}

function assertRiskExit(
  event: ReplayRuntimeSharedWalletRiskExitEvent,
  lane: ReplayRuntimeSharedWalletRiskPlan["lanes"][number],
  position: (ReplayRuntimeSharedWalletRiskPosition & { entry_fee: number }) | undefined,
): void {
  exact(event, [
    "event_hash", "queue_ordinal", "event_time", "boundary_phase", "source_kind", "event_role",
    "event_role_rank", "lane_id", "symbol", "priority_rank", "request_hash", "bar_hash", "position_side",
    "execution_price", "quantity", "isolated_collateral", "fee", "required_available_cash", "outcome",
    "outcome_reason", "fill_hash", "realized_pnl", "released_collateral", "wallet_before", "wallet_after",
  ], "exit event")
  if (event.event_hash !== replayRuntimeSharedWalletRiskEventHash(event)
      || event.boundary_phase !== 20 || event.event_role_rank !== 3
      || !Number.isFinite(event.execution_price) || event.execution_price <= 0
      || !isReplayIncrementAligned(event.execution_price, lane.price_increment)) {
    throw new Error("runtime shared wallet risk strategy exit fact is invalid")
  }
  if (!position) {
    if (event.outcome !== "not_reached" || event.outcome_reason !== "no_open_position_after_risk"
        || event.fee !== 0 || event.realized_pnl !== 0 || event.released_collateral !== 0
        || event.fill_hash !== null || canonicalHash(event.wallet_after) !== canonicalHash(event.wallet_before)) {
      throw new Error("runtime shared wallet risk not-reached strategy exit mutated cash")
    }
    return
  }
  const fee = quantizeReplayProduct(
    [event.execution_price, position.quantity, lane.fee_bps], 10_000, lane.settlement_increment, "ceil",
  )
  const realized = quantizeReplayDifferenceProduct(
    event.execution_price, position.entry_price, position.quantity, position.side === "long" ? 1 : -1,
    lane.settlement_increment, "floor",
  )
  const side = position.side === "long" ? "sell" : "buy"
  const fillHash = canonicalHash({
    lane_id: event.lane_id, request_hash: event.request_hash, event_role: "exit", event_time: event.event_time,
    side, quantity: position.quantity, price: event.execution_price, fee, realized_pnl: realized, reduce_only: true,
  })
  const next = {
    settled_cash: addReplayDecimalValues(event.wallet_before.settled_cash, realized, -fee),
    reserved_isolated_collateral: addReplayDecimalValues(
      event.wallet_before.reserved_isolated_collateral, -position.isolated_collateral,
    ),
    available_cash: addReplayDecimalValues(
      event.wallet_before.available_cash, position.isolated_collateral, realized, -fee,
    ),
  }
  if (event.position_side !== position.side || event.quantity !== position.quantity
      || event.isolated_collateral !== position.isolated_collateral || event.fee !== fee
      || event.outcome !== "filled" || event.outcome_reason !== "realized_pnl_fee_and_collateral_release_committed"
      || event.fill_hash !== fillHash || event.realized_pnl !== realized
      || event.released_collateral !== position.isolated_collateral
      || canonicalHash(event.wallet_after) !== canonicalHash(next)) {
    throw new Error("runtime shared wallet risk strategy exit economics are invalid")
  }
}

function resolveRisk(schedule: ReplayVenueRiskPolicySnapshot[], time: string): ReplayVenueRiskPolicySnapshot {
  const timestampValue = Date.parse(time)
  const snapshot = schedule.find((candidate) => Date.parse(candidate.effective_at) <= timestampValue
    && (candidate.valid_until === null || timestampValue < Date.parse(candidate.valid_until)))
  if (!snapshot) throw new Error(`runtime shared wallet risk schedule has no epoch at ${time}`)
  return snapshot
}

function exact(value: object, fields: string[], label: string): void {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...fields].sort())) {
    throw new Error(`runtime shared wallet risk ${label} fields are not exact`)
  }
}
function required(value: string, field: string): void {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`runtime shared wallet risk ${field} is required`)
}
function digest(value: string, field: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`runtime shared wallet risk ${field} must be a hash`)
}
function timestamp(value: string, field: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
      || !Number.isFinite(Date.parse(value))) throw new Error(`runtime shared wallet risk ${field} must be UTC time`)
}
function increment(value: string, field: string): void {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) || Number(value) <= 0) {
    throw new Error(`runtime shared wallet risk ${field} is invalid`)
  }
}
function sum(values: number[]): number {
  return values.reduce((total, value) => addReplayDecimalValues(total, value), 0)
}

function wallet(value: ReplayRuntimeSharedWalletSnapshot): void {
  exact(value, ["settled_cash", "reserved_isolated_collateral", "available_cash"], "wallet")
  for (const amount of Object.values(value)) {
    if (!Number.isFinite(amount) || amount < 0) throw new Error("runtime shared wallet risk wallet is invalid")
  }
  if (value.available_cash !== addReplayDecimalValues(value.settled_cash, -value.reserved_isolated_collateral)) {
    throw new Error("runtime shared wallet risk wallet does not reconcile")
  }
}
