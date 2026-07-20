import {
  REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_EVIDENCE_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_LIMITATIONS,
  REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_POLICY_VERSION,
  assertReplayPortfolioProtectiveTakeProfitReplacementTerminalEvidence,
  replayPortfolioProtectiveTakeProfitReplacementTerminalEvidenceHash,
  replayPortfolioProtectiveTakeProfitReplacementTerminalFingerprintHash,
  replayPortfolioProtectiveTakeProfitReplacementTerminalRecordHash,
  type ReplayPortfolioProtectiveTakeProfitReplacementStatus,
  type ReplayPortfolioProtectiveTakeProfitReplacementTerminalEvidence,
  type ReplayPortfolioProtectiveTakeProfitReplacementTerminalFingerprint,
  type ReplayPortfolioProtectiveTakeProfitReplacementTerminalOwner,
  type ReplayPortfolioProtectiveTakeProfitReplacementTerminalRecord,
} from "../../../contracts/src/lib/replay-portfolio-protective-take-profit-replacement-terminal-contracts"
import {
  assertReplayPortfolioProtectiveTerminalArtifactManifest,
  assertReplayPortfolioProtectiveTerminalEvidence,
  type ReplayPortfolioProtectiveTerminalArtifactManifest,
  type ReplayPortfolioProtectiveTerminalEvidence,
  type ReplayPortfolioProtectiveTerminalRecord,
} from "../../../contracts/src/lib/replay-portfolio-protective-terminal-contracts"
import {
  replayRuntimeSharedWalletRiskResultHash,
  type ReplayRuntimeSharedWalletRiskResult,
} from "../../../contracts/src/lib/replay-runtime-shared-wallet-risk-contracts"
import {
  canonicalHash,
  type ReplayMarketBar,
  type ReplayOhlcvResolutionEvidence,
  type ReplayTakeProfitReplaceIntent,
} from "../../../contracts/src/lib/replay-contracts"
import {
  addReplayDecimalValues,
  quantizeReplayDifferenceProduct,
} from "../../../contracts/src/lib/replay-decimal"
import {
  aggregateReplayPortfolioProtectiveReplacementTerminal,
  chooseReplayPortfolioProtectiveReplacementWinner,
  createReplayPortfolioProtectiveReplacementOhlcvCandidate,
  replayPortfolioProtectiveReplacementFundingBefore,
  replayPortfolioProtectiveReplacementUpstreamCandidate,
  replayPortfolioProtectiveReplacementWinnerFields,
} from "./replay-portfolio-protective-replacement-terminal-engine-common"

export interface ReplayPortfolioProtectiveTakeProfitReplacementTerminalLane {
  lane_id: string
  run_id: string
  request_hash: string
  bars: ReplayMarketBar[]
  bars_hash: string
  cost_policy_id: string
  cost_policy_version: string
  fee_bps: number
  slippage_bps: number
  price_increment: string
  settlement_increment: string
  settlement_asset: string
  replacement: {
    decision_sequence: number
    decision_time: string
    intent: ReplayTakeProfitReplaceIntent
    intent_hash: string
  } | null
}

export interface ReplayPortfolioProtectiveTakeProfitReplacementTerminalEngineInput {
  source_evidence: ReplayPortfolioProtectiveTerminalEvidence
  source_manifest: ReplayPortfolioProtectiveTerminalArtifactManifest
  risk_result: ReplayRuntimeSharedWalletRiskResult
  lanes: ReplayPortfolioProtectiveTakeProfitReplacementTerminalLane[]
}

interface Candidate {
  owner: Exclude<ReplayPortfolioProtectiveTakeProfitReplacementTerminalOwner,
    "not_opened" | "open_at_data_end">
  event_time: string
  phase: 15 | 20
  rank: number
  source_hash: string
  resolution: ReplayOhlcvResolutionEvidence | null
  realized_pnl: number
  exit_fee: number
  liquidation_fee: number
}

export function executeReplayPortfolioProtectiveTakeProfitReplacementTerminal(
  input: ReplayPortfolioProtectiveTakeProfitReplacementTerminalEngineInput,
): ReplayPortfolioProtectiveTakeProfitReplacementTerminalEvidence {
  validateInput(input)
  const aggregated = aggregateReplayPortfolioProtectiveReplacementTerminal(
    input.source_evidence.lane_records,
    input.lanes,
    (source, lane) => buildRecord(
      input, source, lane as ReplayPortfolioProtectiveTakeProfitReplacementTerminalLane,
    ),
    input.source_evidence.shared_initial_cash,
  )
  const { records, resolutions, economicSummary } = aggregated
  const laneRecordsHash = aggregated.lane_records_hash
  const resolutionsHash = aggregated.resolutions_hash
  const fingerprintBody: Omit<ReplayPortfolioProtectiveTakeProfitReplacementTerminalFingerprint, "fingerprint_hash"> = {
    experiment_id: input.source_evidence.experiment_id,
    trial_group_id: input.source_evidence.trial_group_id,
    trial_group_hash: input.source_evidence.trial_group_hash,
    portfolio_id: input.source_evidence.portfolio_id,
    source_protective_terminal_evidence_hash: input.source_evidence.evidence_hash,
    source_protective_terminal_artifact_manifest_hash: input.source_manifest.manifest_hash,
    risk_result_hash: input.risk_result.result_hash,
    lane_records_hash: laneRecordsHash,
    ohlcv_resolutions_hash: resolutionsHash,
    economic_summary_hash: canonicalHash(economicSummary),
    limitations_hash: canonicalHash(REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_LIMITATIONS),
  }
  const fingerprint = {
    ...fingerprintBody,
    fingerprint_hash: replayPortfolioProtectiveTakeProfitReplacementTerminalFingerprintHash(fingerprintBody),
  }
  const body: Omit<ReplayPortfolioProtectiveTakeProfitReplacementTerminalEvidence, "evidence_hash"> = {
    schema_version: REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_EVIDENCE_SCHEMA_VERSION,
    policy_version: REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_POLICY_VERSION,
    experiment_id: input.source_evidence.experiment_id,
    trial_group_id: input.source_evidence.trial_group_id,
    trial_group_hash: input.source_evidence.trial_group_hash,
    portfolio_id: input.source_evidence.portfolio_id,
    settlement_asset: input.source_evidence.settlement_asset,
    shared_initial_cash: input.source_evidence.shared_initial_cash,
    source_protective_terminal_evidence_hash: input.source_evidence.evidence_hash,
    source_protective_terminal_artifact_manifest_hash: input.source_manifest.manifest_hash,
    risk_result_hash: input.risk_result.result_hash,
    lane_records: records,
    lane_records_hash: laneRecordsHash,
    ohlcv_resolutions: resolutions,
    ohlcv_resolutions_hash: resolutionsHash,
    ...economicSummary,
    ending_gross_mark_exposure: input.source_evidence.ending_gross_mark_exposure,
    ending_net_mark_exposure: input.source_evidence.ending_net_mark_exposure,
    ending_portfolio_frozen_stop_risk: endingStopRisk(records),
    terminal_owner_counts: ownerCounts(records),
    limitations: REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_LIMITATIONS,
    fingerprint,
  }
  const evidence = {
    ...body,
    evidence_hash: replayPortfolioProtectiveTakeProfitReplacementTerminalEvidenceHash(body),
  }
  assertReplayPortfolioProtectiveTakeProfitReplacementTerminalEvidence(evidence, {
    evidence: input.source_evidence,
    manifest: input.source_manifest,
    risk_result_hash: input.risk_result.result_hash,
  })
  return evidence
}

function buildRecord(
  input: ReplayPortfolioProtectiveTakeProfitReplacementTerminalEngineInput,
  source: ReplayPortfolioProtectiveTerminalRecord,
  lane: ReplayPortfolioProtectiveTakeProfitReplacementTerminalLane,
): { record: ReplayPortfolioProtectiveTakeProfitReplacementTerminalRecord; resolution: ReplayOhlcvResolutionEvidence | null } {
  if (source.owner === "not_opened") return preserve(source, input.source_evidence, "not_opened", null)
  if (!lane.replacement) return preserve(source, input.source_evidence, "not_configured", null)
  const replacement = lane.replacement
  if (source.terminal_time !== null && Date.parse(source.terminal_time) <= Date.parse(replacement.decision_time)) {
    return preserve(source, input.source_evidence, "terminal_before_or_at_decision", replacement)
  }
  const protection = firstPostReplacementProtection(lane, source)
  const upstream = replayPortfolioProtectiveReplacementUpstreamCandidate(source) as Candidate | null
  const winner = chooseReplayPortfolioProtectiveReplacementWinner(protection, upstream)
  if (!winner) {
    return complete({
      ...withoutRecordHash(source),
      source_protective_terminal_record_hash: source.record_hash,
      replacement_status: "activated_no_terminal",
      replacement_decision_sequence: replacement.decision_sequence,
      replacement_decision_time: replacement.decision_time,
      replacement_intent_hash: replacement.intent_hash,
      previous_target_price: replacement.intent.previous_target_price,
      active_target_price: replacement.intent.new_target_price,
      active_protection_generation: 2,
    }, null)
  }
  const funding = replayPortfolioProtectiveReplacementFundingBefore(input.risk_result, lane.lane_id, winner)
  return complete({
    ...withoutRecordHash(source),
    ...replayPortfolioProtectiveReplacementWinnerFields(source, winner, protection, upstream, funding),
    source_protective_terminal_record_hash: source.record_hash,
    replacement_status: "activated_then_terminal",
    replacement_decision_sequence: replacement.decision_sequence,
    replacement_decision_time: replacement.decision_time,
    replacement_intent_hash: replacement.intent_hash,
    previous_target_price: replacement.intent.previous_target_price,
    active_target_price: replacement.intent.new_target_price,
    active_protection_generation: 2,
  }, winner.resolution)
}

function preserve(
  source: ReplayPortfolioProtectiveTerminalRecord,
  sourceEvidence: ReplayPortfolioProtectiveTerminalEvidence,
  status: ReplayPortfolioProtectiveTakeProfitReplacementStatus,
  replacement: ReplayPortfolioProtectiveTakeProfitReplacementTerminalLane["replacement"],
) {
  const resolution = source.ohlcv_resolution_evidence_hash === null ? null
    : sourceEvidence.ohlcv_resolutions.find((item) => item.evidence_hash === source.ohlcv_resolution_evidence_hash) ?? null
  return complete({
    ...withoutRecordHash(source),
    source_protective_terminal_record_hash: source.record_hash,
    replacement_status: status,
    replacement_decision_sequence: replacement?.decision_sequence ?? null,
    replacement_decision_time: replacement?.decision_time ?? null,
    replacement_intent_hash: replacement?.intent_hash ?? null,
    previous_target_price: replacement?.intent.previous_target_price ?? null,
    active_target_price: source.target_price,
    active_protection_generation: 1,
  }, resolution)
}

function firstPostReplacementProtection(
  lane: ReplayPortfolioProtectiveTakeProfitReplacementTerminalLane,
  source: ReplayPortfolioProtectiveTerminalRecord,
): Candidate | null {
  const replacement = lane.replacement!
  const bars = lane.bars.map((bar, index) => ({ bar, index }))
    .filter(({ bar }) => Date.parse(bar.open_time) >= Date.parse(replacement.decision_time))
    .sort((left, right) => Date.parse(left.bar.open_time) - Date.parse(right.bar.open_time))
  for (const { bar, index } of bars) {
    const stop = source.stop_price
    const target = replacement.intent.new_target_price
    const openStop = source.side === "long" ? bar.open <= stop : bar.open >= stop
    const openTarget = source.side === "long" ? bar.open >= target : bar.open <= target
    if (openStop || openTarget) return protectionCandidate(lane, source, bar, index, "bar_open_gap", openStop, openTarget)
    const stopTouched = source.side === "long" ? bar.low <= stop : bar.high >= stop
    const targetTouched = source.side === "long" ? bar.high >= target : bar.low <= target
    if (stopTouched || targetTouched) {
      return protectionCandidate(lane, source, bar, index, "bar_range_touch", stopTouched, targetTouched)
    }
  }
  return null
}

function protectionCandidate(
  lane: ReplayPortfolioProtectiveTakeProfitReplacementTerminalLane,
  source: ReplayPortfolioProtectiveTerminalRecord,
  bar: ReplayMarketBar,
  index: number,
  observation: "bar_open_gap" | "bar_range_touch",
  stopTouched: boolean,
  targetTouched: boolean,
): Candidate {
  return createReplayPortfolioProtectiveReplacementOhlcvCandidate({
    lane,
    source,
    bar,
    index,
    observation,
    stop_touched: stopTouched,
    target_touched: targetTouched,
    active_protection: {
      protection_generation: 2,
      remaining_quantity: source.quantity,
      stop_order_id: `${lane.run_id}:order:stop`,
      stop_trigger_price: source.stop_price,
      target_order_id: `${lane.run_id}:order:target-replacement:${lane.replacement!.decision_sequence}`,
      target_trigger_price: lane.replacement!.intent.new_target_price,
    },
    stop_owner: "initial_protective_stop",
    target_owner: "replacement_take_profit",
  })
}

function endingStopRisk(records: ReplayPortfolioProtectiveTakeProfitReplacementTerminalRecord[]): number {
  return addReplayDecimalValues(...records.filter((record) => record.ending_open).map((record) =>
    Math.max(0, -quantizeReplayDifferenceProduct(
      record.stop_price,
      record.entry_price,
      record.quantity,
      record.side === "long" ? 1 : -1,
      "0.00000001",
      "floor",
    )),
  ))
}

function complete(
  body: Omit<ReplayPortfolioProtectiveTakeProfitReplacementTerminalRecord, "record_hash">,
  resolution: ReplayOhlcvResolutionEvidence | null,
) {
  return {
    record: { ...body, record_hash: replayPortfolioProtectiveTakeProfitReplacementTerminalRecordHash(body) },
    resolution,
  }
}

function withoutRecordHash(record: ReplayPortfolioProtectiveTerminalRecord) {
  const { record_hash: _hash, ...body } = record
  return body
}

function validateInput(input: ReplayPortfolioProtectiveTakeProfitReplacementTerminalEngineInput): void {
  assertReplayPortfolioProtectiveTerminalEvidence(input.source_evidence)
  assertReplayPortfolioProtectiveTerminalArtifactManifest(input.source_manifest)
  if (input.source_manifest.protective_terminal_evidence_hash !== input.source_evidence.evidence_hash
      || input.risk_result.result_hash !== replayRuntimeSharedWalletRiskResultHash(input.risk_result)
      || input.risk_result.result_hash !== input.source_evidence.risk_result_hash
      || input.lanes.length !== input.source_evidence.lane_records.length
      || new Set(input.lanes.map((lane) => lane.lane_id)).size !== input.lanes.length) {
    throw new Error("Portfolio replacement terminal source closure drift")
  }
  const sourceByLane = new Map(input.source_evidence.lane_records.map((record) => [record.lane_id, record]))
  for (const lane of input.lanes) {
    const source = sourceByLane.get(lane.lane_id)
    if (!source || source.request_hash !== lane.request_hash || canonicalHash(lane.bars) !== lane.bars_hash) {
      throw new Error(`Portfolio replacement terminal Lane ${lane.lane_id} binding drift`)
    }
    const replacement = lane.replacement
    if (!replacement) continue
    const intent = replacement.intent
    const decisionBar = lane.bars.find((bar) => bar.close_time === replacement.decision_time)
    if (replacement.intent_hash !== canonicalHash(intent)
        || replacement.decision_time !== intent.signal_time
        || replacement.decision_sequence < 1 || !Number.isSafeInteger(replacement.decision_sequence)
        || !decisionBar || intent.target_order_id !== `${lane.run_id}:order:target`
        || intent.previous_target_price !== source.target_price
        || intent.quantity_policy !== "full_open_position" || intent.reduce_only !== true
        || intent.order_type !== "take_profit_market"
        || intent.replace_policy !== "cancel_then_submit_not_already_triggered"
        || intent.stop_preservation_policy !== "require_active_full_position_stop"
        || intent.schedule_combination_policy !== "initial_bracket_only_no_other_position_mutation"
        || intent.reason_code !== "take_profit_repriced"
        || intent.new_target_price === source.target_price
        || source.side === "long" && intent.new_target_price <= decisionBar.close
        || source.side === "short" && intent.new_target_price >= decisionBar.close
        || source.side === "long" && !(intent.new_target_price > source.stop_price
          && intent.new_target_price > source.entry_price)
        || source.side === "short" && !(intent.new_target_price < source.stop_price
          && intent.new_target_price < source.entry_price)) {
      throw new Error(`Portfolio replacement terminal Lane ${lane.lane_id} replacement drift`)
    }
  }
}

function ownerCounts(records: ReplayPortfolioProtectiveTakeProfitReplacementTerminalRecord[]) {
  const counts: Record<ReplayPortfolioProtectiveTakeProfitReplacementTerminalOwner, number> = {
    not_opened: 0, initial_protective_stop: 0, replacement_take_profit: 0,
    initial_take_profit: 0, exact_liquidation: 0, strategy_exit: 0, open_at_data_end: 0,
  }
  for (const record of records) counts[record.owner] += 1
  return counts
}
