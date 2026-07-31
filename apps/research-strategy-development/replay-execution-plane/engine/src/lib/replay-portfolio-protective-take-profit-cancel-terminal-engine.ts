import {
  REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_CANCEL_TERMINAL_EVIDENCE_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_CANCEL_TERMINAL_LIMITATIONS,
  REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_CANCEL_TERMINAL_POLICY_VERSION,
  assertReplayPortfolioProtectiveTakeProfitCancelTerminalEvidence,
  replayPortfolioProtectiveTakeProfitCancelTerminalEvidenceHash,
  replayPortfolioProtectiveTakeProfitCancelTerminalFingerprintHash,
  replayPortfolioProtectiveTakeProfitCancelTerminalRecordHash,
  type ReplayPortfolioProtectiveTakeProfitCancelStatus,
  type ReplayPortfolioProtectiveTakeProfitCancelTerminalEvidence,
  type ReplayPortfolioProtectiveTakeProfitCancelTerminalFingerprint,
  type ReplayPortfolioProtectiveTakeProfitCancelTerminalOwner,
  type ReplayPortfolioProtectiveTakeProfitCancelTerminalRecord,
} from "../../../contracts/src/lib/replay-portfolio-protective-take-profit-cancel-terminal-contracts"
import {
  assertReplayPortfolioProtectiveTerminalArtifactManifest,
  assertReplayPortfolioProtectiveTerminalEvidence,
  type ReplayPortfolioProtectiveTerminalArtifactManifest,
  type ReplayPortfolioProtectiveTerminalEvidence,
  type ReplayPortfolioProtectiveTerminalRecord,
} from "../../../contracts/src/lib/replay-portfolio-protective-terminal-contracts"
import { replayRuntimeSharedWalletRiskResultHash, type ReplayRuntimeSharedWalletRiskResult } from
  "../../../contracts/src/lib/replay-runtime-shared-wallet-risk-contracts"
import { canonicalHash, type ReplayMarketBar, type ReplayOhlcvResolutionEvidence, type ReplayTakeProfitCancelIntent } from
  "../../../contracts/src/lib/replay-contracts"
import { addReplayDecimalValues, quantizeReplayDifferenceProduct } from "../../../contracts/src/lib/replay-decimal"
import {
  aggregateReplayPortfolioProtectiveReplacementTerminal,
  chooseReplayPortfolioProtectiveReplacementWinner,
  createReplayPortfolioProtectiveReplacementOhlcvCandidate,
  replayPortfolioProtectiveReplacementFundingBefore,
  replayPortfolioProtectiveReplacementUpstreamCandidate,
  replayPortfolioProtectiveReplacementWinnerFields,
  type ReplayPortfolioProtectiveReplacementTerminalCandidate,
} from "./replay-portfolio-protective-replacement-terminal-engine-common"

export interface ReplayPortfolioProtectiveTakeProfitCancelTerminalLane {
  lane_id: string; run_id: string; request_hash: string; bars: ReplayMarketBar[]; bars_hash: string
  cost_policy_id: string; cost_policy_version: string; fee_bps: number; slippage_bps: number
  price_increment: string; settlement_increment: string; settlement_asset: string
  cancel: { decision_sequence: number; decision_time: string; intent: ReplayTakeProfitCancelIntent; intent_hash: string } | null
}
export interface ReplayPortfolioProtectiveTakeProfitCancelTerminalEngineInput {
  source_evidence: ReplayPortfolioProtectiveTerminalEvidence
  source_manifest: ReplayPortfolioProtectiveTerminalArtifactManifest
  risk_result: ReplayRuntimeSharedWalletRiskResult
  lanes: ReplayPortfolioProtectiveTakeProfitCancelTerminalLane[]
}
type Candidate = ReplayPortfolioProtectiveReplacementTerminalCandidate<
  Exclude<ReplayPortfolioProtectiveTakeProfitCancelTerminalOwner, "not_opened" | "open_at_data_end">
>

export function executeReplayPortfolioProtectiveTakeProfitCancelTerminal(
  input: ReplayPortfolioProtectiveTakeProfitCancelTerminalEngineInput,
): ReplayPortfolioProtectiveTakeProfitCancelTerminalEvidence {
  validateInput(input)
  const aggregated = aggregateReplayPortfolioProtectiveReplacementTerminal(
    input.source_evidence.lane_records, input.lanes,
    (source, lane) => buildRecord(input, source, lane as ReplayPortfolioProtectiveTakeProfitCancelTerminalLane),
    input.source_evidence.shared_initial_cash,
  )
  const fingerprintBody: Omit<ReplayPortfolioProtectiveTakeProfitCancelTerminalFingerprint, "fingerprint_hash"> = {
    experiment_id: input.source_evidence.experiment_id, trial_group_id: input.source_evidence.trial_group_id,
    trial_group_hash: input.source_evidence.trial_group_hash, portfolio_id: input.source_evidence.portfolio_id,
    source_protective_terminal_evidence_hash: input.source_evidence.evidence_hash,
    source_protective_terminal_artifact_manifest_hash: input.source_manifest.manifest_hash,
    risk_result_hash: input.risk_result.result_hash, lane_records_hash: aggregated.lane_records_hash,
    ohlcv_resolutions_hash: aggregated.resolutions_hash,
    economic_summary_hash: canonicalHash(aggregated.economicSummary),
    limitations_hash: canonicalHash(REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_CANCEL_TERMINAL_LIMITATIONS),
  }
  const fingerprint = { ...fingerprintBody,
    fingerprint_hash: replayPortfolioProtectiveTakeProfitCancelTerminalFingerprintHash(fingerprintBody) }
  const body: Omit<ReplayPortfolioProtectiveTakeProfitCancelTerminalEvidence, "evidence_hash"> = {
    schema_version: REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_CANCEL_TERMINAL_EVIDENCE_SCHEMA_VERSION,
    policy_version: REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_CANCEL_TERMINAL_POLICY_VERSION,
    experiment_id: input.source_evidence.experiment_id, trial_group_id: input.source_evidence.trial_group_id,
    trial_group_hash: input.source_evidence.trial_group_hash, portfolio_id: input.source_evidence.portfolio_id,
    settlement_asset: input.source_evidence.settlement_asset,
    shared_initial_cash: input.source_evidence.shared_initial_cash,
    source_protective_terminal_evidence_hash: input.source_evidence.evidence_hash,
    source_protective_terminal_artifact_manifest_hash: input.source_manifest.manifest_hash,
    risk_result_hash: input.risk_result.result_hash, lane_records: aggregated.records,
    lane_records_hash: aggregated.lane_records_hash, ohlcv_resolutions: aggregated.resolutions,
    ohlcv_resolutions_hash: aggregated.resolutions_hash, ...aggregated.economicSummary,
    ending_gross_mark_exposure: input.source_evidence.ending_gross_mark_exposure,
    ending_net_mark_exposure: input.source_evidence.ending_net_mark_exposure,
    ending_portfolio_frozen_stop_risk: endingStopRisk(aggregated.records),
    terminal_owner_counts: ownerCounts(aggregated.records),
    limitations: REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_CANCEL_TERMINAL_LIMITATIONS, fingerprint,
  }
  const evidence = { ...body, evidence_hash: replayPortfolioProtectiveTakeProfitCancelTerminalEvidenceHash(body) }
  assertReplayPortfolioProtectiveTakeProfitCancelTerminalEvidence(evidence, {
    evidence: input.source_evidence, manifest: input.source_manifest, risk_result_hash: input.risk_result.result_hash,
  })
  return evidence
}

function buildRecord(input: ReplayPortfolioProtectiveTakeProfitCancelTerminalEngineInput,
  source: ReplayPortfolioProtectiveTerminalRecord, lane: ReplayPortfolioProtectiveTakeProfitCancelTerminalLane) {
  if (source.owner === "not_opened") return preserve(source, input.source_evidence, "not_opened", null)
  if (!lane.cancel) return preserve(source, input.source_evidence, "not_configured", null)
  if (source.terminal_time !== null && Date.parse(source.terminal_time) <= Date.parse(lane.cancel.decision_time)) {
    return preserve(source, input.source_evidence, "terminal_before_or_at_decision", lane.cancel)
  }
  const protection = firstPostCancelStop(lane, source)
  const upstream = replayPortfolioProtectiveReplacementUpstreamCandidate(source) as Candidate | null
  const winner = chooseReplayPortfolioProtectiveReplacementWinner(protection, upstream)
  if (!winner) return openAfterCancel(input, source, lane)
  const funding = replayPortfolioProtectiveReplacementFundingBefore(input.risk_result, lane.lane_id, winner)
  return complete({
    ...withoutRecordHash(source),
    ...replayPortfolioProtectiveReplacementWinnerFields(source, winner, protection, upstream, funding),
    preempted_upstream_terminal_hash: source.owner === "initial_take_profit"
      ? source.terminal_source_hash : protection === winner && upstream ? upstream.source_hash : null,
    source_protective_terminal_record_hash: source.record_hash, cancel_status: "cancelled_then_terminal",
    cancel_decision_sequence: lane.cancel.decision_sequence, cancel_decision_time: lane.cancel.decision_time,
    cancel_intent_hash: lane.cancel.intent_hash, cancelled_target_price: source.target_price,
    active_protection_mode: "stop_only",
  }, winner.resolution)
}

function openAfterCancel(input: ReplayPortfolioProtectiveTakeProfitCancelTerminalEngineInput,
  source: ReplayPortfolioProtectiveTerminalRecord, lane: ReplayPortfolioProtectiveTakeProfitCancelTerminalLane) {
  const open = input.risk_result.open_positions.find((position) => position.lane_id === lane.lane_id)
  if (!open) throw new Error(`Portfolio take-profit cancel terminal Lane ${lane.lane_id} lacks terminal or open Position`)
  return complete({
    ...withoutRecordHash(source), owner: "open_at_data_end", terminal_time: null, terminal_phase: null,
    terminal_source_hash: null, preempted_upstream_terminal_hash: source.terminal_source_hash,
    ohlcv_resolution_evidence_hash: null, resolution_status: "not_applicable",
    funding_cashflow_before_terminal: addReplayDecimalValues(open.attributed_settled_cashflow, source.entry_fee),
    realized_pnl: 0, exit_trading_fee: 0, liquidation_fee: 0, released_collateral: 0,
    ending_unrealized_pnl: open.unrealized_pnl, ending_open: true,
    source_protective_terminal_record_hash: source.record_hash, cancel_status: "cancelled_no_terminal",
    cancel_decision_sequence: lane.cancel!.decision_sequence, cancel_decision_time: lane.cancel!.decision_time,
    cancel_intent_hash: lane.cancel!.intent_hash, cancelled_target_price: source.target_price,
    active_protection_mode: "stop_only",
  }, null)
}

function preserve(source: ReplayPortfolioProtectiveTerminalRecord,
  evidence: ReplayPortfolioProtectiveTerminalEvidence, status: ReplayPortfolioProtectiveTakeProfitCancelStatus,
  cancel: ReplayPortfolioProtectiveTakeProfitCancelTerminalLane["cancel"]) {
  const resolution = source.ohlcv_resolution_evidence_hash === null ? null
    : evidence.ohlcv_resolutions.find((item) => item.evidence_hash === source.ohlcv_resolution_evidence_hash) ?? null
  return complete({ ...withoutRecordHash(source), source_protective_terminal_record_hash: source.record_hash,
    cancel_status: status, cancel_decision_sequence: cancel?.decision_sequence ?? null,
    cancel_decision_time: cancel?.decision_time ?? null, cancel_intent_hash: cancel?.intent_hash ?? null,
    cancelled_target_price: cancel ? source.target_price : null, active_protection_mode: "bracket" }, resolution)
}

function firstPostCancelStop(lane: ReplayPortfolioProtectiveTakeProfitCancelTerminalLane,
  source: ReplayPortfolioProtectiveTerminalRecord): Candidate | null {
  const bars = lane.bars.map((bar, index) => ({ bar, index }))
    .filter(({ bar }) => Date.parse(bar.open_time) >= Date.parse(lane.cancel!.decision_time))
    .sort((a, b) => Date.parse(a.bar.open_time) - Date.parse(b.bar.open_time))
  for (const { bar, index } of bars) {
    const openStop = source.side === "long" ? bar.open <= source.stop_price : bar.open >= source.stop_price
    if (openStop) return stopCandidate(lane, source, bar, index, "bar_open_gap")
    const stopTouched = source.side === "long" ? bar.low <= source.stop_price : bar.high >= source.stop_price
    if (stopTouched) return stopCandidate(lane, source, bar, index, "bar_range_touch")
  }
  return null
}
function stopCandidate(lane: ReplayPortfolioProtectiveTakeProfitCancelTerminalLane,
  source: ReplayPortfolioProtectiveTerminalRecord, bar: ReplayMarketBar, index: number,
  observation: "bar_open_gap" | "bar_range_touch"): Candidate {
  return createReplayPortfolioProtectiveReplacementOhlcvCandidate({ lane, source, bar, index, observation,
    stop_touched: true, target_touched: false,
    active_protection: { protection_mode: "stop_only", protection_generation: 1,
      remaining_quantity: source.quantity, stop_order_id: `${lane.run_id}:order:stop`,
      stop_trigger_price: source.stop_price, stop_order_status: "active",
      target_order_id: `${lane.run_id}:order:target`, target_trigger_price: source.target_price,
      target_order_status: "cancelled" },
    stop_owner: "initial_protective_stop", target_owner: "initial_take_profit" })
}

function validateInput(input: ReplayPortfolioProtectiveTakeProfitCancelTerminalEngineInput): void {
  assertReplayPortfolioProtectiveTerminalEvidence(input.source_evidence)
  assertReplayPortfolioProtectiveTerminalArtifactManifest(input.source_manifest)
  if (input.source_manifest.protective_terminal_evidence_hash !== input.source_evidence.evidence_hash
      || input.risk_result.result_hash !== replayRuntimeSharedWalletRiskResultHash(input.risk_result)
      || input.risk_result.result_hash !== input.source_evidence.risk_result_hash
      || input.lanes.length !== input.source_evidence.lane_records.length
      || new Set(input.lanes.map((lane) => lane.lane_id)).size !== input.lanes.length) {
    throw new Error("Portfolio take-profit cancel terminal source closure drift")
  }
  const sourceByLane = new Map(input.source_evidence.lane_records.map((record) => [record.lane_id, record]))
  for (const lane of input.lanes) {
    const source = sourceByLane.get(lane.lane_id)
    if (!source || source.request_hash !== lane.request_hash || canonicalHash(lane.bars) !== lane.bars_hash) {
      throw new Error(`Portfolio take-profit cancel terminal Lane ${lane.lane_id} binding drift`)
    }
    if (!lane.cancel) continue
    const { intent } = lane.cancel
    if (lane.cancel.intent_hash !== canonicalHash(intent) || lane.cancel.decision_time !== intent.effective_at
        || !Number.isSafeInteger(lane.cancel.decision_sequence) || lane.cancel.decision_sequence < 1
        || !lane.bars.some((bar) => bar.close_time === lane.cancel!.decision_time)
        || intent.target_order_id !== `${lane.run_id}:order:target`
        || intent.target_order_role !== "target" || intent.target_order_type !== "take_profit_market"
        || intent.cancel_policy !== "cancel_active_target_preserve_stop"
        || intent.stop_preservation_policy !== "require_active_full_position_stop"
        || intent.schedule_combination_policy !== "initial_bracket_only_no_other_position_mutation"
        || intent.reason_code !== "take_profit_condition_revoked") {
      throw new Error(`Portfolio take-profit cancel terminal Lane ${lane.lane_id} cancel drift`)
    }
  }
}
function complete(body: Omit<ReplayPortfolioProtectiveTakeProfitCancelTerminalRecord, "record_hash">,
  resolution: ReplayOhlcvResolutionEvidence | null) {
  return { record: { ...body, record_hash: replayPortfolioProtectiveTakeProfitCancelTerminalRecordHash(body) }, resolution }
}
function withoutRecordHash(record: ReplayPortfolioProtectiveTerminalRecord) { const { record_hash: _, ...body } = record; return body }
function endingStopRisk(records: ReplayPortfolioProtectiveTakeProfitCancelTerminalRecord[]): number {
  return addReplayDecimalValues(...records.filter((record) => record.ending_open).map((record) => Math.max(0,
    -quantizeReplayDifferenceProduct(record.stop_price, record.entry_price, record.quantity,
      record.side === "long" ? 1 : -1, "0.00000001", "floor"))))
}
function ownerCounts(records: ReplayPortfolioProtectiveTakeProfitCancelTerminalRecord[]) {
  const counts: Record<ReplayPortfolioProtectiveTakeProfitCancelTerminalOwner, number> = {
    not_opened: 0, initial_protective_stop: 0, initial_take_profit: 0,
    exact_liquidation: 0, strategy_exit: 0, open_at_data_end: 0,
  }
  for (const record of records) counts[record.owner] += 1
  return counts
}
