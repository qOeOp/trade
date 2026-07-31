import {
  REPLAY_PORTFOLIO_PROTECTIVE_STRATEGY_EXIT_CANCEL_TERMINAL_EVIDENCE_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_PROTECTIVE_STRATEGY_EXIT_CANCEL_TERMINAL_LIMITATIONS,
  REPLAY_PORTFOLIO_PROTECTIVE_STRATEGY_EXIT_CANCEL_TERMINAL_POLICY_VERSION,
  assertReplayPortfolioProtectiveStrategyExitCancelTerminalEvidence,
  replayPortfolioProtectiveStrategyExitCancelTerminalEvidenceHash,
  replayPortfolioProtectiveStrategyExitCancelTerminalFingerprintHash,
  replayPortfolioProtectiveStrategyExitCancelTerminalRecordHash,
  type ReplayPortfolioProtectiveStrategyExitCancelStatus,
  type ReplayPortfolioProtectiveStrategyExitCancelTerminalEvidence,
  type ReplayPortfolioProtectiveStrategyExitCancelTerminalFingerprint,
  type ReplayPortfolioProtectiveStrategyExitCancelTerminalOwner,
  type ReplayPortfolioProtectiveStrategyExitCancelTerminalRecord,
} from "../../../contracts/src/lib/replay-portfolio-protective-strategy-exit-cancel-terminal-contracts"
import {
  assertReplayPortfolioProtectiveTerminalArtifactManifest,
  assertReplayPortfolioProtectiveTerminalEvidence,
  type ReplayPortfolioProtectiveTerminalArtifactManifest,
  type ReplayPortfolioProtectiveTerminalEvidence,
  type ReplayPortfolioProtectiveTerminalRecord,
} from "../../../contracts/src/lib/replay-portfolio-protective-terminal-contracts"
import { replayRuntimeSharedWalletRiskResultHash, type ReplayRuntimeSharedWalletRiskResult } from
  "../../../contracts/src/lib/replay-runtime-shared-wallet-risk-contracts"
import { canonicalHash, type ReplayMarketBar, type ReplayOhlcvResolutionEvidence, type ReplayStrategyExitCancelIntent } from
  "../../../contracts/src/lib/replay-contracts"
import { addReplayDecimalValues, quantizeReplayDifferenceProduct } from "../../../contracts/src/lib/replay-decimal"
import {
  aggregateReplayPortfolioProtectiveReplacementTerminal,
} from "./replay-portfolio-protective-replacement-terminal-engine-common"

export interface ReplayPortfolioProtectiveStrategyExitCancelTerminalLane {
  lane_id: string; run_id: string; request_hash: string; bars: ReplayMarketBar[]; bars_hash: string
  cost_policy_id: string; cost_policy_version: string; fee_bps: number; slippage_bps: number
  price_increment: string; settlement_increment: string; settlement_asset: string
  cancel: { decision_sequence: number; decision_time: string; intent: ReplayStrategyExitCancelIntent;
    intent_hash: string; cancelled_strategy_exit_time: string } | null
}
export interface ReplayPortfolioProtectiveStrategyExitCancelTerminalEngineInput {
  source_evidence: ReplayPortfolioProtectiveTerminalEvidence
  source_manifest: ReplayPortfolioProtectiveTerminalArtifactManifest
  risk_result: ReplayRuntimeSharedWalletRiskResult
  lanes: ReplayPortfolioProtectiveStrategyExitCancelTerminalLane[]
}
export function executeReplayPortfolioProtectiveStrategyExitCancelTerminal(
  input: ReplayPortfolioProtectiveStrategyExitCancelTerminalEngineInput,
): ReplayPortfolioProtectiveStrategyExitCancelTerminalEvidence {
  validateInput(input)
  const aggregated = aggregateReplayPortfolioProtectiveReplacementTerminal(
    input.source_evidence.lane_records, input.lanes,
    (source, lane) => buildRecord(input, source, lane as ReplayPortfolioProtectiveStrategyExitCancelTerminalLane),
    input.source_evidence.shared_initial_cash,
  )
  const fingerprintBody: Omit<ReplayPortfolioProtectiveStrategyExitCancelTerminalFingerprint, "fingerprint_hash"> = {
    experiment_id: input.source_evidence.experiment_id, trial_group_id: input.source_evidence.trial_group_id,
    trial_group_hash: input.source_evidence.trial_group_hash, portfolio_id: input.source_evidence.portfolio_id,
    source_protective_terminal_evidence_hash: input.source_evidence.evidence_hash,
    source_protective_terminal_artifact_manifest_hash: input.source_manifest.manifest_hash,
    risk_result_hash: input.risk_result.result_hash, lane_records_hash: aggregated.lane_records_hash,
    ohlcv_resolutions_hash: aggregated.resolutions_hash,
    economic_summary_hash: canonicalHash(aggregated.economicSummary),
    limitations_hash: canonicalHash(REPLAY_PORTFOLIO_PROTECTIVE_STRATEGY_EXIT_CANCEL_TERMINAL_LIMITATIONS),
  }
  const fingerprint = { ...fingerprintBody,
    fingerprint_hash: replayPortfolioProtectiveStrategyExitCancelTerminalFingerprintHash(fingerprintBody) }
  const body: Omit<ReplayPortfolioProtectiveStrategyExitCancelTerminalEvidence, "evidence_hash"> = {
    schema_version: REPLAY_PORTFOLIO_PROTECTIVE_STRATEGY_EXIT_CANCEL_TERMINAL_EVIDENCE_SCHEMA_VERSION,
    policy_version: REPLAY_PORTFOLIO_PROTECTIVE_STRATEGY_EXIT_CANCEL_TERMINAL_POLICY_VERSION,
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
    limitations: REPLAY_PORTFOLIO_PROTECTIVE_STRATEGY_EXIT_CANCEL_TERMINAL_LIMITATIONS, fingerprint,
  }
  const evidence = { ...body, evidence_hash: replayPortfolioProtectiveStrategyExitCancelTerminalEvidenceHash(body) }
  assertReplayPortfolioProtectiveStrategyExitCancelTerminalEvidence(evidence, {
    evidence: input.source_evidence, manifest: input.source_manifest, risk_result_hash: input.risk_result.result_hash,
  })
  return evidence
}

function buildRecord(input: ReplayPortfolioProtectiveStrategyExitCancelTerminalEngineInput,
  source: ReplayPortfolioProtectiveTerminalRecord, lane: ReplayPortfolioProtectiveStrategyExitCancelTerminalLane) {
  if (source.owner === "not_opened") return preserve(source, input.source_evidence, "not_opened", null)
  if (!lane.cancel) return preserve(source, input.source_evidence, "not_configured", null)
  if (source.terminal_time !== null && Date.parse(source.terminal_time) <= Date.parse(lane.cancel.decision_time)) {
    return preserve(source, input.source_evidence, "terminal_before_or_at_decision", lane.cancel)
  }
  if (source.owner === "strategy_exit") {
    throw new Error(`Portfolio strategy-exit cancel Lane ${lane.lane_id} executed the cancelled exit`)
  }
  return preserve(source, input.source_evidence,
    source.owner === "open_at_data_end" ? "cancelled_no_terminal" : "cancelled_then_terminal", lane.cancel)
}

function preserve(source: ReplayPortfolioProtectiveTerminalRecord,
  evidence: ReplayPortfolioProtectiveTerminalEvidence, status: ReplayPortfolioProtectiveStrategyExitCancelStatus,
  cancel: ReplayPortfolioProtectiveStrategyExitCancelTerminalLane["cancel"]) {
  const resolution = source.ohlcv_resolution_evidence_hash === null ? null
    : evidence.ohlcv_resolutions.find((item) => item.evidence_hash === source.ohlcv_resolution_evidence_hash) ?? null
  return complete({ ...withoutRecordHash(source), source_protective_terminal_record_hash: source.record_hash,
    cancel_status: status, cancel_decision_sequence: cancel?.decision_sequence ?? null,
    cancel_decision_time: cancel?.decision_time ?? null, cancel_intent_hash: cancel?.intent_hash ?? null,
    cancelled_strategy_exit_time: cancel ? laneExitTime(cancel) : null,
    active_protection_mode: "bracket" }, resolution)
}

function validateInput(input: ReplayPortfolioProtectiveStrategyExitCancelTerminalEngineInput): void {
  assertReplayPortfolioProtectiveTerminalEvidence(input.source_evidence)
  assertReplayPortfolioProtectiveTerminalArtifactManifest(input.source_manifest)
  if (input.source_manifest.protective_terminal_evidence_hash !== input.source_evidence.evidence_hash
      || input.risk_result.result_hash !== replayRuntimeSharedWalletRiskResultHash(input.risk_result)
      || input.risk_result.result_hash !== input.source_evidence.risk_result_hash
      || input.lanes.length !== input.source_evidence.lane_records.length
      || new Set(input.lanes.map((lane) => lane.lane_id)).size !== input.lanes.length) {
    throw new Error("Portfolio strategy-exit cancel terminal source closure drift")
  }
  const sourceByLane = new Map(input.source_evidence.lane_records.map((record) => [record.lane_id, record]))
  for (const lane of input.lanes) {
    const source = sourceByLane.get(lane.lane_id)
    if (!source || source.request_hash !== lane.request_hash || canonicalHash(lane.bars) !== lane.bars_hash) {
      throw new Error(`Portfolio strategy-exit cancel terminal Lane ${lane.lane_id} binding drift`)
    }
    if (!lane.cancel) continue
    const { intent } = lane.cancel
    if (lane.cancel.intent_hash !== canonicalHash(intent) || lane.cancel.decision_time !== intent.effective_at
        || !Number.isSafeInteger(lane.cancel.decision_sequence) || lane.cancel.decision_sequence < 1
        || !lane.bars.some((bar) => bar.close_time === lane.cancel!.decision_time)
        || intent.target_order_role !== "strategy_exit"
        || intent.cancel_policy !== "cancel_submitted_before_earliest_executable_time"
        || intent.reason_code !== "strategy_exit_condition_revoked"
        || Date.parse(lane.cancel.decision_time) >= Date.parse(lane.cancel.cancelled_strategy_exit_time)) {
      throw new Error(`Portfolio strategy-exit cancel terminal Lane ${lane.lane_id} cancel drift`)
    }
  }
}
function laneExitTime(cancel: NonNullable<ReplayPortfolioProtectiveStrategyExitCancelTerminalLane["cancel"]>): string {
  return cancel.cancelled_strategy_exit_time
}
function complete(body: Omit<ReplayPortfolioProtectiveStrategyExitCancelTerminalRecord, "record_hash">,
  resolution: ReplayOhlcvResolutionEvidence | null) {
  return { record: { ...body, record_hash: replayPortfolioProtectiveStrategyExitCancelTerminalRecordHash(body) }, resolution }
}
function withoutRecordHash(record: ReplayPortfolioProtectiveTerminalRecord) { const { record_hash: _, ...body } = record; return body }
function endingStopRisk(records: ReplayPortfolioProtectiveStrategyExitCancelTerminalRecord[]): number {
  return addReplayDecimalValues(...records.filter((record) => record.ending_open).map((record) => Math.max(0,
    -quantizeReplayDifferenceProduct(record.stop_price, record.entry_price, record.quantity,
      record.side === "long" ? 1 : -1, "0.00000001", "floor"))))
}
function ownerCounts(records: ReplayPortfolioProtectiveStrategyExitCancelTerminalRecord[]) {
  const counts: Record<ReplayPortfolioProtectiveStrategyExitCancelTerminalOwner, number> = {
    not_opened: 0, initial_protective_stop: 0, initial_take_profit: 0,
    exact_liquidation: 0, strategy_exit: 0, open_at_data_end: 0,
  }
  for (const record of records) counts[record.owner] += 1
  return counts
}
