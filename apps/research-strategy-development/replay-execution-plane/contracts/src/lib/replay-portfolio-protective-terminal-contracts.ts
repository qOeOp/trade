import { canonicalHash, type ReplayOhlcvResolutionEvidence } from "./replay-contracts"
import type { ReplayIntegratedPortfolioArtifactManifest, ReplayIntegratedPortfolioResult } from "./replay-integrated-portfolio-contracts"
import type { ReplayPortfolioAllocationResult } from "./replay-portfolio-allocation-contracts"
import type { ReplayPortfolioMarkRiskRevaluationEvidence, ReplayPortfolioMarkRiskRevaluationArtifactManifest } from "./replay-portfolio-mark-risk-revaluation-contracts"
import type { ReplayRuntimeSharedWalletRiskResult } from "./replay-runtime-shared-wallet-risk-contracts"
import { addReplayDecimalValues } from "./replay-decimal"

export const REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_EVIDENCE_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-protective-terminal-evidence.v1" as const
export const REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ARTIFACT_MANIFEST_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-protective-terminal-artifact-manifest.v1" as const
export const REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_OUTCOME_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-protective-terminal-outcome.v1" as const
export const REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_POLICY_VERSION =
  "initial-simple-bracket-single-terminal-owner-v1" as const

export const REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_LIMITATIONS = [
  "one_simultaneous_initial_allocation_cycle_no_reentry",
  "initial_full_position_simple_bracket_only_no_mutation_or_partial",
  "ohlcv_collision_uses_conservative_stop_first_resolution_limited",
  "isolated_margin_no_cross_margin_borrow_real_liquidity_or_fast",
] as const

export type ReplayPortfolioProtectiveTerminalOwner =
  | "not_opened"
  | "initial_protective_stop"
  | "initial_take_profit"
  | "exact_liquidation"
  | "strategy_exit"
  | "open_at_data_end"

export interface ReplayPortfolioProtectiveTerminalRecord {
  record_hash: string
  lane_id: string
  symbol: string
  priority_rank: number
  request_hash: string
  allocation_decision_hash: string
  entry_fill_hash: string | null
  entry_time: string
  entry_price: number
  quantity: number
  side: "long" | "short"
  isolated_collateral: number
  entry_fee: number
  stop_price: number
  target_price: number
  bars_hash: string
  owner: ReplayPortfolioProtectiveTerminalOwner
  terminal_time: string | null
  terminal_phase: 15 | 20 | null
  terminal_source_hash: string | null
  preempted_upstream_terminal_hash: string | null
  ohlcv_resolution_evidence_hash: string | null
  resolution_status: "exact_under_ohlc" | "resolution_limited" | "not_applicable"
  funding_cashflow_before_terminal: number
  realized_pnl: number
  exit_trading_fee: number
  liquidation_fee: number
  released_collateral: number
  ending_unrealized_pnl: number
  ending_open: boolean
}

export interface ReplayPortfolioProtectiveTerminalFingerprint {
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  portfolio_id: string
  integrated_result_hash: string
  integrated_artifact_manifest_hash: string
  allocation_result_hash: string
  risk_result_hash: string
  mark_risk_revaluation_evidence_hash: string
  mark_risk_revaluation_artifact_manifest_hash: string
  lane_records_hash: string
  ohlcv_resolutions_hash: string
  economic_summary_hash: string
  limitations_hash: string
  fingerprint_hash: string
}

export interface ReplayPortfolioProtectiveTerminalEvidence {
  schema_version: typeof REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_EVIDENCE_SCHEMA_VERSION
  policy_version: typeof REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_POLICY_VERSION
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  portfolio_id: string
  settlement_asset: string
  shared_initial_cash: number
  integrated_result_hash: string
  integrated_artifact_manifest_hash: string
  allocation_result_hash: string
  risk_result_hash: string
  mark_risk_revaluation_evidence_hash: string
  mark_risk_revaluation_artifact_manifest_hash: string
  lane_records: ReplayPortfolioProtectiveTerminalRecord[]
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
  terminal_owner_counts: Record<ReplayPortfolioProtectiveTerminalOwner, number>
  limitations: typeof REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_LIMITATIONS
  fingerprint: ReplayPortfolioProtectiveTerminalFingerprint
  evidence_hash: string
}

export const REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ARTIFACT_ROLES = [
  "integrated_artifact_manifest", "mark_risk_revaluation_artifact_manifest", "allocation_result",
  "risk_result", "protective_terminal_records", "ohlcv_resolutions",
  "protective_terminal_fingerprint", "protective_terminal_evidence",
] as const
export type ReplayPortfolioProtectiveTerminalArtifactRole =
  typeof REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ARTIFACT_ROLES[number]

export interface ReplayPortfolioProtectiveTerminalArtifactManifest {
  schema_version: typeof REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ARTIFACT_MANIFEST_SCHEMA_VERSION
  artifact_id: string
  portfolio_id: string
  protective_terminal_evidence_hash: string
  protective_terminal_fingerprint_hash: string
  mark_risk_revaluation_evidence_hash: string
  files: Array<{ role: ReplayPortfolioProtectiveTerminalArtifactRole; name: string; ref: string; sha256: string }>
  completeness: {
    authoritative_result: true
    required_roles: typeof REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ARTIFACT_ROLES
    commit_marker: "portfolio-protective-terminal-artifact-manifest.json"
    partial_payload_without_manifest_is_authoritative: false
  }
  authority_frozen_at: string
  manifest_hash: string
}

export interface ReplayPortfolioProtectiveTerminalOutcome {
  schema_version: typeof REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_OUTCOME_SCHEMA_VERSION
  portfolio_id: string
  status: "completed" | "failed"
  integrated_result: ReplayIntegratedPortfolioResult | null
  evidence: ReplayPortfolioProtectiveTerminalEvidence | null
  artifact_manifest: ReplayPortfolioProtectiveTerminalArtifactManifest | null
  idempotent_replay: boolean
  failure: {
    code: "mark-risk-revaluation-failed" | "integrated-artifact-read-failed"
      | "protective-terminal-input-invalid" | "protective-terminal-engine-failed"
      | "protective-terminal-artifact-failed"
    message: string
    partial_result_published: false
  } | null
  outcome_hash: string
}

export function replayPortfolioProtectiveTerminalRecordHash(
  value: ReplayPortfolioProtectiveTerminalRecord | Omit<ReplayPortfolioProtectiveTerminalRecord, "record_hash">,
): string {
  const { record_hash: _hash, ...body } = value as ReplayPortfolioProtectiveTerminalRecord
  return canonicalHash(body)
}

export function replayPortfolioProtectiveTerminalFingerprintHash(
  value: ReplayPortfolioProtectiveTerminalFingerprint | Omit<ReplayPortfolioProtectiveTerminalFingerprint, "fingerprint_hash">,
): string {
  const { fingerprint_hash: _hash, ...body } = value as ReplayPortfolioProtectiveTerminalFingerprint
  return canonicalHash(body)
}

export function replayPortfolioProtectiveTerminalEvidenceHash(
  value: ReplayPortfolioProtectiveTerminalEvidence | Omit<ReplayPortfolioProtectiveTerminalEvidence, "evidence_hash">,
): string {
  const { evidence_hash: _hash, ...body } = value as ReplayPortfolioProtectiveTerminalEvidence
  return canonicalHash(body)
}

export function replayPortfolioProtectiveTerminalArtifactManifestHash(
  value: ReplayPortfolioProtectiveTerminalArtifactManifest | Omit<ReplayPortfolioProtectiveTerminalArtifactManifest, "manifest_hash">,
): string {
  const { manifest_hash: _hash, ...body } = value as ReplayPortfolioProtectiveTerminalArtifactManifest
  return canonicalHash(body)
}

export function replayPortfolioProtectiveTerminalOutcomeHash(
  value: ReplayPortfolioProtectiveTerminalOutcome | Omit<ReplayPortfolioProtectiveTerminalOutcome, "outcome_hash">,
): string {
  const { outcome_hash: _hash, ...body } = value as ReplayPortfolioProtectiveTerminalOutcome
  return canonicalHash(body)
}

export function assertReplayPortfolioProtectiveTerminalEvidence(
  value: ReplayPortfolioProtectiveTerminalEvidence,
  source?: {
    allocation_result: ReplayPortfolioAllocationResult
    risk_result: ReplayRuntimeSharedWalletRiskResult
    integrated_result: ReplayIntegratedPortfolioResult
    integrated_manifest: ReplayIntegratedPortfolioArtifactManifest
    revaluation_evidence: ReplayPortfolioMarkRiskRevaluationEvidence
    revaluation_manifest: ReplayPortfolioMarkRiskRevaluationArtifactManifest
  },
): void {
  if (value.schema_version !== REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_EVIDENCE_SCHEMA_VERSION
      || value.policy_version !== REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_POLICY_VERSION
      || !value.experiment_id || !value.trial_group_id || !value.portfolio_id || !value.settlement_asset
      || JSON.stringify(value.limitations) !== JSON.stringify(REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_LIMITATIONS)) {
    fail("identity/policy")
  }
  hashes([
    value.trial_group_hash, value.integrated_result_hash, value.integrated_artifact_manifest_hash,
    value.allocation_result_hash, value.risk_result_hash, value.mark_risk_revaluation_evidence_hash,
    value.mark_risk_revaluation_artifact_manifest_hash, value.lane_records_hash,
    value.ohlcv_resolutions_hash, value.fingerprint.fingerprint_hash, value.evidence_hash,
  ])
  const laneIds = value.lane_records.map((record) => record.lane_id)
  if (new Set(laneIds).size !== laneIds.length
      || JSON.stringify(laneIds) !== JSON.stringify([...laneIds].sort())
      || value.lane_records.some((record) => record.record_hash !== replayPortfolioProtectiveTerminalRecordHash(record))
      || value.lane_records_hash !== canonicalHash(value.lane_records)
      || value.ohlcv_resolutions_hash !== canonicalHash(value.ohlcv_resolutions)) fail("record collection")
  const resolutionHashes = new Set(value.ohlcv_resolutions.map((item) => item.evidence_hash))
  const resolutionByHash = new Map(value.ohlcv_resolutions.map((item) => [item.evidence_hash, item]))
  for (const record of value.lane_records) {
    const resolution = record.ohlcv_resolution_evidence_hash === null ? null
      : resolutionByHash.get(record.ohlcv_resolution_evidence_hash)
    if (!Number.isSafeInteger(record.priority_rank) || record.priority_rank < 1
        || record.quantity <= 0 || record.entry_price <= 0 || record.stop_price <= 0 || record.target_price <= 0
        || record.isolated_collateral < 0 || record.entry_fee < 0 || record.exit_trading_fee < 0
        || record.liquidation_fee < 0 || record.released_collateral < 0
        || record.ohlcv_resolution_evidence_hash !== null
          && !resolutionHashes.has(record.ohlcv_resolution_evidence_hash)
        || record.owner === "not_opened" && record.entry_fill_hash !== null
        || record.owner !== "not_opened" && record.entry_fill_hash === null
        || record.ending_open !== (record.owner === "open_at_data_end")
        || record.terminal_time === null !== (record.terminal_phase === null)
        || record.owner === "open_at_data_end" && record.terminal_time !== null
        || record.owner === "not_opened" && record.terminal_time !== null
        || ["initial_protective_stop", "initial_take_profit"].includes(record.owner) !== (resolution !== null)
        || resolution && (record.terminal_source_hash !== resolution.evidence_hash
          || record.terminal_time !== resolution.source_event_key.event_time
          || record.resolution_status !== resolution.status
          || record.owner !== (resolution.canonical.terminal_role === "stop"
            ? "initial_protective_stop" : "initial_take_profit"))) fail("record semantics")
  }
  const expectedCounts = ownerCounts(value.lane_records)
  if (canonicalHash(expectedCounts) !== canonicalHash(value.terminal_owner_counts)) fail("owner counts")
  const fingerprint = value.fingerprint
  if (fingerprint.experiment_id !== value.experiment_id || fingerprint.trial_group_id !== value.trial_group_id
      || fingerprint.trial_group_hash !== value.trial_group_hash || fingerprint.portfolio_id !== value.portfolio_id
      || fingerprint.integrated_result_hash !== value.integrated_result_hash
      || fingerprint.integrated_artifact_manifest_hash !== value.integrated_artifact_manifest_hash
      || fingerprint.allocation_result_hash !== value.allocation_result_hash
      || fingerprint.risk_result_hash !== value.risk_result_hash
      || fingerprint.mark_risk_revaluation_evidence_hash !== value.mark_risk_revaluation_evidence_hash
      || fingerprint.mark_risk_revaluation_artifact_manifest_hash !== value.mark_risk_revaluation_artifact_manifest_hash
      || fingerprint.lane_records_hash !== value.lane_records_hash
      || fingerprint.ohlcv_resolutions_hash !== value.ohlcv_resolutions_hash
      || fingerprint.economic_summary_hash !== canonicalHash(economicSummary(value))
      || fingerprint.limitations_hash !== canonicalHash(value.limitations)
      || fingerprint.fingerprint_hash !== replayPortfolioProtectiveTerminalFingerprintHash(fingerprint)) fail("fingerprint")
  if (value.evidence_hash !== replayPortfolioProtectiveTerminalEvidenceHash(value)) fail("evidence hash")
  const economics = economicSummary(value)
  if (canonicalHash(economics) !== fingerprint.economic_summary_hash
      || economics.ending_settled_cash !== value.ending_settled_cash
      || economics.ending_reserved_isolated_collateral !== value.ending_reserved_isolated_collateral
      || economics.ending_available_cash !== value.ending_available_cash
      || economics.ending_unrealized_pnl !== value.ending_unrealized_pnl
      || economics.ending_portfolio_nav !== value.ending_portfolio_nav) fail("economic summary")
  if (source && (value.allocation_result_hash !== source.allocation_result.result_hash
      || value.risk_result_hash !== source.risk_result.result_hash
      || value.integrated_result_hash !== source.integrated_result.result_hash
      || value.integrated_artifact_manifest_hash !== source.integrated_manifest.manifest_hash
      || value.mark_risk_revaluation_evidence_hash !== source.revaluation_evidence.evidence_hash
      || value.mark_risk_revaluation_artifact_manifest_hash !== source.revaluation_manifest.manifest_hash)) fail("source binding")
}

export function assertReplayPortfolioProtectiveTerminalArtifactManifest(
  value: ReplayPortfolioProtectiveTerminalArtifactManifest,
): void {
  if (value.schema_version !== REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ARTIFACT_MANIFEST_SCHEMA_VERSION
      || !value.artifact_id || !value.portfolio_id || value.files.length !== REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ARTIFACT_ROLES.length
      || JSON.stringify(value.files.map((file) => file.role)) !== JSON.stringify(REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ARTIFACT_ROLES)
      || value.completeness.authoritative_result !== true
      || value.completeness.commit_marker !== "portfolio-protective-terminal-artifact-manifest.json"
      || value.completeness.partial_payload_without_manifest_is_authoritative !== false
      || JSON.stringify(value.completeness.required_roles) !== JSON.stringify(REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ARTIFACT_ROLES)
      || value.manifest_hash !== replayPortfolioProtectiveTerminalArtifactManifestHash(value)) fail("artifact manifest")
  hashes([value.protective_terminal_evidence_hash, value.protective_terminal_fingerprint_hash,
    value.mark_risk_revaluation_evidence_hash, ...value.files.flatMap((file) => [file.sha256])])
}

export function assertReplayPortfolioProtectiveTerminalOutcome(value: ReplayPortfolioProtectiveTerminalOutcome): void {
  if (value.schema_version !== REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_OUTCOME_SCHEMA_VERSION || !value.portfolio_id
      || value.status === "completed" !== (value.evidence !== null && value.integrated_result !== null
        && value.artifact_manifest !== null && value.failure === null)
      || value.status === "failed" !== (value.evidence === null && value.integrated_result === null
        && value.artifact_manifest === null && value.failure !== null)
      || value.failure && value.failure.partial_result_published !== false
      || value.outcome_hash !== replayPortfolioProtectiveTerminalOutcomeHash(value)) fail("outcome")
  if (value.evidence) assertReplayPortfolioProtectiveTerminalEvidence(value.evidence)
  if (value.artifact_manifest) assertReplayPortfolioProtectiveTerminalArtifactManifest(value.artifact_manifest)
}

function ownerCounts(records: ReplayPortfolioProtectiveTerminalRecord[]): Record<ReplayPortfolioProtectiveTerminalOwner, number> {
  const counts = {
    not_opened: 0, initial_protective_stop: 0, initial_take_profit: 0,
    exact_liquidation: 0, strategy_exit: 0, open_at_data_end: 0,
  }
  for (const record of records) counts[record.owner] += 1
  return counts
}

function economicSummary(value: ReplayPortfolioProtectiveTerminalEvidence) {
  let settled = value.shared_initial_cash
  let reserved = 0
  let unrealized = 0
  for (const record of value.lane_records) {
    if (record.owner === "not_opened") continue
    settled = addReplayDecimalValues(settled, -record.entry_fee, record.funding_cashflow_before_terminal,
      record.realized_pnl, -record.exit_trading_fee, -record.liquidation_fee)
    if (record.ending_open) {
      reserved = addReplayDecimalValues(reserved, record.isolated_collateral)
      unrealized = addReplayDecimalValues(unrealized, record.ending_unrealized_pnl)
    }
  }
  return {
    ending_settled_cash: settled,
    ending_reserved_isolated_collateral: reserved,
    ending_available_cash: addReplayDecimalValues(settled, -reserved),
    ending_unrealized_pnl: unrealized,
    ending_portfolio_nav: addReplayDecimalValues(settled, unrealized),
  }
}

function hashes(values: string[]): void {
  if (values.some((value) => !/^[a-f0-9]{64}$/.test(value))) fail("hash")
}

function fail(scope: string): never { throw new Error(`Portfolio Protective Terminal ${scope} invalid`) }
