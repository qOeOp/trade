import { canonicalHash } from "./replay-contracts"
import type { ReplayRuntimeSharedWalletSnapshot } from "./replay-runtime-shared-wallet-contracts"

export const REPLAY_PORTFOLIO_ALLOCATION_PLAN_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-allocation-plan.v1" as const
export const REPLAY_PORTFOLIO_ALLOCATION_RESULT_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-allocation-result.v1" as const
export const REPLAY_PORTFOLIO_ALLOCATION_OUTCOME_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-allocation-outcome.v1" as const

export interface ReplayPortfolioAllocationAuthorityBinding {
  reservation_hash: string
  portfolio_id: string
  portfolio_plan_hash: string
  settlement_asset: string
  shared_initial_cash: number
  max_gross_exposure_amount: number
  max_abs_net_exposure_amount: number
  max_portfolio_risk_amount: number
  lanes: Array<{ lane_id: string; priority_rank: number; max_lane_risk_amount: number }>
}

export interface ReplayPortfolioAllocationPlan {
  schema_version: typeof REPLAY_PORTFOLIO_ALLOCATION_PLAN_SCHEMA_VERSION
  portfolio_id: string
  execution_mode: "simultaneous_entry_exposure_risk_budget_allocation_v1"
  allocation_scope: "entry_slice_collect_same_time_then_allocate_before_fill"
  matching_scope: "market_next_open_full_fill_or_reject_no_resize"
  exposure_scope: "fixed_entry_execution_notional_until_slice_end"
  risk_budget_scope: "fixed_entry_to_frozen_stop_adverse_execution_plus_round_trip_fees"
  failure_policy: "input_or_engine_failure_no_partial_allocation_result"
  lanes: Array<{
    lane_id: string
    symbol: string
    run_id: string
    request_hash: string
    trial_reservation_hash: string
    attempt_lease_hash: string
    side: "long" | "short"
    quantity: number
    earliest_executable_time: string
    stop_price: number
    isolated_collateral: number
    fee_bps: number
    slippage_bps: number
    price_increment: string
    settlement_increment: string
    contract_multiplier: "1"
  }>
  plan_hash: string
}

export type ReplayPortfolioAllocationRejectionReason =
  | "lane_risk_limit_exceeded"
  | "insufficient_available_cash"
  | "gross_exposure_limit_exceeded"
  | "absolute_net_exposure_limit_exceeded"
  | "portfolio_risk_limit_exceeded"

export interface ReplayPortfolioAllocationDecision {
  decision_hash: string
  decision_sequence: number
  lane_id: string
  symbol: string
  priority_rank: number
  request_hash: string
  execution_price: number
  protective_stop_execution_price: number
  position_side: "long" | "short"
  quantity: number
  entry_notional: number
  signed_entry_notional: number
  isolated_collateral: number
  entry_fee: number
  protective_stop_exit_fee: number
  price_loss_at_protective_stop: number
  requested_risk_amount: number
  required_available_cash: number
  candidate_gross_exposure: number
  candidate_net_exposure: number
  candidate_portfolio_risk: number
  allocation: "admitted" | "rejected"
  allocation_reason: "all_limits_satisfied" | ReplayPortfolioAllocationRejectionReason
  allocated_available_cash_after: number
  allocated_gross_exposure_after: number
  allocated_net_exposure_after: number
  allocated_portfolio_risk_after: number
}

export interface ReplayPortfolioAllocationCycle {
  cycle_hash: string
  event_time: string
  allocation_phase: 19
  candidate_set_hash: string
  opening_wallet: ReplayRuntimeSharedWalletSnapshot
  opening_gross_exposure: number
  opening_net_exposure: number
  opening_portfolio_risk: number
  decisions: ReplayPortfolioAllocationDecision[]
  closing_allocated_available_cash: number
  closing_gross_exposure: number
  closing_net_exposure: number
  closing_portfolio_risk: number
}

export interface ReplayPortfolioAllocationEntryEvent {
  event_hash: string
  queue_ordinal: number
  event_time: string
  boundary_phase: 20
  source_kind: "bar_open"
  event_role: "entry"
  lane_id: string
  symbol: string
  priority_rank: number
  request_hash: string
  bar_hash: string
  allocation_cycle_hash: string
  allocation_decision_hash: string
  execution_price: number
  position_side: "long" | "short"
  quantity: number
  entry_notional: number
  requested_risk_amount: number
  isolated_collateral: number
  entry_fee: number
  required_available_cash: number
  admission: "filled" | "rejected"
  admission_reason: "allocation_admitted_and_fill_committed" | ReplayPortfolioAllocationRejectionReason
  fill_hash: string | null
  wallet_before: ReplayRuntimeSharedWalletSnapshot
  wallet_after: ReplayRuntimeSharedWalletSnapshot
}

export interface ReplayPortfolioAllocationResult {
  schema_version: typeof REPLAY_PORTFOLIO_ALLOCATION_RESULT_SCHEMA_VERSION
  portfolio_id: string
  portfolio_plan_hash: string
  portfolio_allocation_reservation_hash: string
  execution_mode: "simultaneous_entry_exposure_risk_budget_allocation_v1"
  settlement_asset: string
  shared_initial_cash: number
  limits: {
    max_gross_exposure_amount: number
    max_abs_net_exposure_amount: number
    max_portfolio_risk_amount: number
  }
  allocation_cycles: ReplayPortfolioAllocationCycle[]
  global_source_event_queue: ReplayPortfolioAllocationEntryEvent[]
  open_positions: Array<{
    lane_id: string
    symbol: string
    side: "long" | "short"
    quantity: number
    entry_price: number
    entry_notional: number
    isolated_collateral: number
    requested_risk_amount: number
    fill_hash: string
  }>
  rejected_lane_ids: string[]
  total_entry_fees: number
  ending_settled_cash: number
  ending_reserved_isolated_collateral: number
  ending_available_cash: number
  ending_gross_exposure: number
  ending_net_exposure: number
  ending_portfolio_risk: number
  portfolio_nav_at_entry_marks: number
  limitations: [
    "entry_allocation_slice_not_full_lifecycle_portfolio",
    "fixed_entry_notional_and_stop_loss_budget_no_dynamic_mark_revaluation",
    "no_exit_funding_liquidation_cross_margin_partial_fill_resize_or_borrow",
  ]
  result_hash: string
}

export interface ReplayPortfolioAllocationOutcome {
  schema_version: typeof REPLAY_PORTFOLIO_ALLOCATION_OUTCOME_SCHEMA_VERSION
  portfolio_id: string
  portfolio_plan_hash: string
  portfolio_allocation_reservation_hash: string
  status: "completed" | "failed"
  result: ReplayPortfolioAllocationResult | null
  failure: {
    code: "portfolio-allocation-input-invalid" | "portfolio-allocation-engine-failed"
    message: string
    partial_result_published: false
  } | null
  outcome_hash: string
}

export function replayPortfolioAllocationPlanHash(
  value: Omit<ReplayPortfolioAllocationPlan, "plan_hash"> | ReplayPortfolioAllocationPlan,
): string {
  const { plan_hash: _hash, ...body } = value as ReplayPortfolioAllocationPlan
  return canonicalHash(body)
}

export function replayPortfolioAllocationDecisionHash(
  value: Omit<ReplayPortfolioAllocationDecision, "decision_hash"> | ReplayPortfolioAllocationDecision,
): string {
  const { decision_hash: _hash, ...body } = value as ReplayPortfolioAllocationDecision
  return canonicalHash(body)
}

export function replayPortfolioAllocationCycleHash(
  value: Omit<ReplayPortfolioAllocationCycle, "cycle_hash"> | ReplayPortfolioAllocationCycle,
): string {
  const { cycle_hash: _hash, ...body } = value as ReplayPortfolioAllocationCycle
  return canonicalHash(body)
}

export function replayPortfolioAllocationEventHash(
  value: Omit<ReplayPortfolioAllocationEntryEvent, "event_hash"> | ReplayPortfolioAllocationEntryEvent,
): string {
  const { event_hash: _hash, ...body } = value as ReplayPortfolioAllocationEntryEvent
  return canonicalHash(body)
}

export function replayPortfolioAllocationResultHash(
  value: Omit<ReplayPortfolioAllocationResult, "result_hash"> | ReplayPortfolioAllocationResult,
): string {
  const { result_hash: _hash, ...body } = value as ReplayPortfolioAllocationResult
  return canonicalHash(body)
}

export function replayPortfolioAllocationOutcomeHash(
  value: Omit<ReplayPortfolioAllocationOutcome, "outcome_hash"> | ReplayPortfolioAllocationOutcome,
): string {
  const { outcome_hash: _hash, ...body } = value as ReplayPortfolioAllocationOutcome
  return canonicalHash(body)
}

export function assertReplayPortfolioAllocationPlan(value: ReplayPortfolioAllocationPlan): void {
  exact(value, [
    "schema_version", "portfolio_id", "execution_mode", "allocation_scope", "matching_scope",
    "exposure_scope", "risk_budget_scope", "failure_policy", "lanes", "plan_hash",
  ], "Plan")
  if (value.schema_version !== REPLAY_PORTFOLIO_ALLOCATION_PLAN_SCHEMA_VERSION
      || value.execution_mode !== "simultaneous_entry_exposure_risk_budget_allocation_v1"
      || value.allocation_scope !== "entry_slice_collect_same_time_then_allocate_before_fill"
      || value.matching_scope !== "market_next_open_full_fill_or_reject_no_resize"
      || value.exposure_scope !== "fixed_entry_execution_notional_until_slice_end"
      || value.risk_budget_scope !== "fixed_entry_to_frozen_stop_adverse_execution_plus_round_trip_fees"
      || value.failure_policy !== "input_or_engine_failure_no_partial_allocation_result") {
    fail("Plan policy")
  }
  required(value.portfolio_id, "portfolio_id")
  if (value.lanes.length < 2) fail("Plan lane count")
  let previous = ""
  const symbols = new Set<string>()
  const runs = new Set<string>()
  for (const lane of value.lanes) {
    exact(lane, [
      "lane_id", "symbol", "run_id", "request_hash", "trial_reservation_hash", "attempt_lease_hash",
      "side", "quantity", "earliest_executable_time", "stop_price", "isolated_collateral", "fee_bps",
      "slippage_bps", "price_increment", "settlement_increment", "contract_multiplier",
    ], "Plan lane")
    required(lane.lane_id, "lane_id")
    required(lane.symbol, "symbol")
    required(lane.run_id, "run_id")
    digest(lane.request_hash, "request_hash")
    digest(lane.trial_reservation_hash, "trial_reservation_hash")
    digest(lane.attempt_lease_hash, "attempt_lease_hash")
    timestamp(lane.earliest_executable_time, "earliest_executable_time")
    positive(lane.quantity, "quantity")
    positive(lane.stop_price, "stop_price")
    positive(lane.isolated_collateral, "isolated_collateral")
    nonnegative(lane.fee_bps, "fee_bps")
    nonnegative(lane.slippage_bps, "slippage_bps")
    if (lane.contract_multiplier !== "1" || lane.price_increment.trim() === ""
        || lane.settlement_increment.trim() === "" || (lane.side !== "long" && lane.side !== "short")
        || lane.lane_id <= previous || symbols.has(lane.symbol) || runs.has(lane.run_id)) fail("Plan lane identity")
    previous = lane.lane_id
    symbols.add(lane.symbol)
    runs.add(lane.run_id)
  }
  digest(value.plan_hash, "plan_hash")
  if (value.plan_hash !== replayPortfolioAllocationPlanHash(value)) fail("Plan hash")
}

export function assertReplayPortfolioAllocationResult(
  value: ReplayPortfolioAllocationResult,
  plan: ReplayPortfolioAllocationPlan,
  authority: ReplayPortfolioAllocationAuthorityBinding,
): void {
  assertReplayPortfolioAllocationPlan(plan)
  if (value.schema_version !== REPLAY_PORTFOLIO_ALLOCATION_RESULT_SCHEMA_VERSION
      || value.portfolio_id !== plan.portfolio_id || value.portfolio_id !== authority.portfolio_id
      || value.portfolio_plan_hash !== plan.plan_hash || value.portfolio_plan_hash !== authority.portfolio_plan_hash
      || value.portfolio_allocation_reservation_hash !== authority.reservation_hash
      || value.execution_mode !== "simultaneous_entry_exposure_risk_budget_allocation_v1"
      || value.settlement_asset !== authority.settlement_asset || value.shared_initial_cash !== authority.shared_initial_cash
      || value.limits.max_gross_exposure_amount !== authority.max_gross_exposure_amount
      || value.limits.max_abs_net_exposure_amount !== authority.max_abs_net_exposure_amount
      || value.limits.max_portfolio_risk_amount !== authority.max_portfolio_risk_amount) fail("Result authority")
  const rank = new Map(authority.lanes.map((lane) => [lane.lane_id, lane]))
  const planByLane = new Map(plan.lanes.map((lane) => [lane.lane_id, lane]))
  const decisions = new Map<string, ReplayPortfolioAllocationDecision>()
  const decisionCycle = new Map<string, string>()
  let available = value.shared_initial_cash
  let gross = 0
  let net = 0
  let risk = 0
  let allocatedWallet: ReplayRuntimeSharedWalletSnapshot = {
    settled_cash: value.shared_initial_cash,
    reserved_isolated_collateral: 0,
    available_cash: value.shared_initial_cash,
  }
  let previousTime = Number.NEGATIVE_INFINITY
  for (const cycle of value.allocation_cycles) {
    timestamp(cycle.event_time, "cycle event_time")
    if (Date.parse(cycle.event_time) <= previousTime || cycle.allocation_phase !== 19
        || canonicalHash(cycle.opening_wallet) !== canonicalHash(allocatedWallet)
        || cycle.opening_wallet.available_cash !== available || cycle.opening_gross_exposure !== gross
        || cycle.opening_net_exposure !== net || cycle.opening_portfolio_risk !== risk
        || cycle.candidate_set_hash !== canonicalHash(cycle.decisions.map((decision) => ({
          lane_id: decision.lane_id, request_hash: decision.request_hash,
        })))) fail("allocation Cycle opening or candidate set")
    previousTime = Date.parse(cycle.event_time)
    let previousRank = 0
    for (const [index, decision] of cycle.decisions.entries()) {
      const lane = planByLane.get(decision.lane_id)
      const laneAuthority = rank.get(decision.lane_id)
      if (!lane || !laneAuthority || decision.decision_sequence !== index + 1
          || decision.priority_rank !== laneAuthority.priority_rank || decision.priority_rank <= previousRank
          || decision.symbol !== lane.symbol || decision.request_hash !== lane.request_hash
          || decision.position_side !== lane.side || decision.quantity !== lane.quantity
          || decision.decision_hash !== replayPortfolioAllocationDecisionHash(decision)
          || decision.entry_notional <= 0 || decision.requested_risk_amount <= 0
          || decision.price_loss_at_protective_stop <= 0
          || decisions.has(decision.lane_id)) fail("allocation Decision authority or order")
      previousRank = decision.priority_rank
      const candidateGross = add(gross, decision.entry_notional)
      const candidateNet = add(net, decision.signed_entry_notional)
      const candidateRisk = add(risk, decision.requested_risk_amount)
      if (decision.signed_entry_notional !== (decision.position_side === "long"
        ? decision.entry_notional : -decision.entry_notional)
          || decision.requested_risk_amount !== add(
            decision.price_loss_at_protective_stop, decision.entry_fee, decision.protective_stop_exit_fee,
          )
          || decision.required_available_cash !== add(decision.isolated_collateral, decision.entry_fee)
          || decision.candidate_gross_exposure !== candidateGross
          || decision.candidate_net_exposure !== candidateNet
          || decision.candidate_portfolio_risk !== candidateRisk) fail("allocation Decision economics")
      const expectedReason = rejectionReason(decision, available, laneAuthority, authority)
      if ((expectedReason === null) !== (decision.allocation === "admitted")
          || decision.allocation_reason !== (expectedReason ?? "all_limits_satisfied")) fail("allocation Decision gate")
      if (decision.allocation === "admitted") {
        available = add(available, -decision.required_available_cash)
        gross = candidateGross
        net = candidateNet
        risk = candidateRisk
        allocatedWallet = {
          settled_cash: add(allocatedWallet.settled_cash, -decision.entry_fee),
          reserved_isolated_collateral: add(
            allocatedWallet.reserved_isolated_collateral, decision.isolated_collateral,
          ),
          available_cash: available,
        }
      }
      if (decision.allocated_available_cash_after !== available
          || decision.allocated_gross_exposure_after !== gross
          || decision.allocated_net_exposure_after !== net
          || decision.allocated_portfolio_risk_after !== risk) fail("allocation Decision state chain")
      decisions.set(decision.lane_id, decision)
      decisionCycle.set(decision.lane_id, cycle.cycle_hash)
    }
    if (cycle.closing_allocated_available_cash !== available || cycle.closing_gross_exposure !== gross
        || cycle.closing_net_exposure !== net || cycle.closing_portfolio_risk !== risk
        || cycle.cycle_hash !== replayPortfolioAllocationCycleHash(cycle)) fail("allocation Cycle close")
  }
  if (decisions.size !== plan.lanes.length || value.global_source_event_queue.length !== plan.lanes.length) {
    fail("Result lane coverage")
  }
  let wallet: ReplayRuntimeSharedWalletSnapshot = {
    settled_cash: value.shared_initial_cash, reserved_isolated_collateral: 0, available_cash: value.shared_initial_cash,
  }
  const filled: ReplayPortfolioAllocationEntryEvent[] = []
  const rejected: string[] = []
  for (const [index, event] of value.global_source_event_queue.entries()) {
    const decision = decisions.get(event.lane_id)
    const lane = planByLane.get(event.lane_id)
    if (!decision || !lane || event.queue_ordinal !== index + 1
        || event.event_hash !== replayPortfolioAllocationEventHash(event)
        || event.boundary_phase !== 20 || event.source_kind !== "bar_open" || event.event_role !== "entry"
        || event.symbol !== lane.symbol || event.priority_rank !== rank.get(event.lane_id)?.priority_rank
        || event.request_hash !== lane.request_hash || event.position_side !== lane.side
        || event.quantity !== lane.quantity || event.isolated_collateral !== lane.isolated_collateral
        || event.allocation_cycle_hash !== decisionCycle.get(event.lane_id)
        || event.allocation_decision_hash !== decision.decision_hash || event.execution_price !== decision.execution_price
        || event.entry_notional !== decision.entry_notional || event.requested_risk_amount !== decision.requested_risk_amount
        || event.entry_fee !== decision.entry_fee || event.required_available_cash !== decision.required_available_cash
        || canonicalHash(event.wallet_before) !== canonicalHash(wallet)) fail("entry Event binding")
    if (decision.allocation === "admitted") {
      wallet = {
        settled_cash: add(wallet.settled_cash, -event.entry_fee),
        reserved_isolated_collateral: add(wallet.reserved_isolated_collateral, event.isolated_collateral),
        available_cash: add(wallet.available_cash, -event.required_available_cash),
      }
      if (event.admission !== "filled" || event.admission_reason !== "allocation_admitted_and_fill_committed"
          || event.fill_hash === null) fail("admitted entry Event")
      filled.push(event)
    } else {
      if (event.admission !== "rejected" || event.admission_reason !== decision.allocation_reason
          || event.fill_hash !== null) fail("rejected entry Event")
      rejected.push(event.lane_id)
    }
    if (canonicalHash(event.wallet_after) !== canonicalHash(wallet)) fail("entry Event wallet")
  }
  const entryFees = filled.reduce((sum, event) => add(sum, event.entry_fee), 0)
  const reserved = filled.reduce((sum, event) => add(sum, event.isolated_collateral), 0)
  const expectedPositions = filled.map((event) => ({
    lane_id: event.lane_id,
    symbol: event.symbol,
    side: event.position_side,
    quantity: event.quantity,
    entry_price: event.execution_price,
    entry_notional: event.entry_notional,
    isolated_collateral: event.isolated_collateral,
    requested_risk_amount: event.requested_risk_amount,
    fill_hash: event.fill_hash!,
  }))
  if (canonicalHash(value.open_positions) !== canonicalHash(expectedPositions)
      || JSON.stringify(value.rejected_lane_ids) !== JSON.stringify(rejected)
      || value.total_entry_fees !== entryFees || value.ending_settled_cash !== wallet.settled_cash
      || value.ending_reserved_isolated_collateral !== reserved || value.ending_available_cash !== wallet.available_cash
      || value.ending_gross_exposure !== gross || value.ending_net_exposure !== net
      || value.ending_portfolio_risk !== risk || value.portfolio_nav_at_entry_marks !== wallet.settled_cash
      || value.result_hash !== replayPortfolioAllocationResultHash(value)) fail("Result conservation or hash")
  const limitations: ReplayPortfolioAllocationResult["limitations"] = [
    "entry_allocation_slice_not_full_lifecycle_portfolio",
    "fixed_entry_notional_and_stop_loss_budget_no_dynamic_mark_revaluation",
    "no_exit_funding_liquidation_cross_margin_partial_fill_resize_or_borrow",
  ]
  if (JSON.stringify(value.limitations) !== JSON.stringify(limitations)) fail("Result limitations")
}

export function assertReplayPortfolioAllocationOutcome(
  value: ReplayPortfolioAllocationOutcome,
  plan: ReplayPortfolioAllocationPlan,
  authority: ReplayPortfolioAllocationAuthorityBinding,
): void {
  if (value.schema_version !== REPLAY_PORTFOLIO_ALLOCATION_OUTCOME_SCHEMA_VERSION
      || value.portfolio_id !== plan.portfolio_id || value.portfolio_plan_hash !== plan.plan_hash
      || value.portfolio_allocation_reservation_hash !== authority.reservation_hash) fail("Outcome authority")
  if (value.status === "completed") {
    if (!value.result || value.failure !== null) fail("completed Outcome")
    assertReplayPortfolioAllocationResult(value.result, plan, authority)
  } else if (value.result !== null || !value.failure || value.failure.partial_result_published !== false) {
    fail("failed Outcome")
  }
  if (value.outcome_hash !== replayPortfolioAllocationOutcomeHash(value)) fail("Outcome hash")
}

function rejectionReason(
  decision: ReplayPortfolioAllocationDecision,
  available: number,
  lane: { max_lane_risk_amount: number },
  authority: ReplayPortfolioAllocationAuthorityBinding,
): ReplayPortfolioAllocationRejectionReason | null {
  if (decision.requested_risk_amount > lane.max_lane_risk_amount) return "lane_risk_limit_exceeded"
  if (decision.required_available_cash > available) return "insufficient_available_cash"
  if (decision.candidate_gross_exposure > authority.max_gross_exposure_amount) {
    return "gross_exposure_limit_exceeded"
  }
  if (Math.abs(decision.candidate_net_exposure) > authority.max_abs_net_exposure_amount) {
    return "absolute_net_exposure_limit_exceeded"
  }
  if (decision.candidate_portfolio_risk > authority.max_portfolio_risk_amount) {
    return "portfolio_risk_limit_exceeded"
  }
  return null
}

function add(...values: number[]): number {
  return Number(values.reduce((sum, value) => sum + value, 0).toFixed(12))
}

function exact(value: object, fields: string[], label: string): void {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...fields].sort())) fail(`${label} fields`)
}

function digest(value: string, label: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) fail(label)
}

function required(value: string, label: string): void {
  if (value.trim() === "") fail(label)
}

function timestamp(value: string, label: string): void {
  if (!value.endsWith("Z") || !Number.isFinite(Date.parse(value))) fail(label)
}

function positive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) fail(label)
}

function nonnegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) fail(label)
}

function fail(label: string): never {
  throw new Error(`Replay Portfolio Allocation ${label} is invalid`)
}
