import { canonicalHash, type ReplayOhlcvResolutionEvidence } from "./replay-contracts"
import { addReplayDecimalValues } from "./replay-decimal"
import type {
  ReplayPortfolioProtectiveTerminalArtifactManifest,
  ReplayPortfolioProtectiveTerminalEvidence,
  ReplayPortfolioProtectiveTerminalRecord,
} from "./replay-portfolio-protective-terminal-contracts"
import { assertReplayPortfolioProtectiveReplacementTerminalCommon } from
  "./replay-portfolio-protective-replacement-contract-validation"

export const REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_EVIDENCE_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-protective-stop-cancel-terminal-evidence.v1" as const
export const REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_ARTIFACT_MANIFEST_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-protective-stop-cancel-terminal-artifact-manifest.v1" as const
export const REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_OUTCOME_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-protective-stop-cancel-terminal-outcome.v1" as const
export const REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_POLICY_VERSION =
  "one-predeclared-full-position-protective-stop-cancel-risk-degradation-v1" as const
export const REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_RISK_STATE_POLICY =
  "historical-admission-risk-reserved-until-full-flat-active-stop-bound-nullable-v1" as const

export const REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_LIMITATIONS = [
  "one_simultaneous_initial_allocation_cycle_no_reentry",
  "zero_or_one_predeclared_full_position_protective_stop_cancel_per_lane",
  "cancel_close_bar_market_terminal_precedes_close_time_cancel",
  "initial_full_position_target_preserved_after_stop_cancel",
  "former_stop_unreachable_after_cancel",
  "cancel_has_zero_cashflow_and_zero_risk_budget_release_until_full_flat",
  "open_after_cancel_is_unbounded_by_active_stop_with_exact_mark_liquidation_retained",
  "isolated_margin_no_repeat_mutation_partial_cross_margin_borrow_real_liquidity_or_fast",
] as const

export type ReplayPortfolioProtectiveStopCancelTerminalOwner =
  | "not_opened" | "initial_protective_stop" | "initial_take_profit"
  | "exact_liquidation" | "strategy_exit" | "open_at_data_end"
export type ReplayPortfolioProtectiveStopCancelStatus =
  | "not_configured" | "not_opened" | "terminal_before_or_at_decision"
  | "cancelled_no_terminal" | "cancelled_then_terminal"

export interface ReplayPortfolioProtectiveStopCancelTerminalRecord
  extends Omit<ReplayPortfolioProtectiveTerminalRecord, "record_hash" | "owner"> {
  record_hash: string
  owner: ReplayPortfolioProtectiveStopCancelTerminalOwner
  source_protective_terminal_record_hash: string
  cancel_status: ReplayPortfolioProtectiveStopCancelStatus
  cancel_decision_sequence: number | null
  cancel_decision_time: string | null
  cancel_intent_hash: string | null
  cancelled_stop_price: number | null
  active_protection_mode: "bracket" | "target_only"
  admission_frozen_stop_risk_amount: number
  current_active_stop_risk_amount: number | null
  current_risk_state: "not_opened" | "protected_by_active_stop" | "unbounded_by_active_stop"
    | "released_on_full_flat"
  reserved_admission_risk_amount: number
  risk_budget_release_amount: number
  cancel_cashflow: 0
}

export interface ReplayPortfolioProtectiveStopCancelTerminalFingerprint {
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  portfolio_id: string
  source_protective_terminal_evidence_hash: string
  source_protective_terminal_artifact_manifest_hash: string
  risk_result_hash: string
  lane_records_hash: string
  ohlcv_resolutions_hash: string
  economic_summary_hash: string
  risk_state_hash: string
  limitations_hash: string
  fingerprint_hash: string
}

export interface ReplayPortfolioProtectiveStopCancelTerminalEvidence {
  schema_version: typeof REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_EVIDENCE_SCHEMA_VERSION
  policy_version: typeof REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_POLICY_VERSION
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  portfolio_id: string
  settlement_asset: string
  shared_initial_cash: number
  source_protective_terminal_evidence_hash: string
  source_protective_terminal_artifact_manifest_hash: string
  risk_result_hash: string
  lane_records: ReplayPortfolioProtectiveStopCancelTerminalRecord[]
  lane_records_hash: string
  ohlcv_resolutions: ReplayOhlcvResolutionEvidence[]
  ohlcv_resolutions_hash: string
  ending_settled_cash: number
  ending_reserved_isolated_collateral: number
  ending_available_cash: number
  ending_unrealized_pnl: number
  ending_portfolio_nav: number
  ending_gross_mark_exposure: number
  ending_net_mark_exposure: number
  risk_state_policy: typeof REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_RISK_STATE_POLICY
  historical_admission_frozen_stop_risk: number
  ending_portfolio_frozen_stop_risk: number
  ending_portfolio_active_stop_bounded_risk: number | null
  total_risk_budget_released: number
  unbounded_by_active_stop_lane_ids: string[]
  cancel_cashflow_total: 0
  terminal_owner_counts: Record<ReplayPortfolioProtectiveStopCancelTerminalOwner, number>
  limitations: typeof REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_LIMITATIONS
  fingerprint: ReplayPortfolioProtectiveStopCancelTerminalFingerprint
  evidence_hash: string
}

export const REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_ARTIFACT_ROLES = [
  "source_protective_terminal_artifact_manifest", "source_protective_terminal_evidence",
  "cancel_terminal_records", "ohlcv_resolutions", "cancel_terminal_fingerprint", "cancel_terminal_evidence",
] as const
export type ReplayPortfolioProtectiveStopCancelTerminalArtifactRole =
  typeof REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_ARTIFACT_ROLES[number]

export interface ReplayPortfolioProtectiveStopCancelTerminalArtifactManifest {
  schema_version: typeof REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_ARTIFACT_MANIFEST_SCHEMA_VERSION
  artifact_id: string
  portfolio_id: string
  cancel_terminal_evidence_hash: string
  cancel_terminal_fingerprint_hash: string
  source_protective_terminal_evidence_hash: string
  source_protective_terminal_artifact_manifest_hash: string
  files: Array<{ role: ReplayPortfolioProtectiveStopCancelTerminalArtifactRole; name: string; ref: string; sha256: string }>
  completeness: {
    authoritative_result: true
    required_roles: typeof REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_ARTIFACT_ROLES
    commit_marker: "portfolio-protective-stop-cancel-terminal-artifact-manifest.json"
    partial_payload_without_manifest_is_authoritative: false
  }
  authority_frozen_at: string
  manifest_hash: string
}

export interface ReplayPortfolioProtectiveStopCancelTerminalOutcome {
  schema_version: typeof REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_OUTCOME_SCHEMA_VERSION
  portfolio_id: string
  status: "completed" | "failed"
  source_protective_terminal_evidence: ReplayPortfolioProtectiveTerminalEvidence | null
  evidence: ReplayPortfolioProtectiveStopCancelTerminalEvidence | null
  artifact_manifest: ReplayPortfolioProtectiveStopCancelTerminalArtifactManifest | null
  idempotent_replay: boolean
  failure: {
    code: "protective-terminal-failed" | "cancel-terminal-input-invalid"
      | "cancel-terminal-engine-failed" | "cancel-terminal-artifact-failed"
    message: string
    partial_result_published: false
  } | null
  outcome_hash: string
}

export function replayPortfolioProtectiveStopCancelTerminalRecordHash(
  value: ReplayPortfolioProtectiveStopCancelTerminalRecord
    | Omit<ReplayPortfolioProtectiveStopCancelTerminalRecord, "record_hash">,
): string { const { record_hash: _, ...body } = value as ReplayPortfolioProtectiveStopCancelTerminalRecord; return canonicalHash(body) }
export function replayPortfolioProtectiveStopCancelTerminalFingerprintHash(
  value: ReplayPortfolioProtectiveStopCancelTerminalFingerprint
    | Omit<ReplayPortfolioProtectiveStopCancelTerminalFingerprint, "fingerprint_hash">,
): string { const { fingerprint_hash: _, ...body } = value as ReplayPortfolioProtectiveStopCancelTerminalFingerprint; return canonicalHash(body) }
export function replayPortfolioProtectiveStopCancelTerminalEvidenceHash(
  value: ReplayPortfolioProtectiveStopCancelTerminalEvidence
    | Omit<ReplayPortfolioProtectiveStopCancelTerminalEvidence, "evidence_hash">,
): string { const { evidence_hash: _, ...body } = value as ReplayPortfolioProtectiveStopCancelTerminalEvidence; return canonicalHash(body) }
export function replayPortfolioProtectiveStopCancelTerminalArtifactManifestHash(
  value: ReplayPortfolioProtectiveStopCancelTerminalArtifactManifest
    | Omit<ReplayPortfolioProtectiveStopCancelTerminalArtifactManifest, "manifest_hash">,
): string { const { manifest_hash: _, ...body } = value as ReplayPortfolioProtectiveStopCancelTerminalArtifactManifest; return canonicalHash(body) }
export function replayPortfolioProtectiveStopCancelTerminalOutcomeHash(
  value: ReplayPortfolioProtectiveStopCancelTerminalOutcome
    | Omit<ReplayPortfolioProtectiveStopCancelTerminalOutcome, "outcome_hash">,
): string { const { outcome_hash: _, ...body } = value as ReplayPortfolioProtectiveStopCancelTerminalOutcome; return canonicalHash(body) }

export function assertReplayPortfolioProtectiveStopCancelTerminalEvidence(
  value: ReplayPortfolioProtectiveStopCancelTerminalEvidence,
  source?: { evidence: ReplayPortfolioProtectiveTerminalEvidence; manifest: ReplayPortfolioProtectiveTerminalArtifactManifest; risk_result_hash: string },
): void {
  if (value.schema_version !== REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_EVIDENCE_SCHEMA_VERSION
      || value.policy_version !== REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_POLICY_VERSION
      || value.risk_state_policy !== REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_RISK_STATE_POLICY
      || !value.experiment_id || !value.trial_group_id || !value.portfolio_id || !value.settlement_asset
      || JSON.stringify(value.limitations) !== JSON.stringify(REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_LIMITATIONS)) fail("identity/policy")
  const laneIds = value.lane_records.map((record) => record.lane_id)
  if (new Set(laneIds).size !== laneIds.length || JSON.stringify(laneIds) !== JSON.stringify([...laneIds].sort())
      || value.lane_records_hash !== canonicalHash(value.lane_records)
      || value.ohlcv_resolutions_hash !== canonicalHash(value.ohlcv_resolutions)) fail("record collection")
  const resolutions = new Map(value.ohlcv_resolutions.map((item) => [item.evidence_hash, item]))
  for (const record of value.lane_records) {
    const configured = !["not_configured", "not_opened"].includes(record.cancel_status)
    const cancelled = record.cancel_status === "cancelled_no_terminal" || record.cancel_status === "cancelled_then_terminal"
    const resolution = record.ohlcv_resolution_evidence_hash ? resolutions.get(record.ohlcv_resolution_evidence_hash) : null
    if (record.record_hash !== replayPortfolioProtectiveStopCancelTerminalRecordHash(record)
        || configured !== (record.cancel_intent_hash !== null && record.cancel_decision_sequence !== null
          && record.cancel_decision_time !== null && record.cancelled_stop_price !== null)
        || cancelled !== (record.active_protection_mode === "target_only")
        || cancelled && record.cancelled_stop_price !== record.stop_price
        || cancelled && record.owner === "initial_protective_stop"
        || record.owner === "not_opened" !== (record.cancel_status === "not_opened")
        || record.ending_open !== (record.owner === "open_at_data_end")
        || record.ohlcv_resolution_evidence_hash !== null && !resolution
        || resolution && (resolution.active_protection.protection_mode !== (cancelled ? "target_only" : "bracket")
          || resolution.active_protection.stop_order_status !== (cancelled ? "cancelled" : "active")
          || resolution.active_protection.target_order_status !== "active"
          || resolution.evidence_hash !== record.terminal_source_hash
          || resolution.source_event_key.event_time !== record.terminal_time
          || resolution.status !== record.resolution_status)) fail("record semantics")
    assertRiskRecord(record, cancelled)
  }
  const riskState = aggregateRiskState(value.lane_records)
  if (value.historical_admission_frozen_stop_risk !== riskState.historical_admission_frozen_stop_risk
      || value.ending_portfolio_frozen_stop_risk !== riskState.ending_portfolio_frozen_stop_risk
      || value.ending_portfolio_active_stop_bounded_risk
        !== riskState.ending_portfolio_active_stop_bounded_risk
      || value.total_risk_budget_released !== riskState.total_risk_budget_released
      || canonicalHash(value.unbounded_by_active_stop_lane_ids)
        !== canonicalHash(riskState.unbounded_by_active_stop_lane_ids)
      || value.cancel_cashflow_total !== 0
      || value.historical_admission_frozen_stop_risk !== addReplayDecimalValues(
        value.ending_portfolio_frozen_stop_risk, value.total_risk_budget_released,
      )
      || value.fingerprint.risk_state_hash !== canonicalHash(riskState)
      || value.ending_gross_mark_exposure < Math.abs(value.ending_net_mark_exposure)) fail("risk state")
  const economics = economicSummary(value)
  assertReplayPortfolioProtectiveReplacementTerminalCommon({
    value, owner_counts: ownerCounts(value.lane_records), economics,
    fingerprint_hash: replayPortfolioProtectiveStopCancelTerminalFingerprintHash(value.fingerprint),
    evidence_hash: replayPortfolioProtectiveStopCancelTerminalEvidenceHash(value), source, fail,
  })
}

export function assertReplayPortfolioProtectiveStopCancelTerminalArtifactManifest(
  value: ReplayPortfolioProtectiveStopCancelTerminalArtifactManifest,
): void {
  if (value.schema_version !== REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_ARTIFACT_MANIFEST_SCHEMA_VERSION
      || !value.artifact_id || !value.portfolio_id
      || JSON.stringify(value.files.map((file) => file.role)) !== JSON.stringify(REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_ARTIFACT_ROLES)
      || JSON.stringify(value.completeness.required_roles) !== JSON.stringify(REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_ARTIFACT_ROLES)
      || value.completeness.authoritative_result !== true
      || value.completeness.commit_marker !== "portfolio-protective-stop-cancel-terminal-artifact-manifest.json"
      || value.completeness.partial_payload_without_manifest_is_authoritative !== false
      || value.manifest_hash !== replayPortfolioProtectiveStopCancelTerminalArtifactManifestHash(value)) fail("artifact manifest")
}

export function assertReplayPortfolioProtectiveStopCancelTerminalOutcome(
  value: ReplayPortfolioProtectiveStopCancelTerminalOutcome,
): void {
  if (value.schema_version !== REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_OUTCOME_SCHEMA_VERSION
      || !value.portfolio_id
      || value.status === "completed" !== Boolean(value.source_protective_terminal_evidence && value.evidence && value.artifact_manifest && !value.failure)
      || value.status === "failed" !== Boolean(!value.source_protective_terminal_evidence && !value.evidence && !value.artifact_manifest && value.failure)
      || value.failure?.partial_result_published !== false && value.failure !== null
      || value.outcome_hash !== replayPortfolioProtectiveStopCancelTerminalOutcomeHash(value)) fail("outcome")
  if (value.evidence) assertReplayPortfolioProtectiveStopCancelTerminalEvidence(value.evidence)
  if (value.artifact_manifest) assertReplayPortfolioProtectiveStopCancelTerminalArtifactManifest(value.artifact_manifest)
}

function economicSummary(value: ReplayPortfolioProtectiveStopCancelTerminalEvidence) {
  let settled = value.shared_initial_cash; let reserved = 0; let unrealized = 0
  for (const record of value.lane_records) {
    if (record.owner === "not_opened") continue
    settled = addReplayDecimalValues(settled, -record.entry_fee, record.funding_cashflow_before_terminal,
      record.realized_pnl, -record.exit_trading_fee, -record.liquidation_fee)
    if (record.ending_open) { reserved = addReplayDecimalValues(reserved, record.isolated_collateral); unrealized = addReplayDecimalValues(unrealized, record.ending_unrealized_pnl) }
  }
  return { ending_settled_cash: settled, ending_reserved_isolated_collateral: reserved,
    ending_available_cash: addReplayDecimalValues(settled, -reserved), ending_unrealized_pnl: unrealized,
    ending_portfolio_nav: addReplayDecimalValues(settled, unrealized) }
}
function ownerCounts(records: ReplayPortfolioProtectiveStopCancelTerminalRecord[]) {
  const counts: Record<ReplayPortfolioProtectiveStopCancelTerminalOwner, number> = {
    not_opened: 0, initial_protective_stop: 0, initial_take_profit: 0,
    exact_liquidation: 0, strategy_exit: 0, open_at_data_end: 0,
  }
  for (const record of records) counts[record.owner] += 1
  return counts
}
function assertRiskRecord(record: ReplayPortfolioProtectiveStopCancelTerminalRecord, cancelled: boolean): void {
  const nonnegative = [record.admission_frozen_stop_risk_amount, record.reserved_admission_risk_amount,
    record.risk_budget_release_amount].every((value) => Number.isFinite(value) && value >= 0)
  if (!nonnegative || record.cancel_cashflow !== 0
      || record.admission_frozen_stop_risk_amount !== addReplayDecimalValues(
        record.reserved_admission_risk_amount, record.risk_budget_release_amount,
      )) fail("record risk conservation")
  if (record.owner === "not_opened") {
    if (record.current_risk_state !== "not_opened" || record.current_active_stop_risk_amount !== 0
        || record.admission_frozen_stop_risk_amount !== 0) fail("not-opened risk")
  } else if (!record.ending_open) {
    if (record.current_risk_state !== "released_on_full_flat" || record.current_active_stop_risk_amount !== 0
        || record.reserved_admission_risk_amount !== 0
        || record.risk_budget_release_amount !== record.admission_frozen_stop_risk_amount) fail("flat risk release")
  } else if (cancelled) {
    if (record.current_risk_state !== "unbounded_by_active_stop"
        || record.current_active_stop_risk_amount !== null
        || record.reserved_admission_risk_amount !== record.admission_frozen_stop_risk_amount
        || record.risk_budget_release_amount !== 0) fail("cancelled-open risk degradation")
  } else if (record.current_risk_state !== "protected_by_active_stop"
      || record.current_active_stop_risk_amount !== record.admission_frozen_stop_risk_amount
      || record.reserved_admission_risk_amount !== record.admission_frozen_stop_risk_amount
      || record.risk_budget_release_amount !== 0) fail("protected-open risk")
}
function aggregateRiskState(records: ReplayPortfolioProtectiveStopCancelTerminalRecord[]) {
  const unbounded = records.filter((record) => record.current_risk_state === "unbounded_by_active_stop")
    .map((record) => record.lane_id).sort()
  return {
    historical_admission_frozen_stop_risk: addReplayDecimalValues(
      ...records.map((record) => record.admission_frozen_stop_risk_amount),
    ),
    ending_portfolio_frozen_stop_risk: addReplayDecimalValues(
      ...records.map((record) => record.reserved_admission_risk_amount),
    ),
    ending_portfolio_active_stop_bounded_risk: unbounded.length > 0 ? null : addReplayDecimalValues(
      ...records.map((record) => record.current_active_stop_risk_amount ?? 0),
    ),
    total_risk_budget_released: addReplayDecimalValues(
      ...records.map((record) => record.risk_budget_release_amount),
    ),
    unbounded_by_active_stop_lane_ids: unbounded,
    cancel_cashflow_total: 0 as const,
  }
}
function fail(scope: string): never { throw new Error(`Portfolio Protective Stop Cancel Terminal ${scope} invalid`) }
