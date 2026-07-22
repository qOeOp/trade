import { canonicalHash } from "./replay-contracts"
import {
  addReplayDecimalValues,
  quantizeReplayDifferenceProduct,
  quantizeReplayProduct,
} from "./replay-decimal"

export const REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_RISK_EVIDENCE_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-post-partial-stop-replacement-risk-evidence.v1" as const
export const REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_RISK_POLICY_VERSION =
  "certified-result-post-partial-current-stop-risk-v1" as const

export const REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_RISK_LIMITATIONS = [
  "one_or_two_predeclared_fixed_quantity_partial_reduces_then_one_tighten_only_stop_replacement",
  "certified_lane_result_is_the_only_fill_position_ledger_and_terminal_authority",
  "historical_admission_risk_is_never_rewritten_by_partial_or_stop_replacement",
  "current_active_stop_risk_uses_ending_open_quantity_and_replacement_stop",
  "isolated_lane_cash_is_preallocated_no_cross_lane_intracycle_contention",
  "isolated_collateral_account_absorbs_attributed_cashflows_and_is_released_only_at_full_flat",
  "no_second_ohlcv_terminal_matcher_dynamic_sizing_reentry_cross_margin_borrow_real_liquidity_or_fast",
] as const

export type ReplayPortfolioPostPartialStopReplacementTerminalState = "flat" | "open_at_data_end"

export interface ReplayPortfolioPostPartialStopReplacementRiskRecord {
  lane_id: string
  symbol: string
  side: "long" | "short"
  request_hash: string
  lane_result_hash: string
  lane_artifact_manifest_hash: string
  cost_policy_hash: string
  initial_cash: number
  entry_fill_hash: string
  entry_price: number
  initial_quantity: number
  partial_count: 1 | 2
  partial_fill_hashes: string[]
  ending_quantity: number
  admission_stop_price: number
  admission_stop_execution_price: number
  replacement_stop_price: number
  replacement_stop_execution_price: number
  replacement_decision_sequence: number
  replacement_intent_hash: string
  replacement_activation_order_id: string
  replacement_activation_event_hash: string
  fee_bps: number
  slippage_bps: number
  settlement_increment: string
  historical_admission_frozen_stop_risk_amount: number
  ending_reserved_admission_risk_amount: number
  risk_budget_release_amount: number
  ending_current_active_stop_bounded_risk_amount: number
  terminal_state: ReplayPortfolioPostPartialStopReplacementTerminalState
  terminal_fill_hash: string | null
  ending_settled_cash: number
  ending_reserved_isolated_collateral: number
  ending_available_cash: number
  ending_unrealized_pnl: number
  ending_portfolio_nav: number
  ending_mark_price: number | null
  ending_gross_mark_exposure: number
  ending_net_mark_exposure: number
  cash_conservation_hash: string
  record_hash: string
}

export interface ReplayPortfolioPostPartialStopReplacementRiskEvidence {
  schema_version: typeof REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_RISK_EVIDENCE_SCHEMA_VERSION
  policy_version: typeof REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_RISK_POLICY_VERSION
  portfolio_id: string
  settlement_asset: string
  lane_records: ReplayPortfolioPostPartialStopReplacementRiskRecord[]
  lane_records_hash: string
  source_lane_bindings_hash: string
  initial_cash: number
  ending_settled_cash: number
  ending_reserved_isolated_collateral: number
  ending_available_cash: number
  ending_unrealized_pnl: number
  ending_portfolio_nav: number
  ending_gross_mark_exposure: number
  ending_net_mark_exposure: number
  historical_admission_frozen_stop_risk: number
  ending_reserved_admission_risk: number
  total_risk_budget_released: number
  ending_current_active_stop_bounded_risk: number
  open_lane_count: number
  flat_lane_count: number
  limitations: typeof REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_RISK_LIMITATIONS
  fingerprint_hash: string
  evidence_hash: string
}

export function replayPortfolioPostPartialStopReplacementRiskRecordHash(
  value: ReplayPortfolioPostPartialStopReplacementRiskRecord
    | Omit<ReplayPortfolioPostPartialStopReplacementRiskRecord, "record_hash">,
): string { return strip(value, "record_hash") }

export function replayPortfolioPostPartialStopReplacementRiskEvidenceHash(
  value: ReplayPortfolioPostPartialStopReplacementRiskEvidence
    | Omit<ReplayPortfolioPostPartialStopReplacementRiskEvidence, "evidence_hash">,
): string { return strip(value, "evidence_hash") }

export function calculateReplayPortfolioStopBoundedRisk(input: {
  side: "long" | "short"
  entry_price: number
  stop_execution_price: number
  quantity: number
  fee_bps: number
  settlement_increment: string
}): number {
  const priceLoss = quantizeReplayDifferenceProduct(
    input.entry_price,
    input.stop_execution_price,
    input.quantity,
    input.side === "long" ? 1 : -1,
    input.settlement_increment,
    "ceil",
  )
  const exitFee = quantizeReplayProduct(
    [input.stop_execution_price, input.quantity, input.fee_bps],
    1 / 10_000,
    input.settlement_increment,
    "ceil",
  )
  return Math.max(0, addReplayDecimalValues(priceLoss, exitFee))
}

export function summarizeReplayPortfolioPostPartialStopReplacementRiskRecords(
  records: ReplayPortfolioPostPartialStopReplacementRiskRecord[],
) {
  const settled = sum(records, "ending_settled_cash")
  const reservedCollateral = sum(records, "ending_reserved_isolated_collateral")
  const unrealized = sum(records, "ending_unrealized_pnl")
  return {
    initial_cash: sum(records, "initial_cash"),
    ending_settled_cash: settled,
    ending_reserved_isolated_collateral: reservedCollateral,
    ending_available_cash: addReplayDecimalValues(settled, -reservedCollateral),
    ending_unrealized_pnl: unrealized,
    ending_portfolio_nav: addReplayDecimalValues(settled, unrealized),
    ending_gross_mark_exposure: sum(records, "ending_gross_mark_exposure"),
    ending_net_mark_exposure: sum(records, "ending_net_mark_exposure"),
    historical_admission_frozen_stop_risk: sum(records, "historical_admission_frozen_stop_risk_amount"),
    ending_reserved_admission_risk: sum(records, "ending_reserved_admission_risk_amount"),
    total_risk_budget_released: sum(records, "risk_budget_release_amount"),
    ending_current_active_stop_bounded_risk: sum(records, "ending_current_active_stop_bounded_risk_amount"),
    open_lane_count: records.filter((record) => record.terminal_state === "open_at_data_end").length,
    flat_lane_count: records.filter((record) => record.terminal_state === "flat").length,
  }
}

export function assertReplayPortfolioPostPartialStopReplacementRiskEvidence(
  value: ReplayPortfolioPostPartialStopReplacementRiskEvidence,
): void {
  if (value.schema_version !== REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_RISK_EVIDENCE_SCHEMA_VERSION
      || value.policy_version !== REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_RISK_POLICY_VERSION
      || !value.portfolio_id || !value.settlement_asset || value.lane_records.length === 0
      || JSON.stringify(value.limitations)
        !== JSON.stringify(REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_RISK_LIMITATIONS)) fail("header")
  const laneIds = value.lane_records.map((record) => record.lane_id)
  if (new Set(laneIds).size !== laneIds.length
      || JSON.stringify(laneIds) !== JSON.stringify([...laneIds].sort())
      || value.lane_records_hash !== canonicalHash(value.lane_records)
      || value.source_lane_bindings_hash !== sourceBindingsHash(value.lane_records)) fail("lane collection")
  for (const record of value.lane_records) assertRecord(record)
  const summary = summarizeReplayPortfolioPostPartialStopReplacementRiskRecords(value.lane_records)
  if (Object.entries(summary).some(([key, item]) => value[key as keyof typeof value] !== item)
      || value.historical_admission_frozen_stop_risk !== addReplayDecimalValues(
        value.ending_reserved_admission_risk, value.total_risk_budget_released,
      )
      || value.fingerprint_hash !== canonicalHash({
        portfolio_id: value.portfolio_id,
        settlement_asset: value.settlement_asset,
        source_lane_bindings_hash: value.source_lane_bindings_hash,
        lane_records_hash: value.lane_records_hash,
        limitations: value.limitations,
      })
      || value.evidence_hash !== replayPortfolioPostPartialStopReplacementRiskEvidenceHash(value)) fail("aggregate")
}

function assertRecord(record: ReplayPortfolioPostPartialStopReplacementRiskRecord): void {
  const open = record.terminal_state === "open_at_data_end"
  const admissionRisk = calculateReplayPortfolioStopBoundedRisk({
    side: record.side, entry_price: record.entry_price,
    stop_execution_price: record.admission_stop_execution_price,
    quantity: record.initial_quantity, fee_bps: record.fee_bps,
    settlement_increment: record.settlement_increment,
  })
  const currentRisk = open ? calculateReplayPortfolioStopBoundedRisk({
    side: record.side, entry_price: record.entry_price,
    stop_execution_price: record.replacement_stop_execution_price,
    quantity: record.ending_quantity, fee_bps: record.fee_bps,
    settlement_increment: record.settlement_increment,
  }) : 0
  if (record.partial_fill_hashes.length !== record.partial_count
      || record.initial_quantity <= 0 || record.ending_quantity < 0
      || record.replacement_decision_sequence < 3
      || record.side === "long" && !(record.admission_stop_price < record.replacement_stop_price)
      || record.side === "short" && !(record.admission_stop_price > record.replacement_stop_price)
      || record.historical_admission_frozen_stop_risk_amount !== admissionRisk
      || record.ending_current_active_stop_bounded_risk_amount !== currentRisk
      || record.ending_reserved_admission_risk_amount !== (open ? admissionRisk : 0)
      || record.risk_budget_release_amount !== (open ? 0 : admissionRisk)
      || record.ending_reserved_isolated_collateral !== addReplayDecimalValues(
        record.ending_settled_cash, -record.ending_available_cash,
      )
      || open && record.ending_reserved_isolated_collateral <= 0
      || !open && record.ending_reserved_isolated_collateral !== 0
      || record.ending_portfolio_nav !== addReplayDecimalValues(
        record.ending_settled_cash, record.ending_unrealized_pnl,
      )
      || open !== (record.ending_quantity > 0)
      || open !== (record.ending_mark_price !== null)
      || open === (record.terminal_fill_hash !== null)
      || !open && (record.ending_gross_mark_exposure !== 0 || record.ending_net_mark_exposure !== 0
        || record.ending_unrealized_pnl !== 0)
      || open && record.ending_net_mark_exposure !== (record.side === "long"
        ? record.ending_gross_mark_exposure : -record.ending_gross_mark_exposure)
      || record.record_hash !== replayPortfolioPostPartialStopReplacementRiskRecordHash(record)) fail("record")
}

function sourceBindingsHash(records: ReplayPortfolioPostPartialStopReplacementRiskRecord[]): string {
  return canonicalHash(records.map((record) => ({
    lane_id: record.lane_id,
    request_hash: record.request_hash,
    lane_result_hash: record.lane_result_hash,
    lane_artifact_manifest_hash: record.lane_artifact_manifest_hash,
  })))
}

function sum<K extends keyof ReplayPortfolioPostPartialStopReplacementRiskRecord>(
  records: ReplayPortfolioPostPartialStopReplacementRiskRecord[], key: K,
): number { return addReplayDecimalValues(...records.map((record) => record[key] as number)) }
function strip(value: unknown, key: string): string {
  const body = { ...(value as Record<string, unknown>) }; delete body[key]; return canonicalHash(body)
}
function fail(area: string): never {
  throw new Error(`Portfolio post-partial stop-replacement risk ${area} drift`)
}
