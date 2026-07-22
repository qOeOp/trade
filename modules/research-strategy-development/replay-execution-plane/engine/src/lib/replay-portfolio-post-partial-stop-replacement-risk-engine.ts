import {
  REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_RISK_EVIDENCE_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_RISK_LIMITATIONS,
  REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_RISK_POLICY_VERSION,
  assertReplayPortfolioPostPartialStopReplacementRiskEvidence,
  calculateReplayPortfolioStopBoundedRisk,
  replayPortfolioPostPartialStopReplacementRiskEvidenceHash,
  replayPortfolioPostPartialStopReplacementRiskRecordHash,
  summarizeReplayPortfolioPostPartialStopReplacementRiskRecords,
  type ReplayPortfolioPostPartialStopReplacementRiskEvidence,
  type ReplayPortfolioPostPartialStopReplacementRiskRecord,
} from "../../../contracts/src/lib/replay-portfolio-post-partial-stop-replacement-risk-contracts"
import {
  assertReplayExecutionRequest,
  assertReplayResultOhlcvResolutionBindings,
  assertReplayResultPositionRiskBindings,
  canonicalHash,
  compareReplayEventKeys,
  type ReplayArtifactManifest,
  type ReplayExecutionRequest,
  type ReplayFill,
  type ReplayResult,
} from "../../../contracts/src/lib/replay-contracts"
import { addReplayDecimalValues, quantizeReplayProduct } from
  "../../../contracts/src/lib/replay-decimal"
import { applyAdverseSlippageV3 } from "../../../accounting/src/lib/replay-accounting"

export interface ReplayPortfolioPostPartialStopReplacementRiskLane {
  lane_id: string
  price_increment: string
  settlement_increment: string
  request: ReplayExecutionRequest
  result: ReplayResult
  artifact_manifest: ReplayArtifactManifest
}

export interface ReplayPortfolioPostPartialStopReplacementRiskEngineInput {
  portfolio_id: string
  settlement_asset: string
  lanes: ReplayPortfolioPostPartialStopReplacementRiskLane[]
}

export function executeReplayPortfolioPostPartialStopReplacementRisk(
  input: ReplayPortfolioPostPartialStopReplacementRiskEngineInput,
): ReplayPortfolioPostPartialStopReplacementRiskEvidence {
  if (!input.portfolio_id || !input.settlement_asset || input.lanes.length === 0
      || new Set(input.lanes.map((lane) => lane.lane_id)).size !== input.lanes.length) {
    throw new Error("Portfolio post-partial stop-replacement Lane authority is empty or duplicated")
  }
  const records = input.lanes.map(materializeRecord).sort((left, right) =>
    left.lane_id.localeCompare(right.lane_id))
  const laneRecordsHash = canonicalHash(records)
  const sourceLaneBindingsHash = canonicalHash(records.map((record) => ({
    lane_id: record.lane_id,
    request_hash: record.request_hash,
    lane_result_hash: record.lane_result_hash,
    lane_artifact_manifest_hash: record.lane_artifact_manifest_hash,
  })))
  const summary = summarizeReplayPortfolioPostPartialStopReplacementRiskRecords(records)
  const fingerprintHash = canonicalHash({
    portfolio_id: input.portfolio_id,
    settlement_asset: input.settlement_asset,
    source_lane_bindings_hash: sourceLaneBindingsHash,
    lane_records_hash: laneRecordsHash,
    limitations: REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_RISK_LIMITATIONS,
  })
  const body: Omit<ReplayPortfolioPostPartialStopReplacementRiskEvidence, "evidence_hash"> = {
    schema_version: REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_RISK_EVIDENCE_SCHEMA_VERSION,
    policy_version: REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_RISK_POLICY_VERSION,
    portfolio_id: input.portfolio_id,
    settlement_asset: input.settlement_asset,
    lane_records: records,
    lane_records_hash: laneRecordsHash,
    source_lane_bindings_hash: sourceLaneBindingsHash,
    ...summary,
    limitations: REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_RISK_LIMITATIONS,
    fingerprint_hash: fingerprintHash,
  }
  const evidence = {
    ...body,
    evidence_hash: replayPortfolioPostPartialStopReplacementRiskEvidenceHash(body),
  }
  assertReplayPortfolioPostPartialStopReplacementRiskEvidence(evidence)
  return evidence
}

function materializeRecord(
  lane: ReplayPortfolioPostPartialStopReplacementRiskLane,
): ReplayPortfolioPostPartialStopReplacementRiskRecord {
  const { request, result, artifact_manifest: manifest } = lane
  assertReplayExecutionRequest(request)
  assertReplayResultPositionRiskBindings(result)
  assertReplayResultOhlcvResolutionBindings(result, request)
  const requestHash = canonicalHash(request)
  if (!lane.lane_id || !lane.price_increment || !lane.settlement_increment
      || result.status !== "completed" || result.run_id !== request.run_id
      || result.fingerprint.request_hash !== requestHash
      || manifest.run_id !== result.run_id
      || manifest.result_hash !== result.fingerprint.result_hash) {
    throw new Error(`Portfolio post-partial stop-replacement Lane ${lane.lane_id} identity drift`)
  }
  const schedulePartials = request.decision_schedule.entries.filter((entry) =>
    entry.expected_effect === "authorized_partial_reduce")
  const replacementEntry = request.decision_schedule.entries.find((entry) =>
    entry.expected_effect === "authorized_protective_stop_replace")
  const replacement = replacementEntry?.authorized_protective_stop_replace
  const partialCount = schedulePartials.length
  if ((partialCount !== 1 && partialCount !== 2) || !replacementEntry || !replacement
      || schedulePartials.some((entry) => !entry.authorized_partial_reduce
        || entry.authorized_partial_reduce.schedule_combination_policy !== (partialCount === 1
          ? "one_partial_reduce_then_one_tighten_only_stop_replace_then_optional_final_full_exit"
          : "up_to_two_partial_reduces_then_one_tighten_only_stop_replace_then_optional_final_full_exit"))
      || replacement.schedule_combination_policy
        !== "after_final_partial_then_optional_full_exit_no_other_position_mutation") {
    throw new Error(`Portfolio post-partial stop-replacement Lane ${lane.lane_id} schedule drift`)
  }
  const replacementEvidence = result.decision_evidence_timeline.entries.find((entry) =>
    entry.decision_sequence === replacementEntry.decision_sequence)
  const replacementOrderId = `${result.run_id}:order:stop-replacement:${replacementEntry.decision_sequence}`
  const replacementActivation = result.order_events.find((event) =>
    event.order_id === replacementOrderId && event.kind === "activated")
  if (!replacementEvidence
      || replacementEvidence.execution_effect !== "authorized_protective_stop_replace"
      || replacementEvidence.evaluation_status !== "evaluated"
      || replacementEvidence.authorized_order_hash !== canonicalHash(replacement)
      || !replacementActivation) {
    throw new Error(`Portfolio post-partial stop-replacement Lane ${lane.lane_id} replacement activation drift`)
  }
  const entry = only(result.fills.filter((fill) => fill.order_role === "entry"), "entry", lane.lane_id)
  const partials = result.fills.filter((fill) => fill.order_role === "strategy_partial_reduce")
  if (partials.length !== partialCount || entry.quantity !== request.order.quantity
      || partials.some((fill, index) => fill.quantity !== schedulePartials[index]!.authorized_partial_reduce!.quantity)
      || compareReplayEventKeys(partials.at(-1)!.event_key, replacementActivation.event_key) >= 0) {
    throw new Error(`Portfolio post-partial stop-replacement Lane ${lane.lane_id} partial lineage drift`)
  }
  const remainingBeforeTerminal = addReplayDecimalValues(
    entry.quantity, ...partials.map((fill) => -fill.quantity),
  )
  if (remainingBeforeTerminal <= 0) {
    throw new Error(`Portfolio post-partial stop-replacement Lane ${lane.lane_id} has no post-partial remainder`)
  }
  const terminalFills = result.fills.filter((fill) =>
    fill.order_role === "stop" || fill.order_role === "target"
      || fill.order_role === "strategy_exit" || fill.order_role === "liquidation")
  if (terminalFills.length > 1) {
    throw new Error(`Portfolio post-partial stop-replacement Lane ${lane.lane_id} terminal cardinality drift`)
  }
  const terminal = terminalFills[0]
  const open = result.equity_bridge.terminal_position_state === "open"
  if (open === Boolean(terminal)
      || terminal && (terminal.quantity !== remainingBeforeTerminal
        || compareReplayEventKeys(replacementActivation.event_key, terminal.event_key) >= 0)
      || terminal?.order_role === "stop" && terminal.order_id !== replacementOrderId
      || !open && result.equity_bridge.terminal_position_state !== "flat") {
    throw new Error(`Portfolio post-partial stop-replacement Lane ${lane.lane_id} terminal quantity drift`)
  }
  const endingQuantity = open ? Math.abs(result.valuation_snapshot.signed_quantity) : 0
  if (open && endingQuantity !== remainingBeforeTerminal
      || open && Math.sign(result.valuation_snapshot.signed_quantity)
        !== (request.order.side === "long" ? 1 : -1)) {
    throw new Error(`Portfolio post-partial stop-replacement Lane ${lane.lane_id} ending Position drift`)
  }
  assertCashConservation(request, result, lane.lane_id)
  const endingSettled = result.trial_balance.settled_cash_balance
  const endingReservedCollateral = result.trial_balance.isolated_margin_collateral_balance
  const endingAvailable = result.trial_balance.wallet_cash_balance
  if (endingSettled !== result.equity_bridge.cash_balance
      || open && endingReservedCollateral <= 0
      || !open && endingReservedCollateral !== 0
      || endingAvailable !== addReplayDecimalValues(endingSettled, -endingReservedCollateral)) {
    throw new Error(`Portfolio post-partial stop-replacement Lane ${lane.lane_id} cash/collateral drift`)
  }
  const admissionExecution = applyAdverseSlippageV3(
    request.order.stop_price,
    request.order.side === "long" ? "sell" : "buy",
    request.cost_policy.slippage_bps,
    lane.price_increment,
  )
  const replacementExecution = applyAdverseSlippageV3(
    replacement.new_stop_price,
    request.order.side === "long" ? "sell" : "buy",
    request.cost_policy.slippage_bps,
    lane.price_increment,
  )
  const admissionRisk = calculateReplayPortfolioStopBoundedRisk({
    side: request.order.side, entry_price: entry.price, stop_execution_price: admissionExecution,
    quantity: entry.quantity, fee_bps: request.cost_policy.fee_bps,
    settlement_increment: lane.settlement_increment,
  })
  const currentRisk = open ? calculateReplayPortfolioStopBoundedRisk({
    side: request.order.side, entry_price: entry.price, stop_execution_price: replacementExecution,
    quantity: endingQuantity, fee_bps: request.cost_policy.fee_bps,
    settlement_increment: lane.settlement_increment,
  }) : 0
  const markExposure = open ? quantizeReplayProduct(
    [result.valuation_snapshot.mark_price, endingQuantity], 1, lane.settlement_increment, "ceil",
  ) : 0
  const cashConservationHash = canonicalHash({
    initial_cash: request.initial_cash,
    economic_ledger_entries: result.ledger.filter((entry) =>
      entry.kind !== "initial_cash" && entry.kind !== "ending_cash").map((entry) => canonicalHash(entry)),
    ending_settled_cash: endingSettled,
    ending_reserved_isolated_collateral: endingReservedCollateral,
    ending_available_cash: endingAvailable,
  })
  const body: Omit<ReplayPortfolioPostPartialStopReplacementRiskRecord, "record_hash"> = {
    lane_id: lane.lane_id, symbol: request.symbol, side: request.order.side,
    request_hash: requestHash, lane_result_hash: result.fingerprint.result_hash,
    lane_artifact_manifest_hash: canonicalHash(manifest), cost_policy_hash: canonicalHash(request.cost_policy),
    initial_cash: request.initial_cash, entry_fill_hash: canonicalHash(entry), entry_price: entry.price,
    initial_quantity: entry.quantity, partial_count: partialCount, partial_fill_hashes: partials.map(canonicalHash),
    ending_quantity: endingQuantity, admission_stop_price: request.order.stop_price,
    admission_stop_execution_price: admissionExecution, replacement_stop_price: replacement.new_stop_price,
    replacement_stop_execution_price: replacementExecution,
    replacement_decision_sequence: replacementEntry.decision_sequence,
    replacement_intent_hash: canonicalHash(replacement), replacement_activation_order_id: replacementOrderId,
    replacement_activation_event_hash: canonicalHash(replacementActivation),
    fee_bps: request.cost_policy.fee_bps, slippage_bps: request.cost_policy.slippage_bps,
    settlement_increment: lane.settlement_increment,
    historical_admission_frozen_stop_risk_amount: admissionRisk,
    ending_reserved_admission_risk_amount: open ? admissionRisk : 0,
    risk_budget_release_amount: open ? 0 : admissionRisk,
    ending_current_active_stop_bounded_risk_amount: currentRisk,
    terminal_state: open ? "open_at_data_end" : "flat", terminal_fill_hash: terminal ? canonicalHash(terminal) : null,
    ending_settled_cash: endingSettled, ending_reserved_isolated_collateral: endingReservedCollateral,
    ending_available_cash: endingAvailable, ending_unrealized_pnl: result.valuation_snapshot.unrealized_pnl,
    ending_portfolio_nav: result.equity_bridge.ending_equity,
    ending_mark_price: open ? result.valuation_snapshot.mark_price : null,
    ending_gross_mark_exposure: markExposure,
    ending_net_mark_exposure: request.order.side === "long" ? markExposure : -markExposure,
    cash_conservation_hash: cashConservationHash,
  }
  return { ...body, record_hash: replayPortfolioPostPartialStopReplacementRiskRecordHash(body) }
}

function assertCashConservation(request: ReplayExecutionRequest, result: ReplayResult, laneId: string): void {
  if (result.ledger[0]?.kind !== "initial_cash" || result.ledger.at(-1)?.kind !== "ending_cash"
      || result.ledger[0].amount !== request.initial_cash) {
    throw new Error(`Portfolio post-partial stop-replacement Lane ${laneId} ledger boundary drift`)
  }
  let balance = 0
  for (const entry of result.ledger) {
    balance = addReplayDecimalValues(balance, entry.amount)
    if (entry.balance_after !== balance) {
      throw new Error(`Portfolio post-partial stop-replacement Lane ${laneId} ledger balance drift`)
    }
  }
  if (balance !== result.trial_balance.settled_cash_balance) {
    throw new Error(`Portfolio post-partial stop-replacement Lane ${laneId} settled cash drift`)
  }
}

function only(fills: ReplayFill[], role: string, laneId: string): ReplayFill {
  if (fills.length !== 1) {
    throw new Error(`Portfolio post-partial stop-replacement Lane ${laneId} ${role} cardinality drift`)
  }
  return fills[0]!
}
