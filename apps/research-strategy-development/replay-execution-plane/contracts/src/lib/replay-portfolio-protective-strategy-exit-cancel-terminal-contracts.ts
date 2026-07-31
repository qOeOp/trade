import { canonicalHash, type ReplayOhlcvResolutionEvidence } from "./replay-contracts"
import { addReplayDecimalValues } from "./replay-decimal"
import type {
  ReplayPortfolioProtectiveTerminalArtifactManifest,
  ReplayPortfolioProtectiveTerminalEvidence,
  ReplayPortfolioProtectiveTerminalRecord,
} from "./replay-portfolio-protective-terminal-contracts"
import { assertReplayPortfolioProtectiveReplacementTerminalCommon } from
  "./replay-portfolio-protective-replacement-contract-validation"

export const REPLAY_PORTFOLIO_PROTECTIVE_STRATEGY_EXIT_CANCEL_TERMINAL_EVIDENCE_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-protective-strategy-exit-cancel-terminal-evidence.v1" as const
export const REPLAY_PORTFOLIO_PROTECTIVE_STRATEGY_EXIT_CANCEL_TERMINAL_ARTIFACT_MANIFEST_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-protective-strategy-exit-cancel-terminal-artifact-manifest.v1" as const
export const REPLAY_PORTFOLIO_PROTECTIVE_STRATEGY_EXIT_CANCEL_TERMINAL_OUTCOME_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-protective-strategy-exit-cancel-terminal-outcome.v1" as const
export const REPLAY_PORTFOLIO_PROTECTIVE_STRATEGY_EXIT_CANCEL_TERMINAL_POLICY_VERSION =
  "one-predeclared-pending-strategy-exit-cancel-bracket-preserved-v1" as const

export const REPLAY_PORTFOLIO_PROTECTIVE_STRATEGY_EXIT_CANCEL_TERMINAL_LIMITATIONS = [
  "one_simultaneous_initial_allocation_cycle_no_reentry",
  "zero_or_one_predeclared_pending_full_position_strategy_exit_cancel_per_lane",
  "cancel_close_bar_market_terminal_precedes_close_time_cancel",
  "initial_full_position_stop_and_target_preserved_after_strategy_exit_cancel",
  "former_strategy_exit_unreachable_after_cancel",
  "isolated_margin_no_protective_cancel_repeat_mutation_partial_cross_margin_borrow_real_liquidity_or_fast",
] as const

export type ReplayPortfolioProtectiveStrategyExitCancelTerminalOwner =
  | "not_opened" | "initial_protective_stop" | "initial_take_profit"
  | "exact_liquidation" | "strategy_exit" | "open_at_data_end"
export type ReplayPortfolioProtectiveStrategyExitCancelStatus =
  | "not_configured" | "not_opened" | "terminal_before_or_at_decision"
  | "cancelled_no_terminal" | "cancelled_then_terminal"

export interface ReplayPortfolioProtectiveStrategyExitCancelTerminalRecord
  extends Omit<ReplayPortfolioProtectiveTerminalRecord, "record_hash" | "owner"> {
  record_hash: string
  owner: ReplayPortfolioProtectiveStrategyExitCancelTerminalOwner
  source_protective_terminal_record_hash: string
  cancel_status: ReplayPortfolioProtectiveStrategyExitCancelStatus
  cancel_decision_sequence: number | null
  cancel_decision_time: string | null
  cancel_intent_hash: string | null
  cancelled_strategy_exit_time: string | null
  active_protection_mode: "bracket"
}

export interface ReplayPortfolioProtectiveStrategyExitCancelTerminalFingerprint {
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
  limitations_hash: string
  fingerprint_hash: string
}

export interface ReplayPortfolioProtectiveStrategyExitCancelTerminalEvidence {
  schema_version: typeof REPLAY_PORTFOLIO_PROTECTIVE_STRATEGY_EXIT_CANCEL_TERMINAL_EVIDENCE_SCHEMA_VERSION
  policy_version: typeof REPLAY_PORTFOLIO_PROTECTIVE_STRATEGY_EXIT_CANCEL_TERMINAL_POLICY_VERSION
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  portfolio_id: string
  settlement_asset: string
  shared_initial_cash: number
  source_protective_terminal_evidence_hash: string
  source_protective_terminal_artifact_manifest_hash: string
  risk_result_hash: string
  lane_records: ReplayPortfolioProtectiveStrategyExitCancelTerminalRecord[]
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
  ending_portfolio_frozen_stop_risk: number
  terminal_owner_counts: Record<ReplayPortfolioProtectiveStrategyExitCancelTerminalOwner, number>
  limitations: typeof REPLAY_PORTFOLIO_PROTECTIVE_STRATEGY_EXIT_CANCEL_TERMINAL_LIMITATIONS
  fingerprint: ReplayPortfolioProtectiveStrategyExitCancelTerminalFingerprint
  evidence_hash: string
}

export const REPLAY_PORTFOLIO_PROTECTIVE_STRATEGY_EXIT_CANCEL_TERMINAL_ARTIFACT_ROLES = [
  "source_protective_terminal_artifact_manifest", "source_protective_terminal_evidence",
  "cancel_terminal_records", "ohlcv_resolutions", "cancel_terminal_fingerprint", "cancel_terminal_evidence",
] as const
export type ReplayPortfolioProtectiveStrategyExitCancelTerminalArtifactRole =
  typeof REPLAY_PORTFOLIO_PROTECTIVE_STRATEGY_EXIT_CANCEL_TERMINAL_ARTIFACT_ROLES[number]

export interface ReplayPortfolioProtectiveStrategyExitCancelTerminalArtifactManifest {
  schema_version: typeof REPLAY_PORTFOLIO_PROTECTIVE_STRATEGY_EXIT_CANCEL_TERMINAL_ARTIFACT_MANIFEST_SCHEMA_VERSION
  artifact_id: string
  portfolio_id: string
  cancel_terminal_evidence_hash: string
  cancel_terminal_fingerprint_hash: string
  source_protective_terminal_evidence_hash: string
  source_protective_terminal_artifact_manifest_hash: string
  files: Array<{ role: ReplayPortfolioProtectiveStrategyExitCancelTerminalArtifactRole; name: string; ref: string; sha256: string }>
  completeness: {
    authoritative_result: true
    required_roles: typeof REPLAY_PORTFOLIO_PROTECTIVE_STRATEGY_EXIT_CANCEL_TERMINAL_ARTIFACT_ROLES
    commit_marker: "portfolio-protective-strategy-exit-cancel-terminal-artifact-manifest.json"
    partial_payload_without_manifest_is_authoritative: false
  }
  authority_frozen_at: string
  manifest_hash: string
}

export interface ReplayPortfolioProtectiveStrategyExitCancelTerminalOutcome {
  schema_version: typeof REPLAY_PORTFOLIO_PROTECTIVE_STRATEGY_EXIT_CANCEL_TERMINAL_OUTCOME_SCHEMA_VERSION
  portfolio_id: string
  status: "completed" | "failed"
  source_protective_terminal_evidence: ReplayPortfolioProtectiveTerminalEvidence | null
  evidence: ReplayPortfolioProtectiveStrategyExitCancelTerminalEvidence | null
  artifact_manifest: ReplayPortfolioProtectiveStrategyExitCancelTerminalArtifactManifest | null
  idempotent_replay: boolean
  failure: {
    code: "protective-terminal-failed" | "cancel-terminal-input-invalid"
      | "cancel-terminal-engine-failed" | "cancel-terminal-artifact-failed"
    message: string
    partial_result_published: false
  } | null
  outcome_hash: string
}

export function replayPortfolioProtectiveStrategyExitCancelTerminalRecordHash(
  value: ReplayPortfolioProtectiveStrategyExitCancelTerminalRecord
    | Omit<ReplayPortfolioProtectiveStrategyExitCancelTerminalRecord, "record_hash">,
): string { const { record_hash: _, ...body } = value as ReplayPortfolioProtectiveStrategyExitCancelTerminalRecord; return canonicalHash(body) }
export function replayPortfolioProtectiveStrategyExitCancelTerminalFingerprintHash(
  value: ReplayPortfolioProtectiveStrategyExitCancelTerminalFingerprint
    | Omit<ReplayPortfolioProtectiveStrategyExitCancelTerminalFingerprint, "fingerprint_hash">,
): string { const { fingerprint_hash: _, ...body } = value as ReplayPortfolioProtectiveStrategyExitCancelTerminalFingerprint; return canonicalHash(body) }
export function replayPortfolioProtectiveStrategyExitCancelTerminalEvidenceHash(
  value: ReplayPortfolioProtectiveStrategyExitCancelTerminalEvidence
    | Omit<ReplayPortfolioProtectiveStrategyExitCancelTerminalEvidence, "evidence_hash">,
): string { const { evidence_hash: _, ...body } = value as ReplayPortfolioProtectiveStrategyExitCancelTerminalEvidence; return canonicalHash(body) }
export function replayPortfolioProtectiveStrategyExitCancelTerminalArtifactManifestHash(
  value: ReplayPortfolioProtectiveStrategyExitCancelTerminalArtifactManifest
    | Omit<ReplayPortfolioProtectiveStrategyExitCancelTerminalArtifactManifest, "manifest_hash">,
): string { const { manifest_hash: _, ...body } = value as ReplayPortfolioProtectiveStrategyExitCancelTerminalArtifactManifest; return canonicalHash(body) }
export function replayPortfolioProtectiveStrategyExitCancelTerminalOutcomeHash(
  value: ReplayPortfolioProtectiveStrategyExitCancelTerminalOutcome
    | Omit<ReplayPortfolioProtectiveStrategyExitCancelTerminalOutcome, "outcome_hash">,
): string { const { outcome_hash: _, ...body } = value as ReplayPortfolioProtectiveStrategyExitCancelTerminalOutcome; return canonicalHash(body) }

export function assertReplayPortfolioProtectiveStrategyExitCancelTerminalEvidence(
  value: ReplayPortfolioProtectiveStrategyExitCancelTerminalEvidence,
  source?: { evidence: ReplayPortfolioProtectiveTerminalEvidence; manifest: ReplayPortfolioProtectiveTerminalArtifactManifest; risk_result_hash: string },
): void {
  if (value.schema_version !== REPLAY_PORTFOLIO_PROTECTIVE_STRATEGY_EXIT_CANCEL_TERMINAL_EVIDENCE_SCHEMA_VERSION
      || value.policy_version !== REPLAY_PORTFOLIO_PROTECTIVE_STRATEGY_EXIT_CANCEL_TERMINAL_POLICY_VERSION
      || !value.experiment_id || !value.trial_group_id || !value.portfolio_id || !value.settlement_asset
      || JSON.stringify(value.limitations) !== JSON.stringify(REPLAY_PORTFOLIO_PROTECTIVE_STRATEGY_EXIT_CANCEL_TERMINAL_LIMITATIONS)) fail("identity/policy")
  const laneIds = value.lane_records.map((record) => record.lane_id)
  if (new Set(laneIds).size !== laneIds.length || JSON.stringify(laneIds) !== JSON.stringify([...laneIds].sort())
      || value.lane_records_hash !== canonicalHash(value.lane_records)
      || value.ohlcv_resolutions_hash !== canonicalHash(value.ohlcv_resolutions)) fail("record collection")
  const resolutions = new Map(value.ohlcv_resolutions.map((item) => [item.evidence_hash, item]))
  for (const record of value.lane_records) {
    const configured = !["not_configured", "not_opened"].includes(record.cancel_status)
    const cancelled = record.cancel_status === "cancelled_no_terminal" || record.cancel_status === "cancelled_then_terminal"
    const resolution = record.ohlcv_resolution_evidence_hash ? resolutions.get(record.ohlcv_resolution_evidence_hash) : null
    if (record.record_hash !== replayPortfolioProtectiveStrategyExitCancelTerminalRecordHash(record)
        || configured !== (record.cancel_intent_hash !== null && record.cancel_decision_sequence !== null
          && record.cancel_decision_time !== null && record.cancelled_strategy_exit_time !== null)
        || record.active_protection_mode !== "bracket"
        || cancelled && record.owner === "strategy_exit"
        || cancelled && Date.parse(record.cancel_decision_time!) >= Date.parse(record.cancelled_strategy_exit_time!)
        || record.owner === "not_opened" !== (record.cancel_status === "not_opened")
        || record.ending_open !== (record.owner === "open_at_data_end")
        || record.ohlcv_resolution_evidence_hash !== null && !resolution
        || resolution && (resolution.active_protection.protection_mode !== "bracket"
          || resolution.active_protection.stop_order_status !== "active"
          || resolution.active_protection.target_order_status !== "active"
          || resolution.evidence_hash !== record.terminal_source_hash
          || resolution.source_event_key.event_time !== record.terminal_time
          || resolution.status !== record.resolution_status)) fail("record semantics")
  }
  const economics = economicSummary(value)
  assertReplayPortfolioProtectiveReplacementTerminalCommon({
    value, owner_counts: ownerCounts(value.lane_records), economics,
    fingerprint_hash: replayPortfolioProtectiveStrategyExitCancelTerminalFingerprintHash(value.fingerprint),
    evidence_hash: replayPortfolioProtectiveStrategyExitCancelTerminalEvidenceHash(value), source, fail,
  })
}

export function assertReplayPortfolioProtectiveStrategyExitCancelTerminalArtifactManifest(
  value: ReplayPortfolioProtectiveStrategyExitCancelTerminalArtifactManifest,
): void {
  if (value.schema_version !== REPLAY_PORTFOLIO_PROTECTIVE_STRATEGY_EXIT_CANCEL_TERMINAL_ARTIFACT_MANIFEST_SCHEMA_VERSION
      || !value.artifact_id || !value.portfolio_id
      || JSON.stringify(value.files.map((file) => file.role)) !== JSON.stringify(REPLAY_PORTFOLIO_PROTECTIVE_STRATEGY_EXIT_CANCEL_TERMINAL_ARTIFACT_ROLES)
      || JSON.stringify(value.completeness.required_roles) !== JSON.stringify(REPLAY_PORTFOLIO_PROTECTIVE_STRATEGY_EXIT_CANCEL_TERMINAL_ARTIFACT_ROLES)
      || value.completeness.authoritative_result !== true
      || value.completeness.commit_marker !== "portfolio-protective-strategy-exit-cancel-terminal-artifact-manifest.json"
      || value.completeness.partial_payload_without_manifest_is_authoritative !== false
      || value.manifest_hash !== replayPortfolioProtectiveStrategyExitCancelTerminalArtifactManifestHash(value)) fail("artifact manifest")
}

export function assertReplayPortfolioProtectiveStrategyExitCancelTerminalOutcome(
  value: ReplayPortfolioProtectiveStrategyExitCancelTerminalOutcome,
): void {
  if (value.schema_version !== REPLAY_PORTFOLIO_PROTECTIVE_STRATEGY_EXIT_CANCEL_TERMINAL_OUTCOME_SCHEMA_VERSION
      || !value.portfolio_id
      || value.status === "completed" !== Boolean(value.source_protective_terminal_evidence && value.evidence && value.artifact_manifest && !value.failure)
      || value.status === "failed" !== Boolean(!value.source_protective_terminal_evidence && !value.evidence && !value.artifact_manifest && value.failure)
      || value.failure?.partial_result_published !== false && value.failure !== null
      || value.outcome_hash !== replayPortfolioProtectiveStrategyExitCancelTerminalOutcomeHash(value)) fail("outcome")
  if (value.evidence) assertReplayPortfolioProtectiveStrategyExitCancelTerminalEvidence(value.evidence)
  if (value.artifact_manifest) assertReplayPortfolioProtectiveStrategyExitCancelTerminalArtifactManifest(value.artifact_manifest)
}

function economicSummary(value: ReplayPortfolioProtectiveStrategyExitCancelTerminalEvidence) {
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
function ownerCounts(records: ReplayPortfolioProtectiveStrategyExitCancelTerminalRecord[]) {
  const counts: Record<ReplayPortfolioProtectiveStrategyExitCancelTerminalOwner, number> = {
    not_opened: 0, initial_protective_stop: 0, initial_take_profit: 0,
    exact_liquidation: 0, strategy_exit: 0, open_at_data_end: 0,
  }
  for (const record of records) counts[record.owner] += 1
  return counts
}
function fail(scope: string): never { throw new Error(`Portfolio Protective Strategy Exit Cancel Terminal ${scope} invalid`) }
