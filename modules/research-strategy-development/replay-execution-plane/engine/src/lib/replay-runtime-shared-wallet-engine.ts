import {
  REPLAY_RUNTIME_SHARED_WALLET_RESULT_SCHEMA_VERSION,
  assertReplayRuntimeSharedWalletPlan,
  assertReplayRuntimeSharedWalletResult,
  replayRuntimeSharedWalletEventHash,
  replayRuntimeSharedWalletResultHash,
  type ReplayRuntimeSharedWalletAuthorityBinding,
  type ReplayRuntimeSharedWalletGlobalEvent,
  type ReplayRuntimeSharedWalletPlan,
  type ReplayRuntimeSharedWalletResult,
  type ReplayRuntimeSharedWalletSnapshot,
} from "../../../contracts/src/lib/replay-runtime-shared-wallet-contracts"
import { canonicalHash, type ReplayMarketBar } from "../../../contracts/src/lib/replay-contracts"
import { addReplayDecimalValues } from "../../../contracts/src/lib/replay-decimal"
import {
  applyAdverseSlippageV3,
  calculateNotionalChargeV3,
} from "../../../accounting/src/lib/replay-accounting"

export interface ReplayRuntimeSharedWalletEngineLane {
  lane_id: string
  request_hash: string
  symbol: string
  side: "long" | "short"
  quantity: number
  earliest_executable_time: string
  isolated_collateral: number
  fee_bps: number
  slippage_bps: number
  price_increment: string
  settlement_increment: string
  bar: ReplayMarketBar
}

export interface ReplayRuntimeSharedWalletEngineInput {
  plan: ReplayRuntimeSharedWalletPlan
  authority: ReplayRuntimeSharedWalletAuthorityBinding
  lanes: ReplayRuntimeSharedWalletEngineLane[]
}

export function executeReplayRuntimeSharedWalletEntrySlice(
  input: ReplayRuntimeSharedWalletEngineInput,
): ReplayRuntimeSharedWalletResult {
  assertReplayRuntimeSharedWalletPlan(input.plan)
  if (input.authority.portfolio_id !== input.plan.portfolio_id
      || input.authority.portfolio_plan_hash !== input.plan.plan_hash
      || input.authority.lanes.length !== input.plan.lanes.length
      || input.lanes.length !== input.plan.lanes.length) {
    throw new Error("runtime shared wallet Engine authority does not bind the Plan")
  }
  const planByLane = new Map(input.plan.lanes.map((lane) => [lane.lane_id, lane]))
  const rankByLane = new Map(input.authority.lanes.map((lane) => [lane.lane_id, lane.priority_rank]))
  const laneById = new Map(input.lanes.map((lane) => [lane.lane_id, lane]))
  if (laneById.size !== input.plan.lanes.length || rankByLane.size !== input.plan.lanes.length) {
    throw new Error("runtime shared wallet Engine requires exact unique lane coverage")
  }
  for (const lane of input.lanes) {
    const planLane = planByLane.get(lane.lane_id)
    const rank = rankByLane.get(lane.lane_id)
    if (!planLane || !rank || planLane.symbol !== lane.symbol || planLane.request_hash !== lane.request_hash) {
      throw new Error(`runtime shared wallet lane ${lane.lane_id} identity drift`)
    }
    validateLane(lane)
  }

  const queue = [...input.lanes].sort((left, right) => {
    const time = Date.parse(left.earliest_executable_time) - Date.parse(right.earliest_executable_time)
    return time !== 0 ? time : rankByLane.get(left.lane_id)! - rankByLane.get(right.lane_id)!
  })
  let wallet: ReplayRuntimeSharedWalletSnapshot = {
    settled_cash: input.authority.shared_initial_cash,
    reserved_isolated_collateral: 0,
    available_cash: input.authority.shared_initial_cash,
  }
  const globalEvents: ReplayRuntimeSharedWalletGlobalEvent[] = []
  const openPositions: ReplayRuntimeSharedWalletResult["open_positions"] = []
  const rejectedLaneIds: string[] = []

  for (const [index, lane] of queue.entries()) {
    const executionSide = lane.side === "long" ? "buy" : "sell"
    const executionPrice = applyAdverseSlippageV3(
      lane.bar.open,
      executionSide,
      lane.slippage_bps,
      lane.price_increment,
    )
    const entryFee = calculateNotionalChargeV3(
      executionPrice,
      lane.quantity,
      lane.fee_bps,
      lane.settlement_increment,
    )
    const requiredCash = addReplayDecimalValues(lane.isolated_collateral, entryFee)
    const admitted = wallet.available_cash >= requiredCash
    const walletBefore = structuredClone(wallet)
    const fillHash = admitted ? canonicalHash({
      portfolio_id: input.plan.portfolio_id,
      lane_id: lane.lane_id,
      request_hash: lane.request_hash,
      event_time: lane.earliest_executable_time,
      side: executionSide,
      quantity: lane.quantity,
      price: executionPrice,
      fee: entryFee,
      reduce_only: false,
    }) : null
    if (admitted) {
      wallet = {
        settled_cash: addReplayDecimalValues(wallet.settled_cash, -entryFee),
        reserved_isolated_collateral: addReplayDecimalValues(
          wallet.reserved_isolated_collateral,
          lane.isolated_collateral,
        ),
        available_cash: addReplayDecimalValues(wallet.available_cash, -requiredCash),
      }
      openPositions.push({
        lane_id: lane.lane_id,
        symbol: lane.symbol,
        side: lane.side,
        quantity: lane.quantity,
        entry_price: executionPrice,
        isolated_collateral: lane.isolated_collateral,
        fill_hash: fillHash!,
      })
    } else {
      rejectedLaneIds.push(lane.lane_id)
    }
    const body: Omit<ReplayRuntimeSharedWalletGlobalEvent, "event_hash"> = {
      queue_ordinal: index + 1,
      event_time: lane.earliest_executable_time,
      boundary_phase: 20,
      source_kind: "bar_open",
      lane_id: lane.lane_id,
      symbol: lane.symbol,
      priority_rank: rankByLane.get(lane.lane_id)!,
      request_hash: lane.request_hash,
      bar_hash: canonicalHash(lane.bar),
      wallet_before: walletBefore,
      execution_price: executionPrice,
      position_side: lane.side,
      quantity: lane.quantity,
      isolated_collateral: lane.isolated_collateral,
      entry_fee: entryFee,
      required_available_cash: requiredCash,
      admission: admitted ? "filled" : "rejected",
      admission_reason: admitted ? "cash_reserved_and_fill_committed" : "insufficient_available_cash",
      fill_hash: fillHash,
      wallet_after: structuredClone(wallet),
    }
    globalEvents.push({ ...body, event_hash: replayRuntimeSharedWalletEventHash(body) })
  }

  const totalEntryFees = globalEvents
    .filter((event) => event.admission === "filled")
    .reduce((total, event) => addReplayDecimalValues(total, event.entry_fee), 0)
  const body: Omit<ReplayRuntimeSharedWalletResult, "result_hash"> = {
    schema_version: REPLAY_RUNTIME_SHARED_WALLET_RESULT_SCHEMA_VERSION,
    portfolio_id: input.plan.portfolio_id,
    portfolio_plan_hash: input.plan.plan_hash,
    runtime_shared_wallet_reservation_hash: input.authority.reservation_hash,
    execution_mode: "runtime_shared_wallet_entry_v1",
    capital_semantics: "single_runtime_wallet_fill_fee_then_next_admission",
    settlement_asset: input.authority.settlement_asset,
    shared_initial_cash: input.authority.shared_initial_cash,
    global_source_event_queue: globalEvents,
    open_positions: openPositions,
    rejected_lane_ids: rejectedLaneIds,
    total_entry_fees: totalEntryFees,
    ending_settled_cash: wallet.settled_cash,
    ending_reserved_isolated_collateral: wallet.reserved_isolated_collateral,
    ending_available_cash: wallet.available_cash,
    portfolio_nav_at_entry_marks: wallet.settled_cash,
    limitations: [
      "entry_admission_slice_not_full_lifecycle_portfolio",
      "market_next_open_full_fill_only",
      "no_exit_funding_liquidation_cash_release_or_cross_margin",
    ],
  }
  const result = { ...body, result_hash: replayRuntimeSharedWalletResultHash(body) }
  assertReplayRuntimeSharedWalletResult(result, input.plan, input.authority)
  return result
}

function validateLane(lane: ReplayRuntimeSharedWalletEngineLane): void {
  if (lane.lane_id.trim() === "" || lane.symbol.trim() === "" || !/^[a-f0-9]{64}$/.test(lane.request_hash)
      || !Number.isFinite(lane.quantity) || lane.quantity <= 0
      || !Number.isFinite(lane.isolated_collateral) || lane.isolated_collateral <= 0
      || !Number.isFinite(lane.fee_bps) || lane.fee_bps < 0
      || !Number.isFinite(lane.slippage_bps) || lane.slippage_bps < 0
      || !Number.isFinite(Date.parse(lane.earliest_executable_time))
      || lane.bar.open_time !== lane.earliest_executable_time || lane.bar.closed !== true
      || !Number.isFinite(lane.bar.open) || lane.bar.open <= 0
      || lane.price_increment.trim() === "" || lane.settlement_increment.trim() === "") {
    throw new Error(`runtime shared wallet lane ${lane.lane_id} input is invalid`)
  }
}
