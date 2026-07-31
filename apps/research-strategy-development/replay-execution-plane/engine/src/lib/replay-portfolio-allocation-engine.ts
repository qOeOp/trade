import {
  REPLAY_PORTFOLIO_ALLOCATION_RESULT_SCHEMA_VERSION,
  assertReplayPortfolioAllocationPlan,
  assertReplayPortfolioAllocationResult,
  replayPortfolioAllocationCycleHash,
  replayPortfolioAllocationDecisionHash,
  replayPortfolioAllocationEventHash,
  replayPortfolioAllocationResultHash,
  type ReplayPortfolioAllocationAuthorityBinding,
  type ReplayPortfolioAllocationCycle,
  type ReplayPortfolioAllocationDecision,
  type ReplayPortfolioAllocationEntryEvent,
  type ReplayPortfolioAllocationPlan,
  type ReplayPortfolioAllocationRejectionReason,
  type ReplayPortfolioAllocationResult,
} from "../../../contracts/src/lib/replay-portfolio-allocation-contracts"
import { canonicalHash, type ReplayMarketBar } from "../../../contracts/src/lib/replay-contracts"
import {
  addReplayDecimalValues,
  quantizeReplayDifferenceProduct,
  quantizeReplayProduct,
} from "../../../contracts/src/lib/replay-decimal"
import type { ReplayRuntimeSharedWalletSnapshot } from "../../../contracts/src/lib/replay-runtime-shared-wallet-contracts"
import {
  applyAdverseSlippageV3,
  calculateNotionalChargeV3,
} from "../../../accounting/src/lib/replay-accounting"

export interface ReplayPortfolioAllocationEngineLane {
  lane_id: string
  request_hash: string
  symbol: string
  side: "long" | "short"
  quantity: number
  earliest_executable_time: string
  stop_price: number
  isolated_collateral: number
  fee_bps: number
  slippage_bps: number
  price_increment: string
  settlement_increment: string
  bar: ReplayMarketBar
}

export interface ReplayPortfolioAllocationEngineInput {
  plan: ReplayPortfolioAllocationPlan
  authority: ReplayPortfolioAllocationAuthorityBinding
  lanes: ReplayPortfolioAllocationEngineLane[]
}

interface CandidateEconomics {
  lane: ReplayPortfolioAllocationEngineLane
  priority_rank: number
  execution_price: number
  protective_stop_execution_price: number
  entry_notional: number
  signed_entry_notional: number
  entry_fee: number
  protective_stop_exit_fee: number
  price_loss_at_protective_stop: number
  requested_risk_amount: number
  required_available_cash: number
}

export function executeReplayPortfolioAllocationSlice(
  input: ReplayPortfolioAllocationEngineInput,
): ReplayPortfolioAllocationResult {
  assertReplayPortfolioAllocationPlan(input.plan)
  const authorityByLane = new Map(input.authority.lanes.map((lane) => [lane.lane_id, lane]))
  const planByLane = new Map(input.plan.lanes.map((lane) => [lane.lane_id, lane]))
  if (input.authority.portfolio_id !== input.plan.portfolio_id
      || input.authority.portfolio_plan_hash !== input.plan.plan_hash
      || input.lanes.length !== input.plan.lanes.length || authorityByLane.size !== input.plan.lanes.length
      || new Set(input.lanes.map((lane) => lane.lane_id)).size !== input.plan.lanes.length) {
    throw new Error("Portfolio Allocation Engine authority does not bind the Plan")
  }
  for (const lane of input.lanes) validateLane(lane, planByLane.get(lane.lane_id))
  const candidates = input.lanes.map((lane) => economics(lane, authorityByLane.get(lane.lane_id)!.priority_rank))
  const times = [...new Set(candidates.map((candidate) => candidate.lane.earliest_executable_time))]
    .sort((left, right) => Date.parse(left) - Date.parse(right))
  let wallet: ReplayRuntimeSharedWalletSnapshot = {
    settled_cash: input.authority.shared_initial_cash,
    reserved_isolated_collateral: 0,
    available_cash: input.authority.shared_initial_cash,
  }
  let grossExposure = 0
  let netExposure = 0
  let portfolioRisk = 0
  const cycles: ReplayPortfolioAllocationCycle[] = []
  const events: ReplayPortfolioAllocationEntryEvent[] = []
  const openPositions: ReplayPortfolioAllocationResult["open_positions"] = []
  const rejectedLaneIds: string[] = []

  for (const time of times) {
    const current = candidates.filter((candidate) => candidate.lane.earliest_executable_time === time)
      .sort((left, right) => left.priority_rank - right.priority_rank)
    const openingWallet = structuredClone(wallet)
    let allocatedAvailable = wallet.available_cash
    let allocatedGross = grossExposure
    let allocatedNet = netExposure
    let allocatedRisk = portfolioRisk
    const decisions: ReplayPortfolioAllocationDecision[] = []
    for (const [index, candidate] of current.entries()) {
      const candidateGross = addReplayDecimalValues(allocatedGross, candidate.entry_notional)
      const candidateNet = addReplayDecimalValues(allocatedNet, candidate.signed_entry_notional)
      const candidateRisk = addReplayDecimalValues(allocatedRisk, candidate.requested_risk_amount)
      const reason = rejectionReason(input.authority, candidate, allocatedAvailable, candidateGross, candidateNet,
        candidateRisk)
      if (reason === null) {
        allocatedAvailable = addReplayDecimalValues(allocatedAvailable, -candidate.required_available_cash)
        allocatedGross = candidateGross
        allocatedNet = candidateNet
        allocatedRisk = candidateRisk
      }
      const body: Omit<ReplayPortfolioAllocationDecision, "decision_hash"> = {
        decision_sequence: index + 1,
        lane_id: candidate.lane.lane_id,
        symbol: candidate.lane.symbol,
        priority_rank: candidate.priority_rank,
        request_hash: candidate.lane.request_hash,
        execution_price: candidate.execution_price,
        protective_stop_execution_price: candidate.protective_stop_execution_price,
        position_side: candidate.lane.side,
        quantity: candidate.lane.quantity,
        entry_notional: candidate.entry_notional,
        signed_entry_notional: candidate.signed_entry_notional,
        isolated_collateral: candidate.lane.isolated_collateral,
        entry_fee: candidate.entry_fee,
        protective_stop_exit_fee: candidate.protective_stop_exit_fee,
        price_loss_at_protective_stop: candidate.price_loss_at_protective_stop,
        requested_risk_amount: candidate.requested_risk_amount,
        required_available_cash: candidate.required_available_cash,
        candidate_gross_exposure: candidateGross,
        candidate_net_exposure: candidateNet,
        candidate_portfolio_risk: candidateRisk,
        allocation: reason === null ? "admitted" : "rejected",
        allocation_reason: reason ?? "all_limits_satisfied",
        allocated_available_cash_after: allocatedAvailable,
        allocated_gross_exposure_after: allocatedGross,
        allocated_net_exposure_after: allocatedNet,
        allocated_portfolio_risk_after: allocatedRisk,
      }
      decisions.push({ ...body, decision_hash: replayPortfolioAllocationDecisionHash(body as ReplayPortfolioAllocationDecision) })
    }
    const cycleBody: Omit<ReplayPortfolioAllocationCycle, "cycle_hash"> = {
      event_time: time,
      allocation_phase: 19,
      candidate_set_hash: canonicalHash(decisions.map((decision) => ({
        lane_id: decision.lane_id, request_hash: decision.request_hash,
      }))),
      opening_wallet: openingWallet,
      opening_gross_exposure: grossExposure,
      opening_net_exposure: netExposure,
      opening_portfolio_risk: portfolioRisk,
      decisions,
      closing_allocated_available_cash: allocatedAvailable,
      closing_gross_exposure: allocatedGross,
      closing_net_exposure: allocatedNet,
      closing_portfolio_risk: allocatedRisk,
    }
    const cycle = { ...cycleBody, cycle_hash: replayPortfolioAllocationCycleHash(cycleBody as ReplayPortfolioAllocationCycle) }
    cycles.push(cycle)
    for (const decision of decisions) {
      const candidate = current.find((item) => item.lane.lane_id === decision.lane_id)!
      const before = structuredClone(wallet)
      const admitted = decision.allocation === "admitted"
      const fillHash = admitted ? canonicalHash({
        portfolio_id: input.plan.portfolio_id,
        allocation_cycle_hash: cycle.cycle_hash,
        allocation_decision_hash: decision.decision_hash,
        lane_id: decision.lane_id,
        request_hash: decision.request_hash,
        event_time: time,
        side: candidate.lane.side === "long" ? "buy" : "sell",
        quantity: candidate.lane.quantity,
        price: candidate.execution_price,
        fee: candidate.entry_fee,
        reduce_only: false,
      }) : null
      if (admitted) {
        wallet = {
          settled_cash: addReplayDecimalValues(wallet.settled_cash, -candidate.entry_fee),
          reserved_isolated_collateral: addReplayDecimalValues(
            wallet.reserved_isolated_collateral, candidate.lane.isolated_collateral,
          ),
          available_cash: addReplayDecimalValues(wallet.available_cash, -candidate.required_available_cash),
        }
        openPositions.push({
          lane_id: candidate.lane.lane_id,
          symbol: candidate.lane.symbol,
          side: candidate.lane.side,
          quantity: candidate.lane.quantity,
          entry_price: candidate.execution_price,
          entry_notional: candidate.entry_notional,
          isolated_collateral: candidate.lane.isolated_collateral,
          requested_risk_amount: candidate.requested_risk_amount,
          fill_hash: fillHash!,
        })
      } else rejectedLaneIds.push(candidate.lane.lane_id)
      const eventBody: Omit<ReplayPortfolioAllocationEntryEvent, "event_hash"> = {
        queue_ordinal: events.length + 1,
        event_time: time,
        boundary_phase: 20,
        source_kind: "bar_open",
        event_role: "entry",
        lane_id: candidate.lane.lane_id,
        symbol: candidate.lane.symbol,
        priority_rank: candidate.priority_rank,
        request_hash: candidate.lane.request_hash,
        bar_hash: canonicalHash(candidate.lane.bar),
        allocation_cycle_hash: cycle.cycle_hash,
        allocation_decision_hash: decision.decision_hash,
        execution_price: candidate.execution_price,
        position_side: candidate.lane.side,
        quantity: candidate.lane.quantity,
        entry_notional: candidate.entry_notional,
        requested_risk_amount: candidate.requested_risk_amount,
        isolated_collateral: candidate.lane.isolated_collateral,
        entry_fee: candidate.entry_fee,
        required_available_cash: candidate.required_available_cash,
        admission: admitted ? "filled" : "rejected",
        admission_reason: admitted ? "allocation_admitted_and_fill_committed"
          : decision.allocation_reason as ReplayPortfolioAllocationRejectionReason,
        fill_hash: fillHash,
        wallet_before: before,
        wallet_after: structuredClone(wallet),
      }
      events.push({ ...eventBody, event_hash: replayPortfolioAllocationEventHash(eventBody as ReplayPortfolioAllocationEntryEvent) })
    }
    if (wallet.available_cash !== allocatedAvailable) {
      throw new Error("Portfolio Allocation Cycle and Fill cash commit diverged")
    }
    grossExposure = allocatedGross
    netExposure = allocatedNet
    portfolioRisk = allocatedRisk
  }
  const totalEntryFees = events.filter((event) => event.admission === "filled")
    .reduce((sum, event) => addReplayDecimalValues(sum, event.entry_fee), 0)
  const body: Omit<ReplayPortfolioAllocationResult, "result_hash"> = {
    schema_version: REPLAY_PORTFOLIO_ALLOCATION_RESULT_SCHEMA_VERSION,
    portfolio_id: input.plan.portfolio_id,
    portfolio_plan_hash: input.plan.plan_hash,
    portfolio_allocation_reservation_hash: input.authority.reservation_hash,
    execution_mode: "simultaneous_entry_exposure_risk_budget_allocation_v1",
    settlement_asset: input.authority.settlement_asset,
    shared_initial_cash: input.authority.shared_initial_cash,
    limits: {
      max_gross_exposure_amount: input.authority.max_gross_exposure_amount,
      max_abs_net_exposure_amount: input.authority.max_abs_net_exposure_amount,
      max_portfolio_risk_amount: input.authority.max_portfolio_risk_amount,
    },
    allocation_cycles: cycles,
    global_source_event_queue: events,
    open_positions: openPositions,
    rejected_lane_ids: rejectedLaneIds,
    total_entry_fees: totalEntryFees,
    ending_settled_cash: wallet.settled_cash,
    ending_reserved_isolated_collateral: wallet.reserved_isolated_collateral,
    ending_available_cash: wallet.available_cash,
    ending_gross_exposure: grossExposure,
    ending_net_exposure: netExposure,
    ending_portfolio_risk: portfolioRisk,
    portfolio_nav_at_entry_marks: wallet.settled_cash,
    limitations: [
      "entry_allocation_slice_not_full_lifecycle_portfolio",
      "fixed_entry_notional_and_stop_loss_budget_no_dynamic_mark_revaluation",
      "no_exit_funding_liquidation_cross_margin_partial_fill_resize_or_borrow",
    ],
  }
  const result = { ...body, result_hash: replayPortfolioAllocationResultHash(body as ReplayPortfolioAllocationResult) }
  assertReplayPortfolioAllocationResult(result, input.plan, input.authority)
  return result
}

function economics(lane: ReplayPortfolioAllocationEngineLane, priorityRank: number): CandidateEconomics {
  const entrySide = lane.side === "long" ? "buy" : "sell"
  const stopSide = lane.side === "long" ? "sell" : "buy"
  const executionPrice = applyAdverseSlippageV3(lane.bar.open, entrySide, lane.slippage_bps, lane.price_increment)
  const stopExecutionPrice = applyAdverseSlippageV3(lane.stop_price, stopSide, lane.slippage_bps, lane.price_increment)
  if ((lane.side === "long" && stopExecutionPrice >= executionPrice)
      || (lane.side === "short" && stopExecutionPrice <= executionPrice)) {
    throw new Error(`Portfolio Allocation lane ${lane.lane_id} stop is not on the loss side after slippage`)
  }
  const notional = quantizeReplayProduct([executionPrice, lane.quantity], 1, lane.settlement_increment, "ceil")
  const signedNotional = lane.side === "long" ? notional : -notional
  const entryFee = calculateNotionalChargeV3(
    executionPrice, lane.quantity, lane.fee_bps, lane.settlement_increment,
  )
  const stopExitFee = calculateNotionalChargeV3(
    stopExecutionPrice, lane.quantity, lane.fee_bps, lane.settlement_increment,
  )
  const priceLoss = quantizeReplayDifferenceProduct(
    executionPrice, stopExecutionPrice, lane.quantity, lane.side === "long" ? 1 : -1,
    lane.settlement_increment, "ceil",
  )
  return {
    lane,
    priority_rank: priorityRank,
    execution_price: executionPrice,
    protective_stop_execution_price: stopExecutionPrice,
    entry_notional: notional,
    signed_entry_notional: signedNotional,
    entry_fee: entryFee,
    protective_stop_exit_fee: stopExitFee,
    price_loss_at_protective_stop: priceLoss,
    requested_risk_amount: addReplayDecimalValues(priceLoss, entryFee, stopExitFee),
    required_available_cash: addReplayDecimalValues(lane.isolated_collateral, entryFee),
  }
}

function rejectionReason(
  authority: ReplayPortfolioAllocationAuthorityBinding,
  candidate: CandidateEconomics,
  available: number,
  candidateGross: number,
  candidateNet: number,
  candidateRisk: number,
): ReplayPortfolioAllocationRejectionReason | null {
  const laneAuthority = authority.lanes.find((lane) => lane.lane_id === candidate.lane.lane_id)!
  if (candidate.requested_risk_amount > laneAuthority.max_lane_risk_amount) return "lane_risk_limit_exceeded"
  if (candidate.required_available_cash > available) return "insufficient_available_cash"
  if (candidateGross > authority.max_gross_exposure_amount) return "gross_exposure_limit_exceeded"
  if (Math.abs(candidateNet) > authority.max_abs_net_exposure_amount) {
    return "absolute_net_exposure_limit_exceeded"
  }
  if (candidateRisk > authority.max_portfolio_risk_amount) return "portfolio_risk_limit_exceeded"
  return null
}

function validateLane(
  lane: ReplayPortfolioAllocationEngineLane,
  plan: ReplayPortfolioAllocationPlan["lanes"][number] | undefined,
): void {
  if (!plan || plan.request_hash !== lane.request_hash || plan.symbol !== lane.symbol || plan.side !== lane.side
      || plan.quantity !== lane.quantity || plan.earliest_executable_time !== lane.earliest_executable_time
      || plan.stop_price !== lane.stop_price || plan.isolated_collateral !== lane.isolated_collateral
      || plan.fee_bps !== lane.fee_bps || plan.slippage_bps !== lane.slippage_bps
      || plan.price_increment !== lane.price_increment || plan.settlement_increment !== lane.settlement_increment
      || lane.bar.open_time !== lane.earliest_executable_time || lane.bar.closed !== true
      || !Number.isFinite(lane.bar.open) || lane.bar.open <= 0) {
    throw new Error(`Portfolio Allocation lane ${lane.lane_id} does not bind the Plan`)
  }
}
