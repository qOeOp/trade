import type {
  ReplayMarketBar,
  ReplayOhlcvResolutionEvidence,
  ReplaySourceEvent,
} from "../../../contracts/src/lib/replay-contracts"
import type { ReplayPortfolioProtectiveTerminalRecord } from
  "../../../contracts/src/lib/replay-portfolio-protective-terminal-contracts"
import type { ReplayRuntimeSharedWalletRiskResult } from
  "../../../contracts/src/lib/replay-runtime-shared-wallet-risk-contracts"
import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import { addReplayDecimalValues } from "../../../contracts/src/lib/replay-decimal"
import { createReplaySimpleBracketOhlcvResolution } from "./replay-ohlcv-resolution"

export interface ReplayPortfolioProtectiveReplacementTerminalCandidate<TOwner extends string = string> {
  owner: TOwner
  event_time: string
  phase: 15 | 20
  rank: number
  source_hash: string
  resolution: ReplayOhlcvResolutionEvidence | null
  realized_pnl: number
  exit_fee: number
  liquidation_fee: number
}

interface ReplacementRecordEconomics {
  lane_id: string
  owner: string
  entry_fee: number
  funding_cashflow_before_terminal: number
  realized_pnl: number
  exit_trading_fee: number
  liquidation_fee: number
  ending_open: boolean
  isolated_collateral: number
  ending_unrealized_pnl: number
}

export function aggregateReplayPortfolioProtectiveReplacementTerminal<TRecord extends ReplacementRecordEconomics>(
  sourceRecords: ReplayPortfolioProtectiveTerminalRecord[],
  lanes: Array<{ lane_id: string }>,
  build: (source: ReplayPortfolioProtectiveTerminalRecord, lane: typeof lanes[number]) => {
    record: TRecord
    resolution: ReplayOhlcvResolutionEvidence | null
  },
  sharedInitialCash: number,
) {
  const laneById = new Map(lanes.map((lane) => [lane.lane_id, lane]))
  const resolutions: ReplayOhlcvResolutionEvidence[] = []
  const records = sourceRecords.map((sourceRecord) => {
    const materialized = build(sourceRecord, laneById.get(sourceRecord.lane_id)!)
    if (materialized.resolution) resolutions.push(materialized.resolution)
    return materialized.record
  }).sort((left, right) => left.lane_id.localeCompare(right.lane_id))
  let settled = sharedInitialCash
  let reserved = 0
  let unrealized = 0
  for (const record of records) {
    if (record.owner === "not_opened") continue
    settled = addReplayDecimalValues(settled, -record.entry_fee, record.funding_cashflow_before_terminal,
      record.realized_pnl, -record.exit_trading_fee, -record.liquidation_fee)
    if (record.ending_open) {
      reserved = addReplayDecimalValues(reserved, record.isolated_collateral)
      unrealized = addReplayDecimalValues(unrealized, record.ending_unrealized_pnl)
    }
  }
  const available = addReplayDecimalValues(settled, -reserved)
  if (settled < 0 || reserved < 0 || available < 0) {
    throw new Error("Portfolio replacement terminal creates an unsupported wallet deficit")
  }
  const economicSummary = {
    ending_settled_cash: settled,
    ending_reserved_isolated_collateral: reserved,
    ending_available_cash: available,
    ending_unrealized_pnl: unrealized,
    ending_portfolio_nav: addReplayDecimalValues(settled, unrealized),
  }
  return {
    records,
    resolutions,
    lane_records_hash: canonicalHash(records),
    resolutions_hash: canonicalHash(resolutions),
    economicSummary,
  }
}

interface ReplacementResolutionLane {
  lane_id: string
  run_id: string
  cost_policy_id: string
  cost_policy_version: string
  fee_bps: number
  slippage_bps: number
  price_increment: string
  settlement_increment: string
  settlement_asset: string
}

export function createReplayPortfolioProtectiveReplacementOhlcvCandidate<TOwner extends string>(input: {
  lane: ReplacementResolutionLane
  source: ReplayPortfolioProtectiveTerminalRecord
  bar: ReplayMarketBar
  index: number
  observation: "bar_open_gap" | "bar_range_touch"
  stop_touched: boolean
  target_touched: boolean
  active_protection: {
    protection_mode?: "bracket" | "stop_only" | "target_only"
    protection_generation: number
    remaining_quantity: number
    stop_order_id: string
    stop_trigger_price: number
    stop_order_status?: "active" | "cancelled"
    target_order_id: string
    target_trigger_price: number
    target_order_status?: "active" | "cancelled"
  }
  stop_owner: TOwner
  target_owner: TOwner
}): ReplayPortfolioProtectiveReplacementTerminalCandidate<TOwner> {
  const eventTime = input.observation === "bar_open_gap" ? input.bar.open_time : input.bar.close_time
  const stableId = `portfolio:${input.lane.lane_id}:replacement:${input.observation}:${input.index}:${eventTime}`
  const sourceEvent: ReplaySourceEvent = {
    source_event_id: stableId,
    kind: input.observation === "bar_open_gap" ? "bar_open" : "bar_range",
    source_index: input.index,
    event_key: { event_time: eventTime, boundary_phase: 20, source_sequence: input.index + 1,
      event_subphase: 0, stable_event_id: stableId },
  }
  const resolution = createReplaySimpleBracketOhlcvResolution({
    run_id: input.lane.run_id,
    source_event: sourceEvent,
    bar: input.bar,
    position_side: input.source.side,
    active_protection: input.active_protection,
    economics: {
      entry_basis_price: input.source.entry_price,
      exit_side: input.source.side === "long" ? "sell" : "buy",
      cost_policy_id: input.lane.cost_policy_id,
      cost_policy_version: input.lane.cost_policy_version,
      fee_bps: input.lane.fee_bps,
      slippage_bps: input.lane.slippage_bps,
      price_increment: input.lane.price_increment,
      settlement_increment: input.lane.settlement_increment,
      settlement_asset: input.lane.settlement_asset,
    },
    observation_kind: input.observation,
    stop_touched: input.stop_touched,
    target_touched: input.target_touched,
    canonical_terminal_role: input.stop_touched ? "stop" : "target",
  })
  const path = resolution.paths.find((item) => item.path_id === resolution.canonical.path_id)!
  return {
    owner: resolution.canonical.terminal_role === "stop" ? input.stop_owner : input.target_owner,
    event_time: eventTime,
    phase: 20,
    rank: input.observation === "bar_open_gap" ? 0 : 2,
    source_hash: resolution.evidence_hash,
    resolution,
    realized_pnl: path.gross_realized_pnl,
    exit_fee: path.exit_fee,
    liquidation_fee: 0,
  }
}

export function replayPortfolioProtectiveReplacementUpstreamCandidate(
  source: ReplayPortfolioProtectiveTerminalRecord,
): ReplayPortfolioProtectiveReplacementTerminalCandidate<"exact_liquidation" | "strategy_exit"> | null {
  if (source.owner !== "exact_liquidation" && source.owner !== "strategy_exit") return null
  return {
    owner: source.owner,
    event_time: source.terminal_time!,
    phase: source.terminal_phase!,
    rank: source.owner === "exact_liquidation" ? 0 : 1,
    source_hash: source.terminal_source_hash!,
    resolution: null,
    realized_pnl: source.realized_pnl,
    exit_fee: source.exit_trading_fee,
    liquidation_fee: source.liquidation_fee,
  }
}

export function chooseReplayPortfolioProtectiveReplacementWinner<T extends string>(
  left: ReplayPortfolioProtectiveReplacementTerminalCandidate<T> | null,
  right: ReplayPortfolioProtectiveReplacementTerminalCandidate<T> | null,
): ReplayPortfolioProtectiveReplacementTerminalCandidate<T> | null {
  if (!left) return right
  if (!right) return left
  const leftKey = [Date.parse(left.event_time), left.phase, left.rank]
  const rightKey = [Date.parse(right.event_time), right.phase, right.rank]
  for (let index = 0; index < leftKey.length; index += 1) {
    if (leftKey[index] !== rightKey[index]) return leftKey[index]! < rightKey[index]! ? left : right
  }
  return left.source_hash < right.source_hash ? left : right
}

export function replayPortfolioProtectiveReplacementFundingBefore(
  risk: ReplayRuntimeSharedWalletRiskResult,
  laneId: string,
  terminal: ReplayPortfolioProtectiveReplacementTerminalCandidate,
): number {
  return risk.global_source_event_queue.reduce((total, event) => {
    if (event.event_role !== "funding" || event.lane_id !== laneId || event.outcome !== "applied") return total
    if (Date.parse(event.event_time) > Date.parse(terminal.event_time)
        || event.event_time === terminal.event_time && event.boundary_phase >= terminal.phase) return total
    return addReplayDecimalValues(total, event.funding_cashflow)
  }, 0)
}

export function replayPortfolioProtectiveReplacementWinnerFields<TOwner extends string>(
  source: ReplayPortfolioProtectiveTerminalRecord,
  winner: ReplayPortfolioProtectiveReplacementTerminalCandidate<TOwner>,
  protection: ReplayPortfolioProtectiveReplacementTerminalCandidate | null,
  upstream: ReplayPortfolioProtectiveReplacementTerminalCandidate | null,
  fundingCashflow: number,
) {
  return {
    owner: winner.owner,
    terminal_time: winner.event_time,
    terminal_phase: winner.phase,
    terminal_source_hash: winner.source_hash,
    preempted_upstream_terminal_hash: protection === winner && upstream ? upstream.source_hash : null,
    ohlcv_resolution_evidence_hash: winner.resolution?.evidence_hash ?? null,
    resolution_status: winner.resolution?.status ?? ("not_applicable" as const),
    funding_cashflow_before_terminal: fundingCashflow,
    realized_pnl: winner.realized_pnl,
    exit_trading_fee: winner.exit_fee,
    liquidation_fee: winner.liquidation_fee,
    released_collateral: source.isolated_collateral,
    ending_unrealized_pnl: 0,
    ending_open: false,
  }
}
