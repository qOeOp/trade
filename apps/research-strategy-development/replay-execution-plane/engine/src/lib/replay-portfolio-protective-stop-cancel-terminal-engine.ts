import {
  REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_EVIDENCE_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_LIMITATIONS,
  REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_POLICY_VERSION,
  REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_RISK_STATE_POLICY,
  assertReplayPortfolioProtectiveStopCancelTerminalEvidence,
  replayPortfolioProtectiveStopCancelTerminalEvidenceHash,
  replayPortfolioProtectiveStopCancelTerminalFingerprintHash,
  replayPortfolioProtectiveStopCancelTerminalRecordHash,
  type ReplayPortfolioProtectiveStopCancelStatus,
  type ReplayPortfolioProtectiveStopCancelTerminalEvidence,
  type ReplayPortfolioProtectiveStopCancelTerminalFingerprint,
  type ReplayPortfolioProtectiveStopCancelTerminalOwner,
  type ReplayPortfolioProtectiveStopCancelTerminalRecord,
} from "../../../contracts/src/lib/replay-portfolio-protective-stop-cancel-terminal-contracts"
import {
  assertReplayPortfolioProtectiveTerminalArtifactManifest,
  assertReplayPortfolioProtectiveTerminalEvidence,
  type ReplayPortfolioProtectiveTerminalArtifactManifest,
  type ReplayPortfolioProtectiveTerminalEvidence,
  type ReplayPortfolioProtectiveTerminalRecord,
} from "../../../contracts/src/lib/replay-portfolio-protective-terminal-contracts"
import { replayRuntimeSharedWalletRiskResultHash, type ReplayRuntimeSharedWalletRiskResult } from
  "../../../contracts/src/lib/replay-runtime-shared-wallet-risk-contracts"
import {
  canonicalHash,
  type ReplayMarketBar,
  type ReplayOhlcvResolutionEvidence,
  type ReplayProtectiveStopCancelIntent,
} from "../../../contracts/src/lib/replay-contracts"
import {
  addReplayDecimalValues,
  quantizeReplayDifferenceProduct,
  quantizeReplayProduct,
} from "../../../contracts/src/lib/replay-decimal"
import { applyAdverseSlippageV3, calculateNotionalChargeV3 } from
  "../../../accounting/src/lib/replay-accounting"
import {
  aggregateReplayPortfolioProtectiveReplacementTerminal,
  chooseReplayPortfolioProtectiveReplacementWinner,
  createReplayPortfolioProtectiveReplacementOhlcvCandidate,
  replayPortfolioProtectiveReplacementFundingBefore,
  replayPortfolioProtectiveReplacementUpstreamCandidate,
  replayPortfolioProtectiveReplacementWinnerFields,
  type ReplayPortfolioProtectiveReplacementTerminalCandidate,
} from "./replay-portfolio-protective-replacement-terminal-engine-common"

export interface ReplayPortfolioProtectiveStopCancelTerminalLane {
  lane_id: string; run_id: string; request_hash: string; bars: ReplayMarketBar[]; bars_hash: string
  cost_policy_id: string; cost_policy_version: string; fee_bps: number; slippage_bps: number
  price_increment: string; settlement_increment: string; settlement_asset: string
  cancel: { decision_sequence: number; decision_time: string; intent: ReplayProtectiveStopCancelIntent; intent_hash: string } | null
}
export interface ReplayPortfolioProtectiveStopCancelTerminalEngineInput {
  source_evidence: ReplayPortfolioProtectiveTerminalEvidence
  source_manifest: ReplayPortfolioProtectiveTerminalArtifactManifest
  risk_result: ReplayRuntimeSharedWalletRiskResult
  lanes: ReplayPortfolioProtectiveStopCancelTerminalLane[]
}
type Candidate = ReplayPortfolioProtectiveReplacementTerminalCandidate<
  Exclude<ReplayPortfolioProtectiveStopCancelTerminalOwner, "not_opened" | "open_at_data_end">
>

export function executeReplayPortfolioProtectiveStopCancelTerminal(
  input: ReplayPortfolioProtectiveStopCancelTerminalEngineInput,
): ReplayPortfolioProtectiveStopCancelTerminalEvidence {
  validateInput(input)
  const aggregated = aggregateReplayPortfolioProtectiveReplacementTerminal(
    input.source_evidence.lane_records, input.lanes,
    (source, lane) => buildRecord(input, source, lane as ReplayPortfolioProtectiveStopCancelTerminalLane),
    input.source_evidence.shared_initial_cash,
  )
  const riskState = aggregateRiskState(aggregated.records)
  const exposure = endingExposure(input.risk_result, aggregated.records, input.lanes)
  const fingerprintBody: Omit<ReplayPortfolioProtectiveStopCancelTerminalFingerprint, "fingerprint_hash"> = {
    experiment_id: input.source_evidence.experiment_id, trial_group_id: input.source_evidence.trial_group_id,
    trial_group_hash: input.source_evidence.trial_group_hash, portfolio_id: input.source_evidence.portfolio_id,
    source_protective_terminal_evidence_hash: input.source_evidence.evidence_hash,
    source_protective_terminal_artifact_manifest_hash: input.source_manifest.manifest_hash,
    risk_result_hash: input.risk_result.result_hash, lane_records_hash: aggregated.lane_records_hash,
    ohlcv_resolutions_hash: aggregated.resolutions_hash,
    economic_summary_hash: canonicalHash(aggregated.economicSummary),
    risk_state_hash: canonicalHash(riskState),
    limitations_hash: canonicalHash(REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_LIMITATIONS),
  }
  const fingerprint = { ...fingerprintBody,
    fingerprint_hash: replayPortfolioProtectiveStopCancelTerminalFingerprintHash(fingerprintBody) }
  const body: Omit<ReplayPortfolioProtectiveStopCancelTerminalEvidence, "evidence_hash"> = {
    schema_version: REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_EVIDENCE_SCHEMA_VERSION,
    policy_version: REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_POLICY_VERSION,
    experiment_id: input.source_evidence.experiment_id, trial_group_id: input.source_evidence.trial_group_id,
    trial_group_hash: input.source_evidence.trial_group_hash, portfolio_id: input.source_evidence.portfolio_id,
    settlement_asset: input.source_evidence.settlement_asset,
    shared_initial_cash: input.source_evidence.shared_initial_cash,
    source_protective_terminal_evidence_hash: input.source_evidence.evidence_hash,
    source_protective_terminal_artifact_manifest_hash: input.source_manifest.manifest_hash,
    risk_result_hash: input.risk_result.result_hash, lane_records: aggregated.records,
    lane_records_hash: aggregated.lane_records_hash, ohlcv_resolutions: aggregated.resolutions,
    ohlcv_resolutions_hash: aggregated.resolutions_hash, ...aggregated.economicSummary,
    ending_gross_mark_exposure: exposure.gross, ending_net_mark_exposure: exposure.net,
    risk_state_policy: REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_RISK_STATE_POLICY,
    ...riskState,
    terminal_owner_counts: ownerCounts(aggregated.records),
    limitations: REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_LIMITATIONS, fingerprint,
  }
  const evidence = { ...body, evidence_hash: replayPortfolioProtectiveStopCancelTerminalEvidenceHash(body) }
  assertReplayPortfolioProtectiveStopCancelTerminalEvidence(evidence, {
    evidence: input.source_evidence, manifest: input.source_manifest, risk_result_hash: input.risk_result.result_hash,
  })
  return evidence
}

function buildRecord(input: ReplayPortfolioProtectiveStopCancelTerminalEngineInput,
  source: ReplayPortfolioProtectiveTerminalRecord, lane: ReplayPortfolioProtectiveStopCancelTerminalLane) {
  if (source.owner === "not_opened") return preserve(source, input.source_evidence, lane, "not_opened", null)
  if (!lane.cancel) return preserve(source, input.source_evidence, lane, "not_configured", null)
  if (source.terminal_time !== null && Date.parse(source.terminal_time) <= Date.parse(lane.cancel.decision_time)) {
    return preserve(source, input.source_evidence, lane, "terminal_before_or_at_decision", lane.cancel)
  }
  const protection = firstPostCancelTarget(lane, source)
  const upstream = (replayPortfolioProtectiveReplacementUpstreamCandidate(source)
    ?? riskUpstreamCandidate(input.risk_result, lane.lane_id)) as Candidate | null
  const winner = chooseReplayPortfolioProtectiveReplacementWinner(protection, upstream)
  if (!winner) return openAfterCancel(input, source, lane)
  const funding = replayPortfolioProtectiveReplacementFundingBefore(input.risk_result, lane.lane_id, winner)
  return complete({
    ...withoutRecordHash(source),
    ...replayPortfolioProtectiveReplacementWinnerFields(source, winner, protection, upstream, funding),
    preempted_upstream_terminal_hash: source.owner === "initial_protective_stop"
      ? source.terminal_source_hash : protection === winner && upstream ? upstream.source_hash : null,
    source_protective_terminal_record_hash: source.record_hash, cancel_status: "cancelled_then_terminal",
    cancel_decision_sequence: lane.cancel.decision_sequence, cancel_decision_time: lane.cancel.decision_time,
    cancel_intent_hash: lane.cancel.intent_hash, cancelled_stop_price: source.stop_price,
    active_protection_mode: "target_only", ...riskFields(source, lane, false, false),
  }, winner.resolution)
}

function openAfterCancel(input: ReplayPortfolioProtectiveStopCancelTerminalEngineInput,
  source: ReplayPortfolioProtectiveTerminalRecord, lane: ReplayPortfolioProtectiveStopCancelTerminalLane) {
  const open = input.risk_result.open_positions.find((position) => position.lane_id === lane.lane_id)
  if (!open) throw new Error(`Portfolio protective-stop cancel terminal Lane ${lane.lane_id} lacks terminal or open Position`)
  return complete({
    ...withoutRecordHash(source), owner: "open_at_data_end", terminal_time: null, terminal_phase: null,
    terminal_source_hash: null, preempted_upstream_terminal_hash: source.terminal_source_hash,
    ohlcv_resolution_evidence_hash: null, resolution_status: "not_applicable",
    funding_cashflow_before_terminal: addReplayDecimalValues(open.attributed_settled_cashflow, source.entry_fee),
    realized_pnl: 0, exit_trading_fee: 0, liquidation_fee: 0, released_collateral: 0,
    ending_unrealized_pnl: open.unrealized_pnl, ending_open: true,
    source_protective_terminal_record_hash: source.record_hash, cancel_status: "cancelled_no_terminal",
    cancel_decision_sequence: lane.cancel!.decision_sequence, cancel_decision_time: lane.cancel!.decision_time,
    cancel_intent_hash: lane.cancel!.intent_hash, cancelled_stop_price: source.stop_price,
    active_protection_mode: "target_only", ...riskFields(source, lane, true, true),
  }, null)
}

function preserve(source: ReplayPortfolioProtectiveTerminalRecord,
  evidence: ReplayPortfolioProtectiveTerminalEvidence, lane: ReplayPortfolioProtectiveStopCancelTerminalLane,
  status: ReplayPortfolioProtectiveStopCancelStatus,
  cancel: ReplayPortfolioProtectiveStopCancelTerminalLane["cancel"]) {
  const resolution = source.ohlcv_resolution_evidence_hash === null ? null
    : evidence.ohlcv_resolutions.find((item) => item.evidence_hash === source.ohlcv_resolution_evidence_hash) ?? null
  return complete({ ...withoutRecordHash(source), source_protective_terminal_record_hash: source.record_hash,
    cancel_status: status, cancel_decision_sequence: cancel?.decision_sequence ?? null,
    cancel_decision_time: cancel?.decision_time ?? null, cancel_intent_hash: cancel?.intent_hash ?? null,
    cancelled_stop_price: cancel ? source.stop_price : null, active_protection_mode: "bracket",
    ...riskFields(source, lane, false, source.ending_open),
  }, resolution)
}

function firstPostCancelTarget(lane: ReplayPortfolioProtectiveStopCancelTerminalLane,
  source: ReplayPortfolioProtectiveTerminalRecord): Candidate | null {
  const bars = lane.bars.map((bar, index) => ({ bar, index }))
    .filter(({ bar }) => Date.parse(bar.open_time) >= Date.parse(lane.cancel!.decision_time))
    .sort((a, b) => Date.parse(a.bar.open_time) - Date.parse(b.bar.open_time))
  for (const { bar, index } of bars) {
    const openTarget = source.side === "long" ? bar.open >= source.target_price : bar.open <= source.target_price
    if (openTarget) return targetCandidate(lane, source, bar, index, "bar_open_gap")
    const targetTouched = source.side === "long" ? bar.high >= source.target_price : bar.low <= source.target_price
    if (targetTouched) return targetCandidate(lane, source, bar, index, "bar_range_touch")
  }
  return null
}
function targetCandidate(lane: ReplayPortfolioProtectiveStopCancelTerminalLane,
  source: ReplayPortfolioProtectiveTerminalRecord, bar: ReplayMarketBar, index: number,
  observation: "bar_open_gap" | "bar_range_touch"): Candidate {
  return createReplayPortfolioProtectiveReplacementOhlcvCandidate({ lane, source, bar, index, observation,
    stop_touched: false, target_touched: true,
    active_protection: { protection_mode: "target_only", protection_generation: 1,
      remaining_quantity: source.quantity, stop_order_id: `${lane.run_id}:order:stop`,
      stop_trigger_price: source.stop_price, stop_order_status: "cancelled",
      target_order_id: `${lane.run_id}:order:target`, target_trigger_price: source.target_price,
      target_order_status: "active" },
    stop_owner: "initial_protective_stop", target_owner: "initial_take_profit" })
}

function riskUpstreamCandidate(risk: ReplayRuntimeSharedWalletRiskResult, laneId: string): Candidate | null {
  const event = risk.global_source_event_queue.find(
    (item) => item.lane_id === laneId && item.event_role === "liquidation",
  )
  if (!event || event.event_role !== "liquidation") return null
  const closed = risk.closed_positions.find((position) => position.lane_id === laneId)
  if (!closed || closed.exit_role !== "liquidation") {
    throw new Error(`Portfolio protective-stop cancel Lane ${laneId} liquidation close is missing`)
  }
  return {
    owner: "exact_liquidation", event_time: event.event_time, phase: event.boundary_phase, rank: 0,
    source_hash: event.event_hash, resolution: null, realized_pnl: closed.realized_pnl,
    exit_fee: closed.exit_trading_fee, liquidation_fee: closed.liquidation_fee,
  }
}

function validateInput(input: ReplayPortfolioProtectiveStopCancelTerminalEngineInput): void {
  assertReplayPortfolioProtectiveTerminalEvidence(input.source_evidence)
  assertReplayPortfolioProtectiveTerminalArtifactManifest(input.source_manifest)
  if (input.source_manifest.protective_terminal_evidence_hash !== input.source_evidence.evidence_hash
      || input.risk_result.result_hash !== replayRuntimeSharedWalletRiskResultHash(input.risk_result)
      || input.risk_result.result_hash !== input.source_evidence.risk_result_hash
      || input.lanes.length !== input.source_evidence.lane_records.length
      || new Set(input.lanes.map((lane) => lane.lane_id)).size !== input.lanes.length) {
    throw new Error("Portfolio protective-stop cancel terminal source closure drift")
  }
  const sourceByLane = new Map(input.source_evidence.lane_records.map((record) => [record.lane_id, record]))
  for (const lane of input.lanes) {
    const source = sourceByLane.get(lane.lane_id)
    if (!source || source.request_hash !== lane.request_hash || canonicalHash(lane.bars) !== lane.bars_hash) {
      throw new Error(`Portfolio protective-stop cancel terminal Lane ${lane.lane_id} binding drift`)
    }
    if (!lane.cancel) continue
    const { intent } = lane.cancel
    if (lane.cancel.intent_hash !== canonicalHash(intent) || lane.cancel.decision_time !== intent.effective_at
        || !Number.isSafeInteger(lane.cancel.decision_sequence) || lane.cancel.decision_sequence < 1
        || !lane.bars.some((bar) => bar.close_time === lane.cancel!.decision_time)
        || intent.target_order_id !== `${lane.run_id}:order:stop`
        || intent.target_order_role !== "stop" || intent.target_order_type !== "stop_market"
        || intent.cancel_policy !== "cancel_active_stop_preserve_target"
        || intent.target_preservation_policy !== "require_active_full_position_target"
        || intent.schedule_combination_policy !== "initial_bracket_only_no_other_position_mutation"
        || intent.reason_code !== "protective_stop_condition_revoked") {
      throw new Error(`Portfolio protective-stop cancel terminal Lane ${lane.lane_id} cancel drift`)
    }
  }
}

function riskFields(source: ReplayPortfolioProtectiveTerminalRecord,
  lane: ReplayPortfolioProtectiveStopCancelTerminalLane, unbounded: boolean, endingOpen: boolean) {
  if (source.owner === "not_opened") return {
    admission_frozen_stop_risk_amount: 0, current_active_stop_risk_amount: 0,
    current_risk_state: "not_opened" as const, reserved_admission_risk_amount: 0,
    risk_budget_release_amount: 0, cancel_cashflow: 0 as const,
  }
  const admissionRisk = admissionStopRisk(source, lane)
  if (!endingOpen) return {
    admission_frozen_stop_risk_amount: admissionRisk, current_active_stop_risk_amount: 0,
    current_risk_state: "released_on_full_flat" as const, reserved_admission_risk_amount: 0,
    risk_budget_release_amount: admissionRisk, cancel_cashflow: 0 as const,
  }
  return {
    admission_frozen_stop_risk_amount: admissionRisk,
    current_active_stop_risk_amount: unbounded ? null : admissionRisk,
    current_risk_state: unbounded ? "unbounded_by_active_stop" as const : "protected_by_active_stop" as const,
    reserved_admission_risk_amount: admissionRisk, risk_budget_release_amount: 0, cancel_cashflow: 0 as const,
  }
}

function admissionStopRisk(source: ReplayPortfolioProtectiveTerminalRecord,
  lane: ReplayPortfolioProtectiveStopCancelTerminalLane): number {
  const exitSide = source.side === "long" ? "sell" : "buy"
  const stopExecutionPrice = applyAdverseSlippageV3(
    source.stop_price, exitSide, lane.slippage_bps, lane.price_increment,
  )
  const loss = quantizeReplayDifferenceProduct(
    source.entry_price, stopExecutionPrice, source.quantity, source.side === "long" ? 1 : -1,
    lane.settlement_increment, "ceil",
  )
  const exitFee = calculateNotionalChargeV3(
    stopExecutionPrice, source.quantity, lane.fee_bps, lane.settlement_increment,
  )
  return addReplayDecimalValues(loss, source.entry_fee, exitFee)
}

function aggregateRiskState(records: ReplayPortfolioProtectiveStopCancelTerminalRecord[]) {
  const unboundedLaneIds = records.filter((record) => record.current_risk_state === "unbounded_by_active_stop")
    .map((record) => record.lane_id).sort()
  const activeBounded = unboundedLaneIds.length > 0 ? null : addReplayDecimalValues(
    ...records.map((record) => record.current_active_stop_risk_amount ?? 0),
  )
  return {
    historical_admission_frozen_stop_risk: addReplayDecimalValues(
      ...records.map((record) => record.admission_frozen_stop_risk_amount),
    ),
    ending_portfolio_frozen_stop_risk: addReplayDecimalValues(
      ...records.map((record) => record.reserved_admission_risk_amount),
    ),
    ending_portfolio_active_stop_bounded_risk: activeBounded,
    total_risk_budget_released: addReplayDecimalValues(
      ...records.map((record) => record.risk_budget_release_amount),
    ),
    unbounded_by_active_stop_lane_ids: unboundedLaneIds,
    cancel_cashflow_total: 0 as const,
  }
}

function endingExposure(risk: ReplayRuntimeSharedWalletRiskResult,
  records: ReplayPortfolioProtectiveStopCancelTerminalRecord[],
  lanes: ReplayPortfolioProtectiveStopCancelTerminalLane[]) {
  const open = new Set(records.filter((record) => record.ending_open).map((record) => record.lane_id))
  const positions = risk.open_positions.filter((position) => open.has(position.lane_id))
  if (positions.length !== open.size) throw new Error("Portfolio protective-stop cancel open exposure lacks exact Mark")
  const incrementByLane = new Map(lanes.map((lane) => [lane.lane_id, lane.settlement_increment]))
  const notionals = positions.map((position) => {
    const increment = incrementByLane.get(position.lane_id)
    if (!increment) throw new Error(`Portfolio protective-stop cancel Lane ${position.lane_id} increment missing`)
    return { side: position.side, value: quantizeReplayProduct(
      [position.last_exact_mark_price, position.quantity], 1, increment, "ceil",
    ) }
  })
  return {
    gross: addReplayDecimalValues(...notionals.map((item) => item.value)),
    net: addReplayDecimalValues(...notionals.map((item) => item.side === "long" ? item.value : -item.value)),
  }
}

function complete(body: Omit<ReplayPortfolioProtectiveStopCancelTerminalRecord, "record_hash">,
  resolution: ReplayOhlcvResolutionEvidence | null) {
  return { record: { ...body, record_hash: replayPortfolioProtectiveStopCancelTerminalRecordHash(body) }, resolution }
}
function withoutRecordHash(record: ReplayPortfolioProtectiveTerminalRecord) {
  const { record_hash: _, ...body } = record; return body
}
function ownerCounts(records: ReplayPortfolioProtectiveStopCancelTerminalRecord[]) {
  const counts: Record<ReplayPortfolioProtectiveStopCancelTerminalOwner, number> = {
    not_opened: 0, initial_protective_stop: 0, initial_take_profit: 0,
    exact_liquidation: 0, strategy_exit: 0, open_at_data_end: 0,
  }
  for (const record of records) counts[record.owner] += 1
  return counts
}
