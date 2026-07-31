import {
  REPLAY_RUNTIME_SHARED_WALLET_RISK_RESULT_SCHEMA_VERSION,
  assertReplayRuntimeSharedWalletRiskPlan,
  assertReplayRuntimeSharedWalletRiskResult,
  replayRuntimeSharedWalletRiskEventHash,
  replayRuntimeSharedWalletRiskResultHash,
  type ReplayRuntimeSharedWalletRiskClosedPosition,
  type ReplayRuntimeSharedWalletRiskEntryEvent,
  type ReplayRuntimeSharedWalletRiskExitEvent,
  type ReplayRuntimeSharedWalletRiskLiquidationEvent,
  type ReplayRuntimeSharedWalletRiskObservationEvent,
  type ReplayRuntimeSharedWalletRiskPlan,
  type ReplayRuntimeSharedWalletRiskPosition,
  type ReplayRuntimeSharedWalletRiskQueueEvent,
  type ReplayRuntimeSharedWalletRiskResult,
} from "../../../contracts/src/lib/replay-runtime-shared-wallet-risk-contracts"
import type { ReplayPortfolioAllocationResult } from "../../../contracts/src/lib/replay-portfolio-allocation-contracts"
import {
  replayRuntimeSharedWalletFundingEventHash,
  type ReplayRuntimeSharedWalletFundingEvent,
} from "../../../contracts/src/lib/replay-runtime-shared-wallet-funding-contracts"
import type {
  ReplayRuntimeSharedWalletAuthorityBinding,
  ReplayRuntimeSharedWalletSnapshot,
} from "../../../contracts/src/lib/replay-runtime-shared-wallet-contracts"
import {
  canonicalHash,
  type ReplayFundingEvent,
  type ReplayInstrumentStatusSnapshot,
  type ReplayMarkEvent,
  type ReplayMarketBar,
  type ReplayVenueRiskPolicySnapshot,
} from "../../../contracts/src/lib/replay-contracts"
import {
  addReplayDecimalValues,
  isReplayIncrementAligned,
  quantizeReplayDifferenceProduct,
  quantizeReplayProduct,
} from "../../../contracts/src/lib/replay-decimal"
import {
  applyAdverseSlippageV3,
  calculateFundingCashflowV3,
  calculateNotionalChargeV3,
} from "../../../accounting/src/lib/replay-accounting"

export interface ReplayRuntimeSharedWalletRiskEngineLane {
  lane_id: string
  request_hash: string
  symbol: string
  side: "long" | "short"
  quantity: number
  entry_time: string
  entry_bar: ReplayMarketBar
  exit: { time: string; intent_hash: string; bar: ReplayMarketBar } | null
  cancelled_exit?: { time: string; intent_hash: string; cancel_time: string; cancel_intent_hash: string } | null
  funding_events: ReplayFundingEvent[]
  mark_events: ReplayMarkEvent[]
  venue_risk_policy_epochs: ReplayVenueRiskPolicySnapshot[]
  instrument_status_epochs: ReplayInstrumentStatusSnapshot[]
  isolated_collateral: number
  fee_bps: number
  slippage_bps: number
  price_increment: string
  settlement_increment: string
}

export interface ReplayRuntimeSharedWalletRiskEngineInput {
  plan: ReplayRuntimeSharedWalletRiskPlan
  authority: ReplayRuntimeSharedWalletAuthorityBinding
  lanes: ReplayRuntimeSharedWalletRiskEngineLane[]
  allocation_result?: ReplayPortfolioAllocationResult
}

interface ActivePosition extends ReplayRuntimeSharedWalletRiskPosition {
  entry_fee: number
}

export function executeReplayRuntimeSharedWalletRiskSlice(
  input: ReplayRuntimeSharedWalletRiskEngineInput,
): ReplayRuntimeSharedWalletRiskResult {
  assertReplayRuntimeSharedWalletRiskPlan(input.plan)
  const planByLane = new Map(input.plan.lanes.map((lane) => [lane.lane_id, lane]))
  const rankByLane = new Map(input.authority.lanes.map((lane) => [lane.lane_id, lane.priority_rank]))
  if (input.authority.portfolio_id !== input.plan.portfolio_id
      || input.authority.portfolio_plan_hash !== input.plan.plan_hash
      || input.lanes.length !== input.plan.lanes.length
      || new Set(input.lanes.map((lane) => lane.lane_id)).size !== input.plan.lanes.length
      || rankByLane.size !== input.plan.lanes.length) {
    throw new Error("runtime shared wallet risk Engine authority does not bind the Plan")
  }
  for (const lane of input.lanes) validateLane(lane, planByLane.get(lane.lane_id))
  const times = [...new Set(input.lanes.flatMap((lane) => [
    lane.entry_time,
    ...(lane.exit ? [lane.exit.time] : []),
    ...lane.funding_events.map((event) => event.timestamp),
    ...lane.mark_events.map((event) => event.timestamp),
  ]))].sort((left, right) => Date.parse(left) - Date.parse(right))
  const orderedLanes = [...input.lanes].sort(
    (left, right) => rankByLane.get(left.lane_id)! - rankByLane.get(right.lane_id)!,
  )
  let wallet: ReplayRuntimeSharedWalletSnapshot = {
    settled_cash: input.authority.shared_initial_cash,
    reserved_isolated_collateral: 0,
    available_cash: input.authority.shared_initial_cash,
  }
  const positions = new Map<string, ActivePosition>()
  const closed: ReplayRuntimeSharedWalletRiskClosedPosition[] = []
  const rejected: string[] = []
  const events: ReplayRuntimeSharedWalletRiskQueueEvent[] = []
  const fundingIndex = new Map<string, number>()
  const markIndex = new Map<string, number>()
  const allocationEvents = input.allocation_result === undefined ? null : new Map(
    input.allocation_result.global_source_event_queue.map((event) => [`${event.lane_id}\u0000${event.event_time}`, event]),
  )

  const append = <T extends ReplayRuntimeSharedWalletRiskQueueEvent>(event: Omit<T, "event_hash" | "queue_ordinal">): T => {
    const body = { ...event, queue_ordinal: events.length + 1 }
    const completed = event.event_role === "funding"
      ? { ...body, event_hash: replayRuntimeSharedWalletFundingEventHash(
        body as unknown as Omit<ReplayRuntimeSharedWalletFundingEvent, "event_hash">,
      ) }
      : { ...body, event_hash: replayRuntimeSharedWalletRiskEventHash(body as Omit<ReplayRuntimeSharedWalletRiskQueueEvent, "event_hash">) }
    events.push(completed as T)
    return completed as T
  }

  for (const time of times) {
    for (const lane of orderedLanes) {
      const index = fundingIndex.get(lane.lane_id) ?? 0
      const funding = lane.funding_events[index]
      if (!funding || funding.timestamp !== time) continue
      const active = positions.get(lane.lane_id)
      const cashflow = active
        ? calculateFundingCashflowV3(
          funding.mark_price, active.quantity, funding.rate, active.side, lane.settlement_increment,
        )
        : 0
      const before = structuredClone(wallet)
      if (active) {
        const next = {
          settled_cash: addReplayDecimalValues(wallet.settled_cash, cashflow),
          reserved_isolated_collateral: wallet.reserved_isolated_collateral,
          available_cash: addReplayDecimalValues(wallet.available_cash, cashflow),
        }
        if (next.settled_cash < 0 || next.available_cash < 0) {
          throw new Error("runtime shared wallet risk funding creates an unsupported cash deficit")
        }
        wallet = next
        active.attributed_settled_cashflow = addReplayDecimalValues(active.attributed_settled_cashflow, cashflow)
      }
      append<ReplayRuntimeSharedWalletFundingEvent>({
        event_time: time, boundary_phase: 10, source_kind: "funding", event_role: "funding", event_role_rank: 0,
        lane_id: lane.lane_id, symbol: lane.symbol, priority_rank: rankByLane.get(lane.lane_id)!,
        request_hash: lane.request_hash, funding_event_index: index, funding_event_hash: canonicalHash(funding),
        rate: funding.rate, mark_price: funding.mark_price, position_side: active?.side ?? null,
        quantity: active?.quantity ?? 0, funding_cashflow: cashflow, outcome: active ? "applied" : "not_reached",
        outcome_reason: active ? "position_open_t_minus" : "no_open_position_t_minus",
        wallet_before: before, wallet_after: structuredClone(wallet),
      })
      fundingIndex.set(lane.lane_id, index + 1)
    }

    const breached: Array<{
      lane: ReplayRuntimeSharedWalletRiskEngineLane
      position: ActivePosition
      observation: ReplayRuntimeSharedWalletRiskObservationEvent
      risk: ReplayVenueRiskPolicySnapshot
    }> = []
    for (const lane of orderedLanes) {
      const index = markIndex.get(lane.lane_id) ?? 0
      const mark = lane.mark_events[index]
      if (!mark || mark.timestamp !== time) continue
      const before = structuredClone(wallet)
      const active = positions.get(lane.lane_id)
      const risk = resolveRisk(lane.venue_risk_policy_epochs, time)
      let unrealized = 0
      let notional = 0
      let marginBalance = 0
      let maintenance = 0
      let headroom = 0
      if (active) {
        unrealized = quantizeReplayDifferenceProduct(
          mark.mark_price, active.entry_price, active.quantity, active.side === "long" ? 1 : -1,
          lane.settlement_increment, "floor",
        )
        notional = quantizeReplayProduct(
          [mark.mark_price, active.quantity], 1, lane.settlement_increment, "ceil",
        )
        assertTier(notional, risk)
        maintenance = Math.max(0, addReplayDecimalValues(
          quantizeReplayProduct(
            [notional, risk.maintenance_tier.maintenance_margin_rate], 1, lane.settlement_increment, "ceil",
          ),
          -risk.maintenance_tier.maintenance_amount,
        ))
        marginBalance = addReplayDecimalValues(
          active.isolated_collateral, active.attributed_settled_cashflow, unrealized,
        )
        headroom = addReplayDecimalValues(marginBalance, -maintenance)
        active.last_exact_mark_price = mark.mark_price
        active.unrealized_pnl = unrealized
      }
      const isBreached = active !== undefined && headroom < 0
      const observation = append<ReplayRuntimeSharedWalletRiskObservationEvent>({
        event_time: time, boundary_phase: 15, source_kind: "mark", event_role: "risk_observation",
        event_role_rank: 1, lane_id: lane.lane_id, symbol: lane.symbol,
        priority_rank: rankByLane.get(lane.lane_id)!, request_hash: lane.request_hash,
        mark_event_index: index, mark_event_hash: canonicalHash(mark), available_at: mark.available_at,
        source_sequence: mark.source_sequence, mark_price: mark.mark_price,
        venue_risk_policy_snapshot: structuredClone(risk), venue_risk_policy_snapshot_hash: canonicalHash(risk),
        position_side: active?.side ?? null, quantity: active?.quantity ?? 0,
        entry_price: active?.entry_price ?? null, isolated_collateral: active?.isolated_collateral ?? 0,
        attributed_settled_cashflow: active?.attributed_settled_cashflow ?? 0,
        unrealized_pnl: unrealized, notional, margin_balance: marginBalance,
        maintenance_margin_requirement: maintenance, maintenance_margin_headroom: headroom,
        outcome: active ? isBreached ? "maintenance_breached" : "healthy" : "not_reached",
        outcome_reason: active ? isBreached ? "full_liquidation_required" : "maintenance_sufficient" : "no_open_position",
        wallet_before: before, wallet_after: structuredClone(wallet),
      })
      markIndex.set(lane.lane_id, index + 1)
      if (active && isBreached) breached.push({ lane, position: active, observation, risk })
    }

    for (const item of breached) {
      const { lane, position, observation, risk } = item
      if (resolveStatus(lane.instrument_status_epochs, time).status !== "trading") {
        throw new Error("runtime shared wallet risk cannot synthesize liquidation while instrument is halted")
      }
      const side = position.side === "long" ? "sell" : "buy"
      const executionPrice = applyAdverseSlippageV3(
        observation.mark_price, side, lane.slippage_bps, lane.price_increment,
      )
      const realized = quantizeReplayDifferenceProduct(
        executionPrice, position.entry_price, position.quantity, position.side === "long" ? 1 : -1,
        lane.settlement_increment, "floor",
      )
      const tradingFee = calculateNotionalChargeV3(
        executionPrice, position.quantity, lane.fee_bps, lane.settlement_increment,
      )
      const liquidationFee = calculateNotionalChargeV3(
        executionPrice, position.quantity, risk.liquidation_fee_bps, lane.settlement_increment,
      )
      const remainingCollateral = addReplayDecimalValues(
        position.isolated_collateral, position.attributed_settled_cashflow, realized, -tradingFee, -liquidationFee,
      )
      if (remainingCollateral < 0) {
        throw new Error("runtime shared wallet exact liquidation leaves an unsupported isolated deficit")
      }
      const before = structuredClone(wallet)
      const next = {
        settled_cash: addReplayDecimalValues(wallet.settled_cash, realized, -tradingFee, -liquidationFee),
        reserved_isolated_collateral: addReplayDecimalValues(
          wallet.reserved_isolated_collateral, -position.isolated_collateral,
        ),
        available_cash: addReplayDecimalValues(
          wallet.available_cash, position.isolated_collateral, realized, -tradingFee, -liquidationFee,
        ),
      }
      if (next.settled_cash < 0 || next.reserved_isolated_collateral < 0 || next.available_cash < 0) {
        throw new Error("runtime shared wallet liquidation creates an unsupported wallet deficit")
      }
      wallet = next
      const fillHash = canonicalHash({
        lane_id: lane.lane_id, request_hash: lane.request_hash, event_role: "liquidation", event_time: time,
        side, quantity: position.quantity, trigger_mark_price: observation.mark_price, price: executionPrice,
        trading_fee: tradingFee, liquidation_fee: liquidationFee, reduce_only: true,
      })
      append<ReplayRuntimeSharedWalletRiskLiquidationEvent>({
        event_time: time, boundary_phase: 15, source_kind: "mark", event_role: "liquidation", event_role_rank: 2,
        lane_id: lane.lane_id, symbol: lane.symbol, priority_rank: rankByLane.get(lane.lane_id)!,
        request_hash: lane.request_hash, trigger_risk_event_hash: observation.event_hash,
        venue_risk_policy_snapshot_hash: canonicalHash(risk), position_side: position.side,
        quantity: position.quantity, trigger_mark_price: observation.mark_price, execution_price: executionPrice,
        isolated_collateral: position.isolated_collateral,
        attributed_settled_cashflow_before_liquidation: position.attributed_settled_cashflow,
        realized_pnl: realized, trading_fee: tradingFee, liquidation_fee: liquidationFee,
        released_collateral: position.isolated_collateral, entry_fill_hash: position.entry_fill_hash,
        fill_hash: fillHash, outcome: "filled", outcome_reason: "exact_maintenance_breach_forced_full_close",
        settlement_state: "flat_without_deficit", wallet_before: before, wallet_after: structuredClone(wallet),
      })
      closed.push({
        lane_id: position.lane_id, symbol: position.symbol, side: position.side, quantity: position.quantity,
        entry_price: position.entry_price, isolated_collateral: position.isolated_collateral,
        entry_fill_hash: position.entry_fill_hash, exit_role: "liquidation", exit_price: executionPrice,
        exit_fill_hash: fillHash, realized_pnl: realized, entry_fee: position.entry_fee,
        exit_trading_fee: tradingFee, liquidation_fee: liquidationFee,
      })
      positions.delete(lane.lane_id)
    }

    for (const lane of orderedLanes) {
      if (lane.exit?.time !== time) continue
      const before = structuredClone(wallet)
      const active = positions.get(lane.lane_id)
      const side = lane.side === "long" ? "sell" : "buy"
      const price = applyAdverseSlippageV3(lane.exit.bar.open, side, lane.slippage_bps, lane.price_increment)
      let fee = 0
      let realized = 0
      let released = 0
      let fillHash: string | null = null
      if (active) {
        fee = calculateNotionalChargeV3(price, active.quantity, lane.fee_bps, lane.settlement_increment)
        realized = quantizeReplayDifferenceProduct(
          price, active.entry_price, active.quantity, active.side === "long" ? 1 : -1,
          lane.settlement_increment, "floor",
        )
        released = active.isolated_collateral
        const next = {
          settled_cash: addReplayDecimalValues(wallet.settled_cash, realized, -fee),
          reserved_isolated_collateral: addReplayDecimalValues(wallet.reserved_isolated_collateral, -released),
          available_cash: addReplayDecimalValues(wallet.available_cash, released, realized, -fee),
        }
        if (next.settled_cash < 0 || next.reserved_isolated_collateral < 0 || next.available_cash < 0) {
          throw new Error("runtime shared wallet risk strategy exit creates an unsupported cash deficit")
        }
        wallet = next
        fillHash = canonicalHash({
          lane_id: lane.lane_id, request_hash: lane.request_hash, event_role: "exit", event_time: time,
          side, quantity: active.quantity, price, fee, realized_pnl: realized, reduce_only: true,
        })
        closed.push({
          lane_id: active.lane_id, symbol: active.symbol, side: active.side, quantity: active.quantity,
          entry_price: active.entry_price, isolated_collateral: active.isolated_collateral,
          entry_fill_hash: active.entry_fill_hash, exit_role: "strategy_exit", exit_price: price,
          exit_fill_hash: fillHash, realized_pnl: realized, entry_fee: active.entry_fee,
          exit_trading_fee: fee, liquidation_fee: 0,
        })
        positions.delete(lane.lane_id)
      }
      append<ReplayRuntimeSharedWalletRiskExitEvent>({
        event_time: time, boundary_phase: 20, source_kind: "bar_open", event_role: "exit", event_role_rank: 3,
        lane_id: lane.lane_id, symbol: lane.symbol, priority_rank: rankByLane.get(lane.lane_id)!,
        request_hash: lane.request_hash, bar_hash: canonicalHash(lane.exit.bar), position_side: lane.side,
        execution_price: price, quantity: lane.quantity, isolated_collateral: lane.isolated_collateral,
        fee, required_available_cash: 0, outcome: active ? "filled" : "not_reached",
        outcome_reason: active ? "realized_pnl_fee_and_collateral_release_committed" : "no_open_position_after_risk",
        fill_hash: fillHash, realized_pnl: realized, released_collateral: released,
        wallet_before: before, wallet_after: structuredClone(wallet),
      })
    }

    for (const lane of orderedLanes) {
      if (lane.entry_time !== time) continue
      const before = structuredClone(wallet)
      const side = lane.side === "long" ? "buy" : "sell"
      const price = applyAdverseSlippageV3(lane.entry_bar.open, side, lane.slippage_bps, lane.price_increment)
      const fee = calculateNotionalChargeV3(price, lane.quantity, lane.fee_bps, lane.settlement_increment)
      const risk = resolveRisk(lane.venue_risk_policy_epochs, time)
      const notional = quantizeReplayProduct([price, lane.quantity], 1, lane.settlement_increment, "ceil")
      assertTier(notional, risk)
      const initialMargin = quantizeReplayProduct(
        [notional, risk.initial_margin_rate], 1, lane.settlement_increment, "ceil",
      )
      if (lane.isolated_collateral < initialMargin) {
        throw new Error("runtime shared wallet risk entry has an initial margin deficit without resize")
      }
      const requiredCash = addReplayDecimalValues(lane.isolated_collateral, fee)
      const allocationEvent = allocationEvents?.get(`${lane.lane_id}\u0000${time}`)
      if (allocationEvents && !allocationEvent) {
        throw new Error("runtime shared wallet integrated entry lacks Allocation decision")
      }
      const admitted = allocationEvent ? allocationEvent.admission === "filled" : wallet.available_cash >= requiredCash
      const fillHash = allocationEvent ? allocationEvent.fill_hash : admitted ? canonicalHash({
        lane_id: lane.lane_id, request_hash: lane.request_hash, event_role: "entry", event_time: time,
        side, quantity: lane.quantity, price, fee, reduce_only: false,
      }) : null
      if (admitted) {
        wallet = {
          settled_cash: addReplayDecimalValues(wallet.settled_cash, -fee),
          reserved_isolated_collateral: addReplayDecimalValues(
            wallet.reserved_isolated_collateral, lane.isolated_collateral,
          ),
          available_cash: addReplayDecimalValues(wallet.available_cash, -requiredCash),
        }
        positions.set(lane.lane_id, {
          lane_id: lane.lane_id, symbol: lane.symbol, side: lane.side, quantity: lane.quantity,
          entry_price: price, isolated_collateral: lane.isolated_collateral, entry_fill_hash: fillHash!,
          attributed_settled_cashflow: -fee, last_exact_mark_price: price, unrealized_pnl: 0, entry_fee: fee,
        })
      } else rejected.push(lane.lane_id)
      append<ReplayRuntimeSharedWalletRiskEntryEvent>({
        event_time: time, boundary_phase: 20, source_kind: "bar_open", event_role: "entry", event_role_rank: 4,
        lane_id: lane.lane_id, symbol: lane.symbol, priority_rank: rankByLane.get(lane.lane_id)!,
        request_hash: lane.request_hash, bar_hash: canonicalHash(lane.entry_bar), position_side: lane.side,
        execution_price: price, quantity: lane.quantity, isolated_collateral: lane.isolated_collateral,
        fee, required_available_cash: requiredCash, outcome: admitted ? "filled" : "rejected",
        outcome_reason: allocationEvent ? allocationEvent.admission_reason
          : admitted ? "cash_reserved_and_fill_committed" : "insufficient_available_cash",
        fill_hash: fillHash, realized_pnl: 0, released_collateral: 0,
        wallet_before: before, wallet_after: structuredClone(wallet),
      })
    }
  }

  const open = [...positions.values()].map(({ entry_fee: _fee, ...position }) => position)
  const entryFees = events.reduce((total, event) => event.event_role === "entry" && event.outcome === "filled"
    ? addReplayDecimalValues(total, event.fee) : total, 0)
  const strategyExitFees = events.reduce((total, event) => event.event_role === "exit" && event.outcome === "filled"
    ? addReplayDecimalValues(total, event.fee) : total, 0)
  const liquidationTradingFees = events.reduce((total, event) => event.event_role === "liquidation"
    ? addReplayDecimalValues(total, event.trading_fee) : total, 0)
  const liquidationFees = events.reduce((total, event) => event.event_role === "liquidation"
    ? addReplayDecimalValues(total, event.liquidation_fee) : total, 0)
  const realized = closed.reduce((total, position) => addReplayDecimalValues(total, position.realized_pnl), 0)
  const funding = events.reduce((total, event) => event.event_role === "funding" && event.outcome === "applied"
    ? addReplayDecimalValues(total, event.funding_cashflow) : total, 0)
  const endingUnrealized = open.reduce((total, position) => addReplayDecimalValues(total, position.unrealized_pnl), 0)
  const body: Omit<ReplayRuntimeSharedWalletRiskResult, "result_hash"> = {
    schema_version: REPLAY_RUNTIME_SHARED_WALLET_RISK_RESULT_SCHEMA_VERSION,
    portfolio_id: input.plan.portfolio_id,
    portfolio_plan_hash: input.plan.plan_hash,
    risk_reservation_hash: input.authority.reservation_hash,
    execution_mode: "runtime_shared_wallet_exact_risk_full_liquidation_v1",
    settlement_asset: input.authority.settlement_asset,
    shared_initial_cash: input.authority.shared_initial_cash,
    global_source_event_queue: events,
    open_positions: open,
    closed_positions: closed,
    rejected_lane_ids: rejected,
    total_entry_fees: entryFees,
    total_strategy_exit_fees: strategyExitFees,
    total_liquidation_trading_fees: liquidationTradingFees,
    total_liquidation_fees: liquidationFees,
    total_realized_pnl: realized,
    total_funding_cashflow: funding,
    ending_unrealized_pnl: endingUnrealized,
    ending_settled_cash: wallet.settled_cash,
    ending_reserved_isolated_collateral: wallet.reserved_isolated_collateral,
    ending_available_cash: wallet.available_cash,
    ending_portfolio_nav: addReplayDecimalValues(wallet.settled_cash, endingUnrealized),
    exact_mark_observation_count: events.filter((event) => event.event_role === "risk_observation").length,
    liquidation_count: events.filter((event) => event.event_role === "liquidation").length,
    limitations: [
      "complete_exact_mark_grid_and_simulated_trigger_mark_full_close_only",
      "isolated_margin_no_cross_margin_partial_liquidation_borrow_insurance_or_adl",
      "liquidation_execution_is_model_evidence_not_exchange_trade_reconstruction",
    ],
  }
  const result = { ...body, result_hash: replayRuntimeSharedWalletRiskResultHash(body) }
  assertReplayRuntimeSharedWalletRiskResult(result, input.plan, input.authority, input.allocation_result)
  return result
}

function validateLane(
  lane: ReplayRuntimeSharedWalletRiskEngineLane,
  plan: ReplayRuntimeSharedWalletRiskPlan["lanes"][number] | undefined,
): void {
  let priorFunding = Number.NEGATIVE_INFINITY
  const fundingValid = lane.funding_events.every((event) => {
    const time = Date.parse(event.timestamp)
    const valid = utc(event.timestamp) && time > priorFunding && Number.isFinite(event.rate)
      && Number.isFinite(event.mark_price) && event.mark_price > 0
    priorFunding = time
    return valid
  })
  let priorMark = Number.NEGATIVE_INFINITY
  let priorSequence = -1
  const markValid = lane.mark_events.every((event) => {
    const time = Date.parse(event.timestamp)
    const valid = utc(event.timestamp) && event.available_at === event.timestamp && time > priorMark
      && Number.isSafeInteger(event.source_sequence) && event.source_sequence > priorSequence
      && Number.isFinite(event.mark_price) && event.mark_price > 0
      && isReplayIncrementAligned(event.mark_price, lane.price_increment)
    priorMark = time
    priorSequence = event.source_sequence
    return valid
  })
  if (!plan || plan.symbol !== lane.symbol || plan.request_hash !== lane.request_hash
      || plan.price_increment !== lane.price_increment || plan.settlement_increment !== lane.settlement_increment
      || plan.fee_bps !== lane.fee_bps || plan.slippage_bps !== lane.slippage_bps
      || plan.funding_event_count !== lane.funding_events.length
      || plan.funding_events_hash !== canonicalHash(lane.funding_events)
      || plan.mark_event_count !== lane.mark_events.length || plan.mark_events_hash !== canonicalHash(lane.mark_events)
      || plan.venue_risk_policy_epochs_hash !== canonicalHash(lane.venue_risk_policy_epochs)
      || plan.instrument_status_epochs_hash !== canonicalHash(lane.instrument_status_epochs)
      || (plan.scheduled_exit_time !== lane.exit?.time
        && plan.scheduled_exit_time !== lane.cancelled_exit?.time
        && !(plan.scheduled_exit_time === null && lane.exit === null && lane.cancelled_exit == null))
      || (plan.exit_intent_hash !== lane.exit?.intent_hash
        && plan.exit_intent_hash !== lane.cancelled_exit?.intent_hash
        && !(plan.exit_intent_hash === null && lane.exit === null && lane.cancelled_exit == null))
      || !fundingValid || !markValid || lane.mark_events.length === 0
      || Date.parse(lane.mark_events.at(-1)!.timestamp) <= Date.parse(lane.entry_time)
      || lane.entry_bar.open_time !== lane.entry_time || lane.entry_bar.closed !== true
      || lane.exit && (lane.exit.bar.open_time !== lane.exit.time || lane.exit.bar.closed !== true
        || Date.parse(lane.exit.time) <= Date.parse(lane.entry_time))
      || lane.cancelled_exit && (lane.exit !== null || !utc(lane.cancelled_exit.cancel_time)
        || !/^[a-f0-9]{64}$/.test(lane.cancelled_exit.cancel_intent_hash)
        || Date.parse(lane.cancelled_exit.cancel_time) >= Date.parse(lane.cancelled_exit.time)
        || Date.parse(lane.cancelled_exit.cancel_time) <= Date.parse(lane.entry_time))
      || !Number.isFinite(lane.quantity) || lane.quantity <= 0
      || !Number.isFinite(lane.isolated_collateral) || lane.isolated_collateral <= 0
      || !Number.isFinite(lane.fee_bps) || lane.fee_bps < 0
      || !Number.isFinite(lane.slippage_bps) || lane.slippage_bps < 0) {
    throw new Error(`runtime shared wallet risk lane ${lane.lane_id} is invalid`)
  }
}

function resolveRisk(schedule: ReplayVenueRiskPolicySnapshot[], time: string): ReplayVenueRiskPolicySnapshot {
  const at = Date.parse(time)
  const snapshot = schedule.find((candidate) => Date.parse(candidate.effective_at) <= at
    && (candidate.valid_until === null || at < Date.parse(candidate.valid_until)))
  if (!snapshot) throw new Error(`runtime shared wallet risk schedule has no epoch at ${time}`)
  return snapshot
}

function resolveStatus(schedule: ReplayInstrumentStatusSnapshot[], time: string): ReplayInstrumentStatusSnapshot {
  const at = Date.parse(time)
  const snapshot = schedule.find((candidate) => Date.parse(candidate.effective_at) <= at
    && (candidate.valid_until === null || at < Date.parse(candidate.valid_until)))
  if (!snapshot) throw new Error(`runtime shared wallet status schedule has no epoch at ${time}`)
  return snapshot
}

function assertTier(notional: number, risk: ReplayVenueRiskPolicySnapshot): void {
  const tier = risk.maintenance_tier
  if (notional < tier.notional_floor || (tier.notional_cap !== null && notional >= tier.notional_cap)) {
    throw new Error("runtime shared wallet notional is outside the frozen maintenance tier")
  }
}

function utc(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
    && Number.isFinite(Date.parse(value))
}
