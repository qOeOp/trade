import {
  REPLAY_RUNTIME_SHARED_WALLET_FUNDING_RESULT_SCHEMA_VERSION,
  assertReplayRuntimeSharedWalletFundingPlan,
  assertReplayRuntimeSharedWalletFundingResult,
  replayRuntimeSharedWalletFundingEventHash,
  replayRuntimeSharedWalletFundingResultHash,
  type ReplayRuntimeSharedWalletFundingEvent,
  type ReplayRuntimeSharedWalletFundingPlan,
  type ReplayRuntimeSharedWalletFundingQueueEvent,
  type ReplayRuntimeSharedWalletFundingResult,
} from "../../../contracts/src/lib/replay-runtime-shared-wallet-funding-contracts"
import {
  replayRuntimeSharedWalletLifecycleEventHash,
  type ReplayRuntimeSharedWalletLifecycleClosedPosition,
  type ReplayRuntimeSharedWalletLifecycleEvent,
  type ReplayRuntimeSharedWalletLifecycleEventBody,
  type ReplayRuntimeSharedWalletLifecyclePosition,
} from "../../../contracts/src/lib/replay-runtime-shared-wallet-lifecycle-contracts"
import type {
  ReplayRuntimeSharedWalletAuthorityBinding,
  ReplayRuntimeSharedWalletSnapshot,
} from "../../../contracts/src/lib/replay-runtime-shared-wallet-contracts"
import { canonicalHash, type ReplayFundingEvent, type ReplayMarketBar } from "../../../contracts/src/lib/replay-contracts"
import { addReplayDecimalValues, quantizeReplayDifferenceProduct } from "../../../contracts/src/lib/replay-decimal"
import {
  applyAdverseSlippageV3,
  calculateFundingCashflowV3,
  calculateNotionalChargeV3,
} from "../../../accounting/src/lib/replay-accounting"

export interface ReplayRuntimeSharedWalletFundingEngineLane {
  lane_id: string
  request_hash: string
  symbol: string
  side: "long" | "short"
  quantity: number
  entry_time: string
  entry_bar: ReplayMarketBar
  exit: { time: string; intent_hash: string; bar: ReplayMarketBar } | null
  funding_events: ReplayFundingEvent[]
  isolated_collateral: number
  fee_bps: number
  slippage_bps: number
  price_increment: string
  settlement_increment: string
}

export interface ReplayRuntimeSharedWalletFundingEngineInput {
  plan: ReplayRuntimeSharedWalletFundingPlan
  authority: ReplayRuntimeSharedWalletAuthorityBinding
  lanes: ReplayRuntimeSharedWalletFundingEngineLane[]
}

interface ActivePosition extends ReplayRuntimeSharedWalletLifecyclePosition {
  entry_fee: number
}

type QueueItem = {
  role: "entry" | "exit" | "funding"
  roleRank: 0 | 1 | 2
  time: string
  lane: ReplayRuntimeSharedWalletFundingEngineLane
  bar?: ReplayMarketBar
  funding?: ReplayFundingEvent
  fundingIndex?: number
}

export function executeReplayRuntimeSharedWalletFundingSlice(
  input: ReplayRuntimeSharedWalletFundingEngineInput,
): ReplayRuntimeSharedWalletFundingResult {
  assertReplayRuntimeSharedWalletFundingPlan(input.plan)
  const planByLane = new Map(input.plan.lanes.map((lane) => [lane.lane_id, lane]))
  const rankByLane = new Map(input.authority.lanes.map((lane) => [lane.lane_id, lane.priority_rank]))
  if (input.authority.portfolio_id !== input.plan.portfolio_id
      || input.authority.portfolio_plan_hash !== input.plan.plan_hash
      || input.lanes.length !== input.plan.lanes.length
      || new Set(input.lanes.map((lane) => lane.lane_id)).size !== input.plan.lanes.length
      || rankByLane.size !== input.plan.lanes.length) {
    throw new Error("runtime shared wallet funding Engine authority does not bind the Plan")
  }
  for (const lane of input.lanes) validateLane(lane, planByLane.get(lane.lane_id))
  const queue: QueueItem[] = input.lanes.flatMap((lane) => [
    { role: "entry", roleRank: 2, time: lane.entry_time, lane, bar: lane.entry_bar },
    ...(lane.exit ? [{ role: "exit" as const, roleRank: 1 as const, time: lane.exit.time, lane, bar: lane.exit.bar }] : []),
    ...lane.funding_events.map((funding, fundingIndex) => ({
      role: "funding" as const, roleRank: 0 as const, time: funding.timestamp, lane, funding, fundingIndex,
    })),
  ])
  queue.sort((left, right) => {
    const time = Date.parse(left.time) - Date.parse(right.time)
    if (time !== 0) return time
    if (left.roleRank !== right.roleRank) return left.roleRank - right.roleRank
    return rankByLane.get(left.lane.lane_id)! - rankByLane.get(right.lane.lane_id)!
  })
  let wallet: ReplayRuntimeSharedWalletSnapshot = {
    settled_cash: input.authority.shared_initial_cash,
    reserved_isolated_collateral: 0,
    available_cash: input.authority.shared_initial_cash,
  }
  const positions = new Map<string, ActivePosition>()
  const closed: ReplayRuntimeSharedWalletLifecycleClosedPosition[] = []
  const rejected: string[] = []
  const events: ReplayRuntimeSharedWalletFundingQueueEvent[] = []

  for (const [index, queued] of queue.entries()) {
    const lane = queued.lane
    const rank = rankByLane.get(lane.lane_id)!
    const walletBefore = structuredClone(wallet)
    if (queued.role === "funding") {
      const funding = queued.funding!
      const active = positions.get(lane.lane_id)
      const cashflow = active
        ? calculateFundingCashflowV3(
          funding.mark_price, active.quantity, funding.rate, active.side, lane.settlement_increment,
        )
        : 0
      if (active) {
        const next = {
          settled_cash: addReplayDecimalValues(wallet.settled_cash, cashflow),
          reserved_isolated_collateral: wallet.reserved_isolated_collateral,
          available_cash: addReplayDecimalValues(wallet.available_cash, cashflow),
        }
        if (next.settled_cash < 0 || next.available_cash < 0) {
          throw new Error("runtime shared wallet funding creates an unsupported cash deficit")
        }
        wallet = next
      }
      events.push(fundingEvent({
        queue_ordinal: index + 1,
        event_time: funding.timestamp,
        boundary_phase: 10,
        source_kind: "funding",
        event_role: "funding",
        event_role_rank: 0,
        lane_id: lane.lane_id,
        symbol: lane.symbol,
        priority_rank: rank,
        request_hash: lane.request_hash,
        funding_event_index: queued.fundingIndex!,
        funding_event_hash: canonicalHash(funding),
        rate: funding.rate,
        mark_price: funding.mark_price,
        position_side: active?.side ?? null,
        quantity: active?.quantity ?? 0,
        funding_cashflow: cashflow,
        outcome: active ? "applied" : "not_reached",
        outcome_reason: active ? "position_open_t_minus" : "no_open_position_t_minus",
        wallet_before: walletBefore,
        wallet_after: structuredClone(wallet),
      }))
      continue
    }
    if (queued.role === "entry") {
      const side = lane.side === "long" ? "buy" : "sell"
      const price = applyAdverseSlippageV3(queued.bar!.open, side, lane.slippage_bps, lane.price_increment)
      const fee = calculateNotionalChargeV3(price, lane.quantity, lane.fee_bps, lane.settlement_increment)
      const requiredCash = addReplayDecimalValues(lane.isolated_collateral, fee)
      const admitted = wallet.available_cash >= requiredCash
      const fillHash = admitted ? canonicalHash({
        portfolio_id: input.plan.portfolio_id, lane_id: lane.lane_id, request_hash: lane.request_hash,
        event_role: "entry", event_time: queued.time, side, quantity: lane.quantity, price, fee, reduce_only: false,
      }) : null
      if (admitted) {
        wallet = {
          settled_cash: addReplayDecimalValues(wallet.settled_cash, -fee),
          reserved_isolated_collateral: addReplayDecimalValues(wallet.reserved_isolated_collateral, lane.isolated_collateral),
          available_cash: addReplayDecimalValues(wallet.available_cash, -requiredCash),
        }
        positions.set(lane.lane_id, {
          lane_id: lane.lane_id, symbol: lane.symbol, side: lane.side, quantity: lane.quantity,
          entry_price: price, isolated_collateral: lane.isolated_collateral,
          entry_fill_hash: fillHash!, entry_fee: fee,
        })
      } else rejected.push(lane.lane_id)
      events.push(lifecycleEvent({
        queue_ordinal: index + 1, event_time: queued.time, boundary_phase: 20, source_kind: "bar_open",
        lane_id: lane.lane_id, symbol: lane.symbol, priority_rank: rank, request_hash: lane.request_hash,
        bar_hash: canonicalHash(queued.bar!), wallet_before: walletBefore, wallet_after: structuredClone(wallet),
        event_role: "entry", event_role_rank: 2, position_side: lane.side, execution_price: price,
        quantity: lane.quantity, isolated_collateral: lane.isolated_collateral, fee,
        required_available_cash: requiredCash, outcome: admitted ? "filled" : "rejected",
        outcome_reason: admitted ? "cash_reserved_and_fill_committed" : "insufficient_available_cash",
        fill_hash: fillHash, realized_pnl: 0, released_collateral: 0,
      }))
      continue
    }
    const active = positions.get(lane.lane_id)
    const exitSide = lane.side === "long" ? "sell" : "buy"
    const price = applyAdverseSlippageV3(queued.bar!.open, exitSide, lane.slippage_bps, lane.price_increment)
    let fee = 0
    let realizedPnl = 0
    let releasedCollateral = 0
    let fillHash: string | null = null
    if (active) {
      fee = calculateNotionalChargeV3(price, active.quantity, lane.fee_bps, lane.settlement_increment)
      realizedPnl = quantizeReplayDifferenceProduct(
        price, active.entry_price, active.quantity, active.side === "long" ? 1 : -1,
        lane.settlement_increment, "floor",
      )
      releasedCollateral = active.isolated_collateral
      const next = {
        settled_cash: addReplayDecimalValues(wallet.settled_cash, realizedPnl, -fee),
        reserved_isolated_collateral: addReplayDecimalValues(wallet.reserved_isolated_collateral, -releasedCollateral),
        available_cash: addReplayDecimalValues(wallet.available_cash, releasedCollateral, realizedPnl, -fee),
      }
      if (next.settled_cash < 0 || next.reserved_isolated_collateral < 0 || next.available_cash < 0) {
        throw new Error("runtime shared wallet funding exit creates an unsupported cash deficit")
      }
      wallet = next
      fillHash = canonicalHash({
        portfolio_id: input.plan.portfolio_id, lane_id: lane.lane_id, request_hash: lane.request_hash,
        event_role: "exit", event_time: queued.time, side: exitSide, quantity: active.quantity,
        price, fee, realized_pnl: realizedPnl, reduce_only: true,
      })
      closed.push({
        lane_id: active.lane_id, symbol: active.symbol, side: active.side, quantity: active.quantity,
        entry_price: active.entry_price, isolated_collateral: active.isolated_collateral,
        entry_fill_hash: active.entry_fill_hash, exit_price: price, exit_fill_hash: fillHash,
        realized_pnl: realizedPnl, entry_fee: active.entry_fee, exit_fee: fee,
      })
      positions.delete(lane.lane_id)
    }
    events.push(lifecycleEvent({
      queue_ordinal: index + 1, event_time: queued.time, boundary_phase: 20, source_kind: "bar_open",
      lane_id: lane.lane_id, symbol: lane.symbol, priority_rank: rank, request_hash: lane.request_hash,
      bar_hash: canonicalHash(queued.bar!), wallet_before: walletBefore, wallet_after: structuredClone(wallet),
      event_role: "exit", event_role_rank: 1, position_side: lane.side, execution_price: price,
      quantity: lane.quantity, isolated_collateral: lane.isolated_collateral, fee, required_available_cash: 0,
      outcome: active ? "filled" : "not_reached",
      outcome_reason: active ? "realized_pnl_fee_and_collateral_release_committed" : "entry_not_filled",
      fill_hash: fillHash, realized_pnl: realizedPnl, released_collateral: releasedCollateral,
    }))
  }
  const open = [...positions.values()].map(({ entry_fee: _fee, ...position }) => position)
  const entryFees = events.reduce((total, event) => event.event_role === "entry" && event.outcome === "filled"
    ? addReplayDecimalValues(total, event.fee) : total, 0)
  const exitFees = events.reduce((total, event) => event.event_role === "exit" && event.outcome === "filled"
    ? addReplayDecimalValues(total, event.fee) : total, 0)
  const realized = closed.reduce((total, position) => addReplayDecimalValues(total, position.realized_pnl), 0)
  const funding = events.reduce((total, event) => event.event_role === "funding" && event.outcome === "applied"
    ? addReplayDecimalValues(total, event.funding_cashflow) : total, 0)
  const body: Omit<ReplayRuntimeSharedWalletFundingResult, "result_hash"> = {
    schema_version: REPLAY_RUNTIME_SHARED_WALLET_FUNDING_RESULT_SCHEMA_VERSION,
    portfolio_id: input.plan.portfolio_id,
    portfolio_plan_hash: input.plan.plan_hash,
    funding_reservation_hash: input.authority.reservation_hash,
    execution_mode: "runtime_shared_wallet_entry_exit_exact_funding_v1",
    settlement_asset: input.authority.settlement_asset,
    shared_initial_cash: input.authority.shared_initial_cash,
    global_source_event_queue: events,
    open_positions: open,
    closed_positions: closed,
    rejected_lane_ids: rejected,
    total_entry_fees: entryFees,
    total_exit_fees: exitFees,
    total_realized_pnl: realized,
    total_funding_cashflow: funding,
    ending_settled_cash: wallet.settled_cash,
    ending_reserved_isolated_collateral: wallet.reserved_isolated_collateral,
    ending_available_cash: wallet.available_cash,
    portfolio_nav_at_entry_marks: wallet.settled_cash,
    limitations: [
      "market_next_open_entry_full_exit_and_exact_funding_only",
      "no_liquidation_partial_position_cross_margin_or_borrow",
      "open_positions_marked_at_entry_price",
    ],
  }
  const result = { ...body, result_hash: replayRuntimeSharedWalletFundingResultHash(body) }
  assertReplayRuntimeSharedWalletFundingResult(result, input.plan, input.authority)
  return result
}

function lifecycleEvent(body: ReplayRuntimeSharedWalletLifecycleEventBody): ReplayRuntimeSharedWalletLifecycleEvent {
  return { ...body, event_hash: replayRuntimeSharedWalletLifecycleEventHash(body) } as ReplayRuntimeSharedWalletLifecycleEvent
}

function fundingEvent(body: Omit<ReplayRuntimeSharedWalletFundingEvent, "event_hash">): ReplayRuntimeSharedWalletFundingEvent {
  return { ...body, event_hash: replayRuntimeSharedWalletFundingEventHash(body) }
}

function validateLane(
  lane: ReplayRuntimeSharedWalletFundingEngineLane,
  plan: ReplayRuntimeSharedWalletFundingPlan["lanes"][number] | undefined,
): void {
  let prior = Number.NEGATIVE_INFINITY
  const fundingValid = lane.funding_events.every((event) => {
    const time = Date.parse(event.timestamp)
    const valid = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(event.timestamp)
      && Number.isFinite(time) && time > prior && Number.isFinite(event.rate)
      && Number.isFinite(event.mark_price) && event.mark_price > 0
    prior = time
    return valid
  })
  if (!plan || plan.symbol !== lane.symbol || plan.request_hash !== lane.request_hash
      || (plan.scheduled_exit_time !== lane.exit?.time && !(plan.scheduled_exit_time === null && lane.exit === null))
      || (plan.exit_intent_hash !== lane.exit?.intent_hash && !(plan.exit_intent_hash === null && lane.exit === null))
      || plan.settlement_increment !== lane.settlement_increment
      || plan.funding_event_count !== lane.funding_events.length
      || plan.funding_events_hash !== canonicalHash(lane.funding_events)
      || !fundingValid || lane.entry_bar.open_time !== lane.entry_time || lane.entry_bar.closed !== true
      || lane.exit && (lane.exit.bar.open_time !== lane.exit.time || lane.exit.bar.closed !== true
        || Date.parse(lane.exit.time) <= Date.parse(lane.entry_time))
      || !Number.isFinite(lane.quantity) || lane.quantity <= 0
      || !Number.isFinite(lane.isolated_collateral) || lane.isolated_collateral <= 0
      || !Number.isFinite(lane.fee_bps) || lane.fee_bps < 0
      || !Number.isFinite(lane.slippage_bps) || lane.slippage_bps < 0) {
    throw new Error(`runtime shared wallet funding lane ${lane.lane_id} is invalid`)
  }
}
