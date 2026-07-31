import {
  REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_EVIDENCE_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_LIMITATIONS,
  REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_POLICY_VERSION,
  assertReplayPortfolioProtectiveTerminalEvidence,
  replayPortfolioProtectiveTerminalEvidenceHash,
  replayPortfolioProtectiveTerminalFingerprintHash,
  replayPortfolioProtectiveTerminalRecordHash,
  type ReplayPortfolioProtectiveTerminalEvidence,
  type ReplayPortfolioProtectiveTerminalFingerprint,
  type ReplayPortfolioProtectiveTerminalOwner,
  type ReplayPortfolioProtectiveTerminalRecord,
} from "../../../contracts/src/lib/replay-portfolio-protective-terminal-contracts"
import {
  assertReplayPortfolioMarkRiskRevaluationArtifactManifest,
  assertReplayPortfolioMarkRiskRevaluationEvidence,
  type ReplayPortfolioMarkRiskRevaluationEvidence,
  type ReplayPortfolioMarkRiskRevaluationArtifactManifest,
} from "../../../contracts/src/lib/replay-portfolio-mark-risk-revaluation-contracts"
import {
  assertReplayIntegratedPortfolioArtifactManifest,
  replayIntegratedPortfolioResultHash,
  type ReplayIntegratedPortfolioArtifactManifest,
  type ReplayIntegratedPortfolioResult,
} from "../../../contracts/src/lib/replay-integrated-portfolio-contracts"
import {
  replayPortfolioAllocationResultHash,
  type ReplayPortfolioAllocationDecision,
  type ReplayPortfolioAllocationResult,
} from "../../../contracts/src/lib/replay-portfolio-allocation-contracts"
import {
  replayRuntimeSharedWalletRiskResultHash,
  type ReplayRuntimeSharedWalletRiskResult,
} from "../../../contracts/src/lib/replay-runtime-shared-wallet-risk-contracts"
import { canonicalHash, type ReplayMarketBar, type ReplayOhlcvResolutionEvidence, type ReplaySourceEvent } from "../../../contracts/src/lib/replay-contracts"
import { addReplayDecimalValues } from "../../../contracts/src/lib/replay-decimal"
import { createReplaySimpleBracketOhlcvResolution } from "./replay-ohlcv-resolution"

export interface ReplayPortfolioProtectiveTerminalLane {
  lane_id: string
  run_id: string
  request_hash: string
  symbol: string
  priority_rank: number
  side: "long" | "short"
  quantity: number
  entry_time: string
  stop_price: number
  target_price: number
  bars: ReplayMarketBar[]
  bars_hash: string
  cost_policy_id: string
  cost_policy_version: string
  fee_bps: number
  slippage_bps: number
  price_increment: string
  settlement_increment: string
  settlement_asset: string
}

export interface ReplayPortfolioProtectiveTerminalEngineInput {
  identity: { experiment_id: string; trial_group_id: string; trial_group_hash: string }
  allocation_result: ReplayPortfolioAllocationResult
  risk_result: ReplayRuntimeSharedWalletRiskResult
  integrated_result: ReplayIntegratedPortfolioResult
  integrated_manifest: ReplayIntegratedPortfolioArtifactManifest
  revaluation_evidence: ReplayPortfolioMarkRiskRevaluationEvidence
  revaluation_manifest: ReplayPortfolioMarkRiskRevaluationArtifactManifest
  lanes: ReplayPortfolioProtectiveTerminalLane[]
}

interface TerminalCandidate {
  owner: Exclude<ReplayPortfolioProtectiveTerminalOwner, "not_opened" | "open_at_data_end">
  event_time: string
  phase: 15 | 20
  same_phase_rank: number
  source_hash: string
  resolution: ReplayOhlcvResolutionEvidence | null
  realized_pnl: number
  exit_fee: number
  liquidation_fee: number
  upstream_event_hash: string | null
}

export function executeReplayPortfolioProtectiveTerminal(
  input: ReplayPortfolioProtectiveTerminalEngineInput,
): ReplayPortfolioProtectiveTerminalEvidence {
  validateInput(input)
  const laneById = new Map(input.lanes.map((lane) => [lane.lane_id, lane]))
  const decisions = input.allocation_result.allocation_cycles.flatMap((cycle) => cycle.decisions)
  const resolutions: ReplayOhlcvResolutionEvidence[] = []
  const records = decisions.map((decision) => {
    const lane = laneById.get(decision.lane_id)!
    const result = buildRecord(input, decision, lane)
    if (result.resolution) resolutions.push(result.resolution)
    return result.record
  }).sort((left, right) => left.lane_id.localeCompare(right.lane_id))

  let settled = input.risk_result.shared_initial_cash
  let reserved = 0
  let unrealized = 0
  for (const record of records) {
    if (record.owner === "not_opened") continue
    settled = addReplayDecimalValues(
      settled, -record.entry_fee, record.funding_cashflow_before_terminal,
      record.realized_pnl, -record.exit_trading_fee, -record.liquidation_fee,
    )
    if (record.ending_open) {
      reserved = addReplayDecimalValues(reserved, record.isolated_collateral)
      unrealized = addReplayDecimalValues(unrealized, record.ending_unrealized_pnl)
    } else {
      const laneRemainder = addReplayDecimalValues(
        record.isolated_collateral, record.funding_cashflow_before_terminal,
        record.realized_pnl, -record.exit_trading_fee, -record.liquidation_fee,
      )
      if (laneRemainder < 0) throw new Error(`Portfolio protective terminal ${record.lane_id} isolated deficit`)
    }
  }
  const available = addReplayDecimalValues(settled, -reserved)
  if (settled < 0 || reserved < 0 || available < 0) {
    throw new Error("Portfolio protective terminal creates an unsupported wallet deficit")
  }
  const finalRevaluationPositions = input.revaluation_evidence.transitions.at(-1)?.positions_after ?? []
  const openLaneIds = new Set(records.filter((record) => record.ending_open).map((record) => record.lane_id))
  const finalPositions = finalRevaluationPositions.filter((position) => openLaneIds.has(position.lane_id))
  if (finalPositions.length !== openLaneIds.size) {
    throw new Error("Portfolio protective terminal open Position lacks final Mark revaluation")
  }
  const gross = addReplayDecimalValues(...finalPositions.map((position) => position.mark_notional))
  const net = addReplayDecimalValues(...finalPositions.map((position) => position.signed_mark_notional))
  const risk = addReplayDecimalValues(...finalPositions.map((position) => position.frozen_stop_risk_amount))
  const laneRecordsHash = canonicalHash(records)
  const resolutionsHash = canonicalHash(resolutions)
  const fingerprintBody: Omit<ReplayPortfolioProtectiveTerminalFingerprint, "fingerprint_hash"> = {
    ...input.identity,
    portfolio_id: input.integrated_result.portfolio_id,
    integrated_result_hash: input.integrated_result.result_hash,
    integrated_artifact_manifest_hash: input.integrated_manifest.manifest_hash,
    allocation_result_hash: input.allocation_result.result_hash,
    risk_result_hash: input.risk_result.result_hash,
    mark_risk_revaluation_evidence_hash: input.revaluation_evidence.evidence_hash,
    mark_risk_revaluation_artifact_manifest_hash: input.revaluation_manifest.manifest_hash,
    lane_records_hash: laneRecordsHash,
    ohlcv_resolutions_hash: resolutionsHash,
    economic_summary_hash: canonicalHash({
      ending_settled_cash: settled,
      ending_reserved_isolated_collateral: reserved,
      ending_available_cash: available,
      ending_unrealized_pnl: unrealized,
      ending_portfolio_nav: addReplayDecimalValues(settled, unrealized),
    }),
    limitations_hash: canonicalHash(REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_LIMITATIONS),
  }
  const fingerprint = {
    ...fingerprintBody,
    fingerprint_hash: replayPortfolioProtectiveTerminalFingerprintHash(fingerprintBody),
  }
  const body: Omit<ReplayPortfolioProtectiveTerminalEvidence, "evidence_hash"> = {
    schema_version: REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_EVIDENCE_SCHEMA_VERSION,
    policy_version: REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_POLICY_VERSION,
    ...input.identity,
    portfolio_id: input.integrated_result.portfolio_id,
    settlement_asset: input.risk_result.settlement_asset,
    shared_initial_cash: input.risk_result.shared_initial_cash,
    integrated_result_hash: input.integrated_result.result_hash,
    integrated_artifact_manifest_hash: input.integrated_manifest.manifest_hash,
    allocation_result_hash: input.allocation_result.result_hash,
    risk_result_hash: input.risk_result.result_hash,
    mark_risk_revaluation_evidence_hash: input.revaluation_evidence.evidence_hash,
    mark_risk_revaluation_artifact_manifest_hash: input.revaluation_manifest.manifest_hash,
    lane_records: records,
    lane_records_hash: laneRecordsHash,
    ohlcv_resolutions: resolutions,
    ohlcv_resolutions_hash: resolutionsHash,
    ending_settled_cash: settled,
    ending_reserved_isolated_collateral: reserved,
    ending_available_cash: available,
    ending_unrealized_pnl: unrealized,
    ending_portfolio_nav: addReplayDecimalValues(settled, unrealized),
    ending_gross_mark_exposure: gross,
    ending_net_mark_exposure: net,
    ending_portfolio_frozen_stop_risk: risk,
    terminal_owner_counts: ownerCounts(records),
    limitations: REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_LIMITATIONS,
    fingerprint,
  }
  const evidence = { ...body, evidence_hash: replayPortfolioProtectiveTerminalEvidenceHash(body) }
  assertReplayPortfolioProtectiveTerminalEvidence(evidence, input)
  return evidence
}

function buildRecord(
  input: ReplayPortfolioProtectiveTerminalEngineInput,
  decision: ReplayPortfolioAllocationDecision,
  lane: ReplayPortfolioProtectiveTerminalLane,
): { record: ReplayPortfolioProtectiveTerminalRecord; resolution: ReplayOhlcvResolutionEvidence | null } {
  const allocationEvent = input.allocation_result.global_source_event_queue.find(
    (event) => event.lane_id === decision.lane_id,
  )
  if (!allocationEvent) throw new Error(`Portfolio protective terminal ${lane.lane_id} Allocation event missing`)
  const common = {
    lane_id: lane.lane_id, symbol: lane.symbol, priority_rank: lane.priority_rank,
    request_hash: lane.request_hash, allocation_decision_hash: decision.decision_hash,
    entry_fill_hash: allocationEvent.fill_hash, entry_time: lane.entry_time, entry_price: decision.execution_price,
    quantity: lane.quantity, side: lane.side, isolated_collateral: decision.isolated_collateral,
    entry_fee: decision.entry_fee, stop_price: lane.stop_price, target_price: lane.target_price,
    bars_hash: lane.bars_hash,
  }
  if (decision.allocation !== "admitted") {
    return complete({ ...common, entry_fill_hash: null, owner: "not_opened", terminal_time: null,
      terminal_phase: null, terminal_source_hash: null, preempted_upstream_terminal_hash: null,
      ohlcv_resolution_evidence_hash: null, resolution_status: "not_applicable",
      funding_cashflow_before_terminal: 0, realized_pnl: 0, exit_trading_fee: 0,
      liquidation_fee: 0, released_collateral: 0, ending_unrealized_pnl: 0, ending_open: false }, null)
  }
  const protection = firstProtectionCandidate(lane, decision)
  const upstream = upstreamCandidate(input.risk_result, decision)
  const winner = chooseWinner(protection, upstream)
  const funding = fundingBefore(input.risk_result, lane.lane_id, winner)
  if (!winner) {
    const open = input.risk_result.open_positions.find((position) => position.lane_id === lane.lane_id)
    if (!open) throw new Error(`Portfolio protective terminal ${lane.lane_id} lacks terminal or open Position`)
    return complete({ ...common, owner: "open_at_data_end", terminal_time: null, terminal_phase: null,
      terminal_source_hash: null, preempted_upstream_terminal_hash: null,
      ohlcv_resolution_evidence_hash: null, resolution_status: "not_applicable",
      funding_cashflow_before_terminal: funding, realized_pnl: 0, exit_trading_fee: 0,
      liquidation_fee: 0, released_collateral: 0, ending_unrealized_pnl: open.unrealized_pnl,
      ending_open: true }, null)
  }
  const preempted = protection === winner && upstream ? upstream.source_hash : null
  return complete({
    ...common,
    owner: winner.owner,
    terminal_time: winner.event_time,
    terminal_phase: winner.phase,
    terminal_source_hash: winner.source_hash,
    preempted_upstream_terminal_hash: preempted,
    ohlcv_resolution_evidence_hash: winner.resolution?.evidence_hash ?? null,
    resolution_status: winner.resolution?.status ?? "not_applicable",
    funding_cashflow_before_terminal: funding,
    realized_pnl: winner.realized_pnl,
    exit_trading_fee: winner.exit_fee,
    liquidation_fee: winner.liquidation_fee,
    released_collateral: decision.isolated_collateral,
    ending_unrealized_pnl: 0,
    ending_open: false,
  }, winner.resolution)
}

function complete(
  body: Omit<ReplayPortfolioProtectiveTerminalRecord, "record_hash">,
  resolution: ReplayOhlcvResolutionEvidence | null,
): { record: ReplayPortfolioProtectiveTerminalRecord; resolution: ReplayOhlcvResolutionEvidence | null } {
  return { record: { ...body, record_hash: replayPortfolioProtectiveTerminalRecordHash(body) }, resolution }
}

function firstProtectionCandidate(
  lane: ReplayPortfolioProtectiveTerminalLane,
  decision: ReplayPortfolioAllocationDecision,
): TerminalCandidate | null {
  const bars = lane.bars.map((bar, index) => ({ bar, index }))
    .filter(({ bar }) => Date.parse(bar.open_time) >= Date.parse(lane.entry_time))
    .sort((left, right) => Date.parse(left.bar.open_time) - Date.parse(right.bar.open_time))
  for (const { bar, index } of bars) {
    const entryBar = bar.open_time === lane.entry_time
    if (!entryBar) {
      const openStop = lane.side === "long" ? bar.open <= lane.stop_price : bar.open >= lane.stop_price
      const openTarget = lane.side === "long" ? bar.open >= lane.target_price : bar.open <= lane.target_price
      if (openStop || openTarget) return protectionCandidate(lane, decision, bar, index, "bar_open_gap", openStop, openTarget)
    }
    const stopTouched = lane.side === "long" ? bar.low <= lane.stop_price : bar.high >= lane.stop_price
    const targetTouched = lane.side === "long" ? bar.high >= lane.target_price : bar.low <= lane.target_price
    if (stopTouched || targetTouched) {
      return protectionCandidate(lane, decision, bar, index, "bar_range_touch", stopTouched, targetTouched)
    }
  }
  return null
}

function protectionCandidate(
  lane: ReplayPortfolioProtectiveTerminalLane,
  decision: ReplayPortfolioAllocationDecision,
  bar: ReplayMarketBar,
  index: number,
  observation: "bar_open_gap" | "bar_range_touch",
  stopTouched: boolean,
  targetTouched: boolean,
): TerminalCandidate {
  const eventTime = observation === "bar_open_gap" ? bar.open_time : bar.close_time
  const sourceEvent: ReplaySourceEvent = {
    source_event_id: `portfolio:${lane.lane_id}:${observation}:${index}:${eventTime}`,
    kind: observation === "bar_open_gap" ? "bar_open" : "bar_range",
    source_index: index,
    event_key: { event_time: eventTime, boundary_phase: 20, source_sequence: index + 1,
      event_subphase: 0, stable_event_id: `portfolio:${lane.lane_id}:${observation}:${index}:${eventTime}` },
  }
  const resolution = createReplaySimpleBracketOhlcvResolution({
    run_id: lane.run_id,
    source_event: sourceEvent,
    bar,
    position_side: lane.side,
    active_protection: {
      protection_generation: 1, remaining_quantity: lane.quantity,
      stop_order_id: `${lane.run_id}:order:stop`, stop_trigger_price: lane.stop_price,
      target_order_id: `${lane.run_id}:order:target`, target_trigger_price: lane.target_price,
    },
    economics: {
      entry_basis_price: decision.execution_price,
      exit_side: lane.side === "long" ? "sell" : "buy",
      cost_policy_id: lane.cost_policy_id,
      cost_policy_version: lane.cost_policy_version,
      fee_bps: lane.fee_bps,
      slippage_bps: lane.slippage_bps,
      price_increment: lane.price_increment,
      settlement_increment: lane.settlement_increment,
      settlement_asset: lane.settlement_asset,
    },
    observation_kind: observation,
    stop_touched: stopTouched,
    target_touched: targetTouched,
    canonical_terminal_role: stopTouched ? "stop" : "target",
  })
  const path = resolution.paths.find((item) => item.path_id === resolution.canonical.path_id)!
  return {
    owner: resolution.canonical.terminal_role === "stop" ? "initial_protective_stop" : "initial_take_profit",
    event_time: eventTime,
    phase: 20,
    same_phase_rank: observation === "bar_open_gap" ? 0 : 2,
    source_hash: resolution.evidence_hash,
    resolution,
    realized_pnl: path.gross_realized_pnl,
    exit_fee: path.exit_fee,
    liquidation_fee: 0,
    upstream_event_hash: null,
  }
}

function upstreamCandidate(
  risk: ReplayRuntimeSharedWalletRiskResult,
  decision: ReplayPortfolioAllocationDecision,
): TerminalCandidate | null {
  const event = risk.global_source_event_queue.find((item) => item.lane_id === decision.lane_id && (
    item.event_role === "liquidation" || item.event_role === "exit" && item.outcome === "filled"
  ))
  if (!event || event.event_role !== "liquidation" && event.event_role !== "exit") return null
  const closed = risk.closed_positions.find((position) => position.lane_id === decision.lane_id)
  if (!closed) throw new Error(`Portfolio protective terminal ${decision.lane_id} upstream close is missing`)
  return {
    owner: event.event_role === "liquidation" ? "exact_liquidation" : "strategy_exit",
    event_time: event.event_time,
    phase: event.boundary_phase,
    same_phase_rank: event.event_role === "liquidation" ? 0 : 1,
    source_hash: event.event_hash,
    resolution: null,
    realized_pnl: closed.realized_pnl,
    exit_fee: closed.exit_trading_fee,
    liquidation_fee: closed.liquidation_fee,
    upstream_event_hash: event.event_hash,
  }
}

function chooseWinner(left: TerminalCandidate | null, right: TerminalCandidate | null): TerminalCandidate | null {
  if (!left) return right
  if (!right) return left
  const leftKey = [Date.parse(left.event_time), left.phase, left.same_phase_rank]
  const rightKey = [Date.parse(right.event_time), right.phase, right.same_phase_rank]
  for (let index = 0; index < leftKey.length; index += 1) {
    if (leftKey[index] !== rightKey[index]) return leftKey[index]! < rightKey[index]! ? left : right
  }
  return left.source_hash < right.source_hash ? left : right
}

function fundingBefore(
  risk: ReplayRuntimeSharedWalletRiskResult,
  laneId: string,
  terminal: TerminalCandidate | null,
): number {
  return risk.global_source_event_queue.reduce((total, event) => {
    if (event.event_role !== "funding" || event.lane_id !== laneId || event.outcome !== "applied") return total
    if (terminal && (Date.parse(event.event_time) > Date.parse(terminal.event_time)
        || event.event_time === terminal.event_time && event.boundary_phase >= terminal.phase)) return total
    return addReplayDecimalValues(total, event.funding_cashflow)
  }, 0)
}

function validateInput(input: ReplayPortfolioProtectiveTerminalEngineInput): void {
  assertReplayIntegratedPortfolioArtifactManifest(input.integrated_manifest)
  assertReplayPortfolioMarkRiskRevaluationArtifactManifest(input.revaluation_manifest)
  assertReplayPortfolioMarkRiskRevaluationEvidence(input.revaluation_evidence)
  if (input.allocation_result.result_hash !== replayPortfolioAllocationResultHash(input.allocation_result)
      || input.risk_result.result_hash !== replayRuntimeSharedWalletRiskResultHash(input.risk_result)
      || input.integrated_result.result_hash !== replayIntegratedPortfolioResultHash(input.integrated_result)
      || input.integrated_result.result_hash !== input.revaluation_evidence.integrated_result_hash
      || input.integrated_manifest.manifest_hash !== input.revaluation_evidence.integrated_artifact_manifest_hash
      || input.allocation_result.result_hash !== input.revaluation_evidence.allocation_result_hash
      || input.risk_result.result_hash !== input.revaluation_evidence.risk_result_hash
      || input.revaluation_manifest.revaluation_evidence_hash !== input.revaluation_evidence.evidence_hash
      || input.integrated_result.portfolio_id !== input.revaluation_evidence.portfolio_id
      || input.lanes.length !== input.allocation_result.allocation_cycles.flatMap((cycle) => cycle.decisions).length
      || new Set(input.lanes.map((lane) => lane.lane_id)).size !== input.lanes.length) {
    throw new Error("Portfolio protective terminal source closure drift")
  }
  const decisions = new Map(input.allocation_result.allocation_cycles.flatMap((cycle) => cycle.decisions)
    .map((decision) => [decision.lane_id, decision]))
  for (const lane of input.lanes) {
    const decision = decisions.get(lane.lane_id)
    if (!decision || decision.request_hash !== lane.request_hash || decision.symbol !== lane.symbol
        || decision.position_side !== lane.side || decision.quantity !== lane.quantity
        || decision.protective_stop_execution_price !== lane.stop_price
        || canonicalHash(lane.bars) !== lane.bars_hash || lane.bars.some((bar) => !bar.closed)
        || lane.side === "long" && !(lane.stop_price < decision.execution_price && decision.execution_price < lane.target_price)
        || lane.side === "short" && !(lane.target_price < decision.execution_price && decision.execution_price < lane.stop_price)) {
      throw new Error(`Portfolio protective terminal lane ${lane.lane_id} binding drift`)
    }
  }
}

function ownerCounts(records: ReplayPortfolioProtectiveTerminalRecord[]): Record<ReplayPortfolioProtectiveTerminalOwner, number> {
  const counts = { not_opened: 0, initial_protective_stop: 0, initial_take_profit: 0,
    exact_liquidation: 0, strategy_exit: 0, open_at_data_end: 0 }
  for (const record of records) counts[record.owner] += 1
  return counts
}
