import {
  REPLAY_RUNTIME_SHARED_WALLET_LIFECYCLE_RESULT_SCHEMA_VERSION,
  assertReplayRuntimeSharedWalletLifecyclePlan,
  assertReplayRuntimeSharedWalletLifecycleResult,
  replayRuntimeSharedWalletLifecycleEventHash,
  replayRuntimeSharedWalletLifecycleResultHash,
  type ReplayRuntimeSharedWalletLifecycleClosedPosition,
  type ReplayRuntimeSharedWalletLifecycleEvent,
  type ReplayRuntimeSharedWalletLifecycleEventBody,
  type ReplayRuntimeSharedWalletLifecyclePlan,
  type ReplayRuntimeSharedWalletLifecyclePosition,
  type ReplayRuntimeSharedWalletLifecycleResult,
} from "../../../contracts/src/lib/replay-runtime-shared-wallet-lifecycle-contracts"
import type { ReplayRuntimeSharedWalletAuthorityBinding, ReplayRuntimeSharedWalletSnapshot } from "../../../contracts/src/lib/replay-runtime-shared-wallet-contracts"
import { canonicalHash, type ReplayMarketBar } from "../../../contracts/src/lib/replay-contracts"
import { addReplayDecimalValues, quantizeReplayDifferenceProduct } from "../../../contracts/src/lib/replay-decimal"
import { applyAdverseSlippageV3, calculateNotionalChargeV3 } from "../../../accounting/src/lib/replay-accounting"

export interface ReplayRuntimeSharedWalletLifecycleEngineLane {
  lane_id: string
  request_hash: string
  symbol: string
  side: "long" | "short"
  quantity: number
  entry_time: string
  entry_bar: ReplayMarketBar
  exit: { time: string; intent_hash: string; bar: ReplayMarketBar } | null
  isolated_collateral: number
  fee_bps: number
  slippage_bps: number
  price_increment: string
  settlement_increment: string
}

export interface ReplayRuntimeSharedWalletLifecycleEngineInput {
  plan: ReplayRuntimeSharedWalletLifecyclePlan
  authority: ReplayRuntimeSharedWalletAuthorityBinding
  lanes: ReplayRuntimeSharedWalletLifecycleEngineLane[]
}

interface ActivePosition extends ReplayRuntimeSharedWalletLifecyclePosition {
  entry_fee: number
}

export function executeReplayRuntimeSharedWalletLifecycleSlice(
  input: ReplayRuntimeSharedWalletLifecycleEngineInput,
): ReplayRuntimeSharedWalletLifecycleResult {
  assertReplayRuntimeSharedWalletLifecyclePlan(input.plan)
  const planByLane = new Map(input.plan.lanes.map((lane) => [lane.lane_id, lane]))
  const rankByLane = new Map(input.authority.lanes.map((lane) => [lane.lane_id, lane.priority_rank]))
  if (input.authority.portfolio_id !== input.plan.portfolio_id
      || input.authority.portfolio_plan_hash !== input.plan.plan_hash
      || input.lanes.length !== input.plan.lanes.length
      || new Set(input.lanes.map((lane) => lane.lane_id)).size !== input.plan.lanes.length
      || rankByLane.size !== input.plan.lanes.length) {
    throw new Error("runtime shared wallet lifecycle Engine authority does not bind the Plan")
  }
  for (const lane of input.lanes) validateLane(lane, planByLane.get(lane.lane_id))

  const queue = input.lanes.flatMap((lane) => [
    { role: "entry" as const, roleRank: 2, time: lane.entry_time, lane, bar: lane.entry_bar },
    ...(lane.exit ? [{ role: "exit" as const, roleRank: 1, time: lane.exit.time, lane, bar: lane.exit.bar }] : []),
  ]).sort((left, right) => {
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
  const events: ReplayRuntimeSharedWalletLifecycleEvent[] = []

  for (const [index, queued] of queue.entries()) {
    const { lane } = queued
    const rank = rankByLane.get(lane.lane_id)!
    const walletBefore = structuredClone(wallet)
    if (queued.role === "entry") {
      const side = lane.side === "long" ? "buy" : "sell"
      const price = applyAdverseSlippageV3(queued.bar.open, side, lane.slippage_bps, lane.price_increment)
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
          reserved_isolated_collateral: addReplayDecimalValues(
            wallet.reserved_isolated_collateral, lane.isolated_collateral,
          ),
          available_cash: addReplayDecimalValues(wallet.available_cash, -requiredCash),
        }
        positions.set(lane.lane_id, {
          lane_id: lane.lane_id, symbol: lane.symbol, side: lane.side, quantity: lane.quantity,
          entry_price: price, isolated_collateral: lane.isolated_collateral,
          entry_fill_hash: fillHash!, entry_fee: fee,
        })
      } else rejected.push(lane.lane_id)
      events.push(event({
        queue_ordinal: index + 1, event_time: queued.time, boundary_phase: 20, source_kind: "bar_open",
        lane_id: lane.lane_id, symbol: lane.symbol, priority_rank: rank, request_hash: lane.request_hash,
        bar_hash: canonicalHash(queued.bar), wallet_before: walletBefore, wallet_after: structuredClone(wallet),
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
    const price = applyAdverseSlippageV3(queued.bar.open, exitSide, lane.slippage_bps, lane.price_increment)
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
      const nextWallet = {
        settled_cash: addReplayDecimalValues(wallet.settled_cash, realizedPnl, -fee),
        reserved_isolated_collateral: addReplayDecimalValues(
          wallet.reserved_isolated_collateral, -releasedCollateral,
        ),
        available_cash: addReplayDecimalValues(
          wallet.available_cash, releasedCollateral, realizedPnl, -fee,
        ),
      }
      if (nextWallet.settled_cash < 0 || nextWallet.reserved_isolated_collateral < 0 || nextWallet.available_cash < 0) {
        throw new Error("runtime shared wallet lifecycle exit creates an unsupported cash deficit")
      }
      wallet = nextWallet
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
    events.push(event({
      queue_ordinal: index + 1, event_time: queued.time, boundary_phase: 20, source_kind: "bar_open",
      lane_id: lane.lane_id, symbol: lane.symbol, priority_rank: rank, request_hash: lane.request_hash,
      bar_hash: canonicalHash(queued.bar), wallet_before: walletBefore, wallet_after: structuredClone(wallet),
      event_role: "exit", event_role_rank: 1, position_side: lane.side, execution_price: price,
      quantity: lane.quantity, isolated_collateral: lane.isolated_collateral, fee, required_available_cash: 0,
      outcome: active ? "filled" : "not_reached",
      outcome_reason: active ? "realized_pnl_fee_and_collateral_release_committed" : "entry_not_filled",
      fill_hash: fillHash, realized_pnl: realizedPnl, released_collateral: releasedCollateral,
    }))
  }

  const open = [...positions.values()].map(({ entry_fee: _fee, ...position }) => position)
  const entryFees = events.filter((item) => item.event_role === "entry" && item.outcome === "filled")
    .reduce((total, item) => addReplayDecimalValues(total, item.fee), 0)
  const exitFees = events.filter((item) => item.event_role === "exit" && item.outcome === "filled")
    .reduce((total, item) => addReplayDecimalValues(total, item.fee), 0)
  const totalRealized = closed.reduce((total, item) => addReplayDecimalValues(total, item.realized_pnl), 0)
  const body: Omit<ReplayRuntimeSharedWalletLifecycleResult, "result_hash"> = {
    schema_version: REPLAY_RUNTIME_SHARED_WALLET_LIFECYCLE_RESULT_SCHEMA_VERSION,
    portfolio_id: input.plan.portfolio_id,
    portfolio_plan_hash: input.plan.plan_hash,
    lifecycle_reservation_hash: input.authority.reservation_hash,
    execution_mode: "runtime_shared_wallet_entry_exit_release_v1",
    settlement_asset: input.authority.settlement_asset,
    shared_initial_cash: input.authority.shared_initial_cash,
    global_source_event_queue: events,
    open_positions: open,
    closed_positions: closed,
    rejected_lane_ids: rejected,
    total_entry_fees: entryFees,
    total_exit_fees: exitFees,
    total_realized_pnl: totalRealized,
    ending_settled_cash: wallet.settled_cash,
    ending_reserved_isolated_collateral: wallet.reserved_isolated_collateral,
    ending_available_cash: wallet.available_cash,
    portfolio_nav_at_entry_marks: wallet.settled_cash,
    limitations: [
      "market_next_open_entry_and_full_exit_only",
      "no_funding_liquidation_partial_position_or_cross_margin",
      "open_positions_marked_at_entry_price",
    ],
  }
  const result = { ...body, result_hash: replayRuntimeSharedWalletLifecycleResultHash(body) }
  assertReplayRuntimeSharedWalletLifecycleResult(result, input.plan, input.authority)
  return result
}

function event(body: ReplayRuntimeSharedWalletLifecycleEventBody): ReplayRuntimeSharedWalletLifecycleEvent {
  return { ...body, event_hash: replayRuntimeSharedWalletLifecycleEventHash(body) } as ReplayRuntimeSharedWalletLifecycleEvent
}

function validateLane(
  lane: ReplayRuntimeSharedWalletLifecycleEngineLane,
  plan: ReplayRuntimeSharedWalletLifecyclePlan["lanes"][number] | undefined,
): void {
  if (!plan || plan.symbol !== lane.symbol || plan.request_hash !== lane.request_hash
      || (plan.scheduled_exit_time !== lane.exit?.time
        && !(plan.scheduled_exit_time === null && lane.exit === null))
      || (plan.exit_intent_hash !== lane.exit?.intent_hash
        && !(plan.exit_intent_hash === null && lane.exit === null))
      || lane.entry_bar.open_time !== lane.entry_time || lane.entry_bar.closed !== true
      || lane.exit && (lane.exit.bar.open_time !== lane.exit.time || lane.exit.bar.closed !== true
        || Date.parse(lane.exit.time) <= Date.parse(lane.entry_time))
      || !Number.isFinite(lane.quantity) || lane.quantity <= 0
      || !Number.isFinite(lane.isolated_collateral) || lane.isolated_collateral <= 0
      || !Number.isFinite(lane.fee_bps) || lane.fee_bps < 0
      || !Number.isFinite(lane.slippage_bps) || lane.slippage_bps < 0) {
    throw new Error(`runtime shared wallet lifecycle lane ${lane.lane_id} is invalid`)
  }
}
