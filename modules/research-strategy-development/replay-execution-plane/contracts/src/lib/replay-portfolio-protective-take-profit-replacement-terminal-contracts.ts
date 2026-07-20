import { canonicalHash, type ReplayOhlcvResolutionEvidence } from "./replay-contracts"
import { addReplayDecimalValues } from "./replay-decimal"
import {
  type ReplayPortfolioProtectiveTerminalArtifactManifest,
  type ReplayPortfolioProtectiveTerminalEvidence,
  type ReplayPortfolioProtectiveTerminalRecord,
} from "./replay-portfolio-protective-terminal-contracts"
import { assertReplayPortfolioProtectiveReplacementTerminalCommon } from
  "./replay-portfolio-protective-replacement-contract-validation"

export const REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_EVIDENCE_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-protective-take-profit-replacement-terminal-evidence.v1" as const
export const REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_ARTIFACT_MANIFEST_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-protective-take-profit-replacement-terminal-artifact-manifest.v1" as const
export const REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_OUTCOME_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-protective-take-profit-replacement-terminal-outcome.v1" as const
export const REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_POLICY_VERSION =
  "one-predeclared-full-position-take-profit-replacement-v1" as const

export const REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_LIMITATIONS = [
  "one_simultaneous_initial_allocation_cycle_no_reentry",
  "zero_or_one_predeclared_full_position_take_profit_replacement_per_lane",
  "replacement_close_bar_market_terminal_precedes_close_time_replacement",
  "unchanged_protective_stop_no_cancel_partial_or_second_replacement",
  "ohlcv_collision_uses_conservative_stop_first_resolution_limited",
  "isolated_margin_no_cross_margin_borrow_real_liquidity_or_fast",
] as const

export type ReplayPortfolioProtectiveTakeProfitReplacementTerminalOwner =
  | "not_opened"
  | "initial_protective_stop"
  | "replacement_take_profit"
  | "initial_take_profit"
  | "exact_liquidation"
  | "strategy_exit"
  | "open_at_data_end"

export type ReplayPortfolioProtectiveTakeProfitReplacementStatus =
  | "not_configured"
  | "not_opened"
  | "terminal_before_or_at_decision"
  | "activated_no_terminal"
  | "activated_then_terminal"

export interface ReplayPortfolioProtectiveTakeProfitReplacementTerminalRecord
  extends Omit<ReplayPortfolioProtectiveTerminalRecord, "record_hash" | "owner"> {
  record_hash: string
  owner: ReplayPortfolioProtectiveTakeProfitReplacementTerminalOwner
  source_protective_terminal_record_hash: string
  replacement_status: ReplayPortfolioProtectiveTakeProfitReplacementStatus
  replacement_decision_sequence: number | null
  replacement_decision_time: string | null
  replacement_intent_hash: string | null
  previous_target_price: number | null
  active_target_price: number
  active_protection_generation: 1 | 2
}

export interface ReplayPortfolioProtectiveTakeProfitReplacementTerminalFingerprint {
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

export interface ReplayPortfolioProtectiveTakeProfitReplacementTerminalEvidence {
  schema_version: typeof REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_EVIDENCE_SCHEMA_VERSION
  policy_version: typeof REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_POLICY_VERSION
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  portfolio_id: string
  settlement_asset: string
  shared_initial_cash: number
  source_protective_terminal_evidence_hash: string
  source_protective_terminal_artifact_manifest_hash: string
  risk_result_hash: string
  lane_records: ReplayPortfolioProtectiveTakeProfitReplacementTerminalRecord[]
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
  terminal_owner_counts: Record<ReplayPortfolioProtectiveTakeProfitReplacementTerminalOwner, number>
  limitations: typeof REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_LIMITATIONS
  fingerprint: ReplayPortfolioProtectiveTakeProfitReplacementTerminalFingerprint
  evidence_hash: string
}

export const REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_ARTIFACT_ROLES = [
  "source_protective_terminal_artifact_manifest",
  "source_protective_terminal_evidence",
  "replacement_terminal_records",
  "ohlcv_resolutions",
  "replacement_terminal_fingerprint",
  "replacement_terminal_evidence",
] as const
export type ReplayPortfolioProtectiveTakeProfitReplacementTerminalArtifactRole =
  typeof REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_ARTIFACT_ROLES[number]

export interface ReplayPortfolioProtectiveTakeProfitReplacementTerminalArtifactManifest {
  schema_version: typeof REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_ARTIFACT_MANIFEST_SCHEMA_VERSION
  artifact_id: string
  portfolio_id: string
  replacement_terminal_evidence_hash: string
  replacement_terminal_fingerprint_hash: string
  source_protective_terminal_evidence_hash: string
  source_protective_terminal_artifact_manifest_hash: string
  files: Array<{
    role: ReplayPortfolioProtectiveTakeProfitReplacementTerminalArtifactRole
    name: string
    ref: string
    sha256: string
  }>
  completeness: {
    authoritative_result: true
    required_roles: typeof REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_ARTIFACT_ROLES
    commit_marker: "portfolio-protective-take-profit-replacement-terminal-artifact-manifest.json"
    partial_payload_without_manifest_is_authoritative: false
  }
  authority_frozen_at: string
  manifest_hash: string
}

export interface ReplayPortfolioProtectiveTakeProfitReplacementTerminalOutcome {
  schema_version: typeof REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_OUTCOME_SCHEMA_VERSION
  portfolio_id: string
  status: "completed" | "failed"
  source_protective_terminal_evidence: ReplayPortfolioProtectiveTerminalEvidence | null
  evidence: ReplayPortfolioProtectiveTakeProfitReplacementTerminalEvidence | null
  artifact_manifest: ReplayPortfolioProtectiveTakeProfitReplacementTerminalArtifactManifest | null
  idempotent_replay: boolean
  failure: {
    code: "protective-terminal-failed" | "replacement-terminal-input-invalid"
      | "replacement-terminal-engine-failed" | "replacement-terminal-artifact-failed"
    message: string
    partial_result_published: false
  } | null
  outcome_hash: string
}

export function replayPortfolioProtectiveTakeProfitReplacementTerminalRecordHash(
  value: ReplayPortfolioProtectiveTakeProfitReplacementTerminalRecord
    | Omit<ReplayPortfolioProtectiveTakeProfitReplacementTerminalRecord, "record_hash">,
): string {
  const { record_hash: _hash, ...body } = value as ReplayPortfolioProtectiveTakeProfitReplacementTerminalRecord
  return canonicalHash(body)
}

export function replayPortfolioProtectiveTakeProfitReplacementTerminalFingerprintHash(
  value: ReplayPortfolioProtectiveTakeProfitReplacementTerminalFingerprint
    | Omit<ReplayPortfolioProtectiveTakeProfitReplacementTerminalFingerprint, "fingerprint_hash">,
): string {
  const { fingerprint_hash: _hash, ...body } = value as ReplayPortfolioProtectiveTakeProfitReplacementTerminalFingerprint
  return canonicalHash(body)
}

export function replayPortfolioProtectiveTakeProfitReplacementTerminalEvidenceHash(
  value: ReplayPortfolioProtectiveTakeProfitReplacementTerminalEvidence
    | Omit<ReplayPortfolioProtectiveTakeProfitReplacementTerminalEvidence, "evidence_hash">,
): string {
  const { evidence_hash: _hash, ...body } = value as ReplayPortfolioProtectiveTakeProfitReplacementTerminalEvidence
  return canonicalHash(body)
}

export function replayPortfolioProtectiveTakeProfitReplacementTerminalArtifactManifestHash(
  value: ReplayPortfolioProtectiveTakeProfitReplacementTerminalArtifactManifest
    | Omit<ReplayPortfolioProtectiveTakeProfitReplacementTerminalArtifactManifest, "manifest_hash">,
): string {
  const { manifest_hash: _hash, ...body } = value as ReplayPortfolioProtectiveTakeProfitReplacementTerminalArtifactManifest
  return canonicalHash(body)
}

export function replayPortfolioProtectiveTakeProfitReplacementTerminalOutcomeHash(
  value: ReplayPortfolioProtectiveTakeProfitReplacementTerminalOutcome
    | Omit<ReplayPortfolioProtectiveTakeProfitReplacementTerminalOutcome, "outcome_hash">,
): string {
  const { outcome_hash: _hash, ...body } = value as ReplayPortfolioProtectiveTakeProfitReplacementTerminalOutcome
  return canonicalHash(body)
}

export function assertReplayPortfolioProtectiveTakeProfitReplacementTerminalEvidence(
  value: ReplayPortfolioProtectiveTakeProfitReplacementTerminalEvidence,
  source?: {
    evidence: ReplayPortfolioProtectiveTerminalEvidence
    manifest: ReplayPortfolioProtectiveTerminalArtifactManifest
    risk_result_hash: string
  },
): void {
  if (value.schema_version !== REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_EVIDENCE_SCHEMA_VERSION
      || value.policy_version !== REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_POLICY_VERSION
      || !value.experiment_id || !value.trial_group_id || !value.portfolio_id || !value.settlement_asset
      || JSON.stringify(value.limitations)
        !== JSON.stringify(REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_LIMITATIONS)) fail("identity/policy")
  hashes([value.trial_group_hash, value.source_protective_terminal_evidence_hash,
    value.source_protective_terminal_artifact_manifest_hash, value.risk_result_hash,
    value.lane_records_hash, value.ohlcv_resolutions_hash, value.fingerprint.fingerprint_hash,
    value.evidence_hash])
  const laneIds = value.lane_records.map((record) => record.lane_id)
  if (new Set(laneIds).size !== laneIds.length
      || JSON.stringify(laneIds) !== JSON.stringify([...laneIds].sort())
      || value.lane_records_hash !== canonicalHash(value.lane_records)
      || value.ohlcv_resolutions_hash !== canonicalHash(value.ohlcv_resolutions)
      || value.lane_records.some((record) =>
        record.record_hash !== replayPortfolioProtectiveTakeProfitReplacementTerminalRecordHash(record))) fail("record collection")
  const resolutionByHash = new Map(value.ohlcv_resolutions.map((item) => [item.evidence_hash, item]))
  for (const record of value.lane_records) {
    const resolution = record.ohlcv_resolution_evidence_hash === null
      ? null : resolutionByHash.get(record.ohlcv_resolution_evidence_hash)
    const configured = record.replacement_status !== "not_configured" && record.replacement_status !== "not_opened"
    const activated = record.replacement_status === "activated_no_terminal"
      || record.replacement_status === "activated_then_terminal"
    if (!/^[a-f0-9]{64}$/.test(record.source_protective_terminal_record_hash)
        || record.active_protection_generation === 2 !== activated
        || configured !== (record.replacement_intent_hash !== null && record.replacement_decision_sequence !== null
          && record.replacement_decision_time !== null && record.previous_target_price !== null)
        || record.active_target_price <= 0
        || activated && record.active_target_price === record.previous_target_price
        || activated && record.side === "long"
          && !(record.active_target_price > record.stop_price && record.active_target_price > record.entry_price)
        || activated && record.side === "short"
          && !(record.active_target_price < record.stop_price && record.active_target_price < record.entry_price)
        || record.owner === "replacement_take_profit"
          && (record.replacement_status !== "activated_then_terminal" || resolution?.canonical.terminal_role !== "target")
        || record.owner === "not_opened" !== (record.replacement_status === "not_opened")
        || record.ending_open !== (record.owner === "open_at_data_end")
        || record.ohlcv_resolution_evidence_hash !== null && !resolution
        || resolution && (resolution.evidence_hash !== record.terminal_source_hash
          || resolution.source_event_key.event_time !== record.terminal_time
          || resolution.status !== record.resolution_status)) fail("record semantics")
  }
  const economics = economicSummary(value)
  assertReplayPortfolioProtectiveReplacementTerminalCommon({
    value,
    owner_counts: ownerCounts(value.lane_records),
    economics,
    fingerprint_hash: replayPortfolioProtectiveTakeProfitReplacementTerminalFingerprintHash(value.fingerprint),
    evidence_hash: replayPortfolioProtectiveTakeProfitReplacementTerminalEvidenceHash(value),
    source,
    fail,
  })
}

export function assertReplayPortfolioProtectiveTakeProfitReplacementTerminalArtifactManifest(
  value: ReplayPortfolioProtectiveTakeProfitReplacementTerminalArtifactManifest,
): void {
  if (value.schema_version
      !== REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_ARTIFACT_MANIFEST_SCHEMA_VERSION
      || !value.artifact_id || !value.portfolio_id
      || value.files.length !== REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_ARTIFACT_ROLES.length
      || JSON.stringify(value.files.map((file) => file.role))
        !== JSON.stringify(REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_ARTIFACT_ROLES)
      || JSON.stringify(value.completeness.required_roles)
        !== JSON.stringify(REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_ARTIFACT_ROLES)
      || value.completeness.authoritative_result !== true
      || value.completeness.commit_marker
        !== "portfolio-protective-take-profit-replacement-terminal-artifact-manifest.json"
      || value.completeness.partial_payload_without_manifest_is_authoritative !== false
      || value.manifest_hash
        !== replayPortfolioProtectiveTakeProfitReplacementTerminalArtifactManifestHash(value)) fail("artifact manifest")
  hashes([value.replacement_terminal_evidence_hash, value.replacement_terminal_fingerprint_hash,
    value.source_protective_terminal_evidence_hash,
    value.source_protective_terminal_artifact_manifest_hash, ...value.files.map((file) => file.sha256)])
}

export function assertReplayPortfolioProtectiveTakeProfitReplacementTerminalOutcome(
  value: ReplayPortfolioProtectiveTakeProfitReplacementTerminalOutcome,
): void {
  if (value.schema_version !== REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_OUTCOME_SCHEMA_VERSION
      || !value.portfolio_id
      || value.status === "completed" !== (value.source_protective_terminal_evidence !== null
        && value.evidence !== null && value.artifact_manifest !== null && value.failure === null)
      || value.status === "failed" !== (value.source_protective_terminal_evidence === null
        && value.evidence === null && value.artifact_manifest === null && value.failure !== null)
      || value.failure && value.failure.partial_result_published !== false
      || value.outcome_hash !== replayPortfolioProtectiveTakeProfitReplacementTerminalOutcomeHash(value)) fail("outcome")
  if (value.evidence) assertReplayPortfolioProtectiveTakeProfitReplacementTerminalEvidence(value.evidence)
  if (value.artifact_manifest) assertReplayPortfolioProtectiveTakeProfitReplacementTerminalArtifactManifest(value.artifact_manifest)
}

function economicSummary(value: ReplayPortfolioProtectiveTakeProfitReplacementTerminalEvidence) {
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

function ownerCounts(records: ReplayPortfolioProtectiveTakeProfitReplacementTerminalRecord[]) {
  const counts: Record<ReplayPortfolioProtectiveTakeProfitReplacementTerminalOwner, number> = {
    not_opened: 0, initial_protective_stop: 0, replacement_take_profit: 0,
    initial_take_profit: 0, exact_liquidation: 0, strategy_exit: 0, open_at_data_end: 0,
  }
  for (const record of records) counts[record.owner] += 1
  return counts
}

function hashes(values: string[]): void {
  if (values.some((value) => !/^[a-f0-9]{64}$/.test(value))) fail("hash")
}

function fail(scope: string): never {
  throw new Error(`Portfolio Protective Take Profit Replacement Terminal ${scope} invalid`)
}
