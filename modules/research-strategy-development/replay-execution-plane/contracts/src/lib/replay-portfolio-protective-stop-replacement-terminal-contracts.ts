import { canonicalHash, type ReplayOhlcvResolutionEvidence } from "./replay-contracts"
import { addReplayDecimalValues } from "./replay-decimal"
import {
  type ReplayPortfolioProtectiveTerminalArtifactManifest,
  type ReplayPortfolioProtectiveTerminalEvidence,
  type ReplayPortfolioProtectiveTerminalRecord,
} from "./replay-portfolio-protective-terminal-contracts"
import { assertReplayPortfolioProtectiveReplacementTerminalCommon } from
  "./replay-portfolio-protective-replacement-contract-validation"

export const REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_EVIDENCE_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-protective-stop-replacement-terminal-evidence.v1" as const
export const REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_ARTIFACT_MANIFEST_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-protective-stop-replacement-terminal-artifact-manifest.v1" as const
export const REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_OUTCOME_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-protective-stop-replacement-terminal-outcome.v1" as const
export const REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_POLICY_VERSION =
  "one-predeclared-tighten-only-full-position-stop-replacement-v1" as const

export const REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_LIMITATIONS = [
  "one_simultaneous_initial_allocation_cycle_no_reentry",
  "zero_or_one_predeclared_tighten_only_full_position_stop_replacement_per_lane",
  "replacement_close_bar_market_terminal_precedes_close_time_replacement",
  "unchanged_take_profit_no_cancel_partial_or_second_replacement",
  "ohlcv_collision_uses_conservative_stop_first_resolution_limited",
  "isolated_margin_no_cross_margin_borrow_real_liquidity_or_fast",
] as const

export type ReplayPortfolioProtectiveStopReplacementTerminalOwner =
  | "not_opened"
  | "initial_protective_stop"
  | "replacement_protective_stop"
  | "initial_take_profit"
  | "exact_liquidation"
  | "strategy_exit"
  | "open_at_data_end"

export type ReplayPortfolioProtectiveStopReplacementStatus =
  | "not_configured"
  | "not_opened"
  | "terminal_before_or_at_decision"
  | "activated_no_terminal"
  | "activated_then_terminal"

export interface ReplayPortfolioProtectiveStopReplacementTerminalRecord
  extends Omit<ReplayPortfolioProtectiveTerminalRecord, "record_hash" | "owner"> {
  record_hash: string
  owner: ReplayPortfolioProtectiveStopReplacementTerminalOwner
  source_protective_terminal_record_hash: string
  replacement_status: ReplayPortfolioProtectiveStopReplacementStatus
  replacement_decision_sequence: number | null
  replacement_decision_time: string | null
  replacement_intent_hash: string | null
  previous_stop_price: number | null
  active_stop_price: number
  active_protection_generation: 1 | 2
}

export interface ReplayPortfolioProtectiveStopReplacementTerminalFingerprint {
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

export interface ReplayPortfolioProtectiveStopReplacementTerminalEvidence {
  schema_version: typeof REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_EVIDENCE_SCHEMA_VERSION
  policy_version: typeof REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_POLICY_VERSION
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  portfolio_id: string
  settlement_asset: string
  shared_initial_cash: number
  source_protective_terminal_evidence_hash: string
  source_protective_terminal_artifact_manifest_hash: string
  risk_result_hash: string
  lane_records: ReplayPortfolioProtectiveStopReplacementTerminalRecord[]
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
  terminal_owner_counts: Record<ReplayPortfolioProtectiveStopReplacementTerminalOwner, number>
  limitations: typeof REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_LIMITATIONS
  fingerprint: ReplayPortfolioProtectiveStopReplacementTerminalFingerprint
  evidence_hash: string
}

export const REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_ARTIFACT_ROLES = [
  "source_protective_terminal_artifact_manifest",
  "source_protective_terminal_evidence",
  "replacement_terminal_records",
  "ohlcv_resolutions",
  "replacement_terminal_fingerprint",
  "replacement_terminal_evidence",
] as const
export type ReplayPortfolioProtectiveStopReplacementTerminalArtifactRole =
  typeof REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_ARTIFACT_ROLES[number]

export interface ReplayPortfolioProtectiveStopReplacementTerminalArtifactManifest {
  schema_version: typeof REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_ARTIFACT_MANIFEST_SCHEMA_VERSION
  artifact_id: string
  portfolio_id: string
  replacement_terminal_evidence_hash: string
  replacement_terminal_fingerprint_hash: string
  source_protective_terminal_evidence_hash: string
  source_protective_terminal_artifact_manifest_hash: string
  files: Array<{
    role: ReplayPortfolioProtectiveStopReplacementTerminalArtifactRole
    name: string
    ref: string
    sha256: string
  }>
  completeness: {
    authoritative_result: true
    required_roles: typeof REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_ARTIFACT_ROLES
    commit_marker: "portfolio-protective-stop-replacement-terminal-artifact-manifest.json"
    partial_payload_without_manifest_is_authoritative: false
  }
  authority_frozen_at: string
  manifest_hash: string
}

export interface ReplayPortfolioProtectiveStopReplacementTerminalOutcome {
  schema_version: typeof REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_OUTCOME_SCHEMA_VERSION
  portfolio_id: string
  status: "completed" | "failed"
  source_protective_terminal_evidence: ReplayPortfolioProtectiveTerminalEvidence | null
  evidence: ReplayPortfolioProtectiveStopReplacementTerminalEvidence | null
  artifact_manifest: ReplayPortfolioProtectiveStopReplacementTerminalArtifactManifest | null
  idempotent_replay: boolean
  failure: {
    code: "protective-terminal-failed" | "replacement-terminal-input-invalid"
      | "replacement-terminal-engine-failed" | "replacement-terminal-artifact-failed"
    message: string
    partial_result_published: false
  } | null
  outcome_hash: string
}

export function replayPortfolioProtectiveStopReplacementTerminalRecordHash(
  value: ReplayPortfolioProtectiveStopReplacementTerminalRecord
    | Omit<ReplayPortfolioProtectiveStopReplacementTerminalRecord, "record_hash">,
): string {
  const { record_hash: _hash, ...body } = value as ReplayPortfolioProtectiveStopReplacementTerminalRecord
  return canonicalHash(body)
}

export function replayPortfolioProtectiveStopReplacementTerminalFingerprintHash(
  value: ReplayPortfolioProtectiveStopReplacementTerminalFingerprint
    | Omit<ReplayPortfolioProtectiveStopReplacementTerminalFingerprint, "fingerprint_hash">,
): string {
  const { fingerprint_hash: _hash, ...body } = value as ReplayPortfolioProtectiveStopReplacementTerminalFingerprint
  return canonicalHash(body)
}

export function replayPortfolioProtectiveStopReplacementTerminalEvidenceHash(
  value: ReplayPortfolioProtectiveStopReplacementTerminalEvidence
    | Omit<ReplayPortfolioProtectiveStopReplacementTerminalEvidence, "evidence_hash">,
): string {
  const { evidence_hash: _hash, ...body } = value as ReplayPortfolioProtectiveStopReplacementTerminalEvidence
  return canonicalHash(body)
}

export function replayPortfolioProtectiveStopReplacementTerminalArtifactManifestHash(
  value: ReplayPortfolioProtectiveStopReplacementTerminalArtifactManifest
    | Omit<ReplayPortfolioProtectiveStopReplacementTerminalArtifactManifest, "manifest_hash">,
): string {
  const { manifest_hash: _hash, ...body } = value as ReplayPortfolioProtectiveStopReplacementTerminalArtifactManifest
  return canonicalHash(body)
}

export function replayPortfolioProtectiveStopReplacementTerminalOutcomeHash(
  value: ReplayPortfolioProtectiveStopReplacementTerminalOutcome
    | Omit<ReplayPortfolioProtectiveStopReplacementTerminalOutcome, "outcome_hash">,
): string {
  const { outcome_hash: _hash, ...body } = value as ReplayPortfolioProtectiveStopReplacementTerminalOutcome
  return canonicalHash(body)
}

export function assertReplayPortfolioProtectiveStopReplacementTerminalEvidence(
  value: ReplayPortfolioProtectiveStopReplacementTerminalEvidence,
  source?: {
    evidence: ReplayPortfolioProtectiveTerminalEvidence
    manifest: ReplayPortfolioProtectiveTerminalArtifactManifest
    risk_result_hash: string
  },
): void {
  if (value.schema_version !== REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_EVIDENCE_SCHEMA_VERSION
      || value.policy_version !== REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_POLICY_VERSION
      || !value.experiment_id || !value.trial_group_id || !value.portfolio_id || !value.settlement_asset
      || JSON.stringify(value.limitations)
        !== JSON.stringify(REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_LIMITATIONS)) fail("identity/policy")
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
        record.record_hash !== replayPortfolioProtectiveStopReplacementTerminalRecordHash(record))) fail("record collection")
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
          && record.replacement_decision_time !== null && record.previous_stop_price !== null)
        || record.active_stop_price <= 0
        || activated && record.side === "long" && !(record.active_stop_price > record.previous_stop_price!)
        || activated && record.side === "short" && !(record.active_stop_price < record.previous_stop_price!)
        || record.owner === "replacement_protective_stop"
          && (record.replacement_status !== "activated_then_terminal" || resolution?.canonical.terminal_role !== "stop")
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
    fingerprint_hash: replayPortfolioProtectiveStopReplacementTerminalFingerprintHash(value.fingerprint),
    evidence_hash: replayPortfolioProtectiveStopReplacementTerminalEvidenceHash(value),
    source,
    fail,
  })
}

export function assertReplayPortfolioProtectiveStopReplacementTerminalArtifactManifest(
  value: ReplayPortfolioProtectiveStopReplacementTerminalArtifactManifest,
): void {
  if (value.schema_version
      !== REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_ARTIFACT_MANIFEST_SCHEMA_VERSION
      || !value.artifact_id || !value.portfolio_id
      || value.files.length !== REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_ARTIFACT_ROLES.length
      || JSON.stringify(value.files.map((file) => file.role))
        !== JSON.stringify(REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_ARTIFACT_ROLES)
      || JSON.stringify(value.completeness.required_roles)
        !== JSON.stringify(REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_ARTIFACT_ROLES)
      || value.completeness.authoritative_result !== true
      || value.completeness.commit_marker
        !== "portfolio-protective-stop-replacement-terminal-artifact-manifest.json"
      || value.completeness.partial_payload_without_manifest_is_authoritative !== false
      || value.manifest_hash
        !== replayPortfolioProtectiveStopReplacementTerminalArtifactManifestHash(value)) fail("artifact manifest")
  hashes([value.replacement_terminal_evidence_hash, value.replacement_terminal_fingerprint_hash,
    value.source_protective_terminal_evidence_hash,
    value.source_protective_terminal_artifact_manifest_hash, ...value.files.map((file) => file.sha256)])
}

export function assertReplayPortfolioProtectiveStopReplacementTerminalOutcome(
  value: ReplayPortfolioProtectiveStopReplacementTerminalOutcome,
): void {
  if (value.schema_version !== REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_OUTCOME_SCHEMA_VERSION
      || !value.portfolio_id
      || value.status === "completed" !== (value.source_protective_terminal_evidence !== null
        && value.evidence !== null && value.artifact_manifest !== null && value.failure === null)
      || value.status === "failed" !== (value.source_protective_terminal_evidence === null
        && value.evidence === null && value.artifact_manifest === null && value.failure !== null)
      || value.failure && value.failure.partial_result_published !== false
      || value.outcome_hash !== replayPortfolioProtectiveStopReplacementTerminalOutcomeHash(value)) fail("outcome")
  if (value.evidence) assertReplayPortfolioProtectiveStopReplacementTerminalEvidence(value.evidence)
  if (value.artifact_manifest) assertReplayPortfolioProtectiveStopReplacementTerminalArtifactManifest(value.artifact_manifest)
}

function economicSummary(value: ReplayPortfolioProtectiveStopReplacementTerminalEvidence) {
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

function ownerCounts(records: ReplayPortfolioProtectiveStopReplacementTerminalRecord[]) {
  const counts: Record<ReplayPortfolioProtectiveStopReplacementTerminalOwner, number> = {
    not_opened: 0, initial_protective_stop: 0, replacement_protective_stop: 0,
    initial_take_profit: 0, exact_liquidation: 0, strategy_exit: 0, open_at_data_end: 0,
  }
  for (const record of records) counts[record.owner] += 1
  return counts
}

function hashes(values: string[]): void {
  if (values.some((value) => !/^[a-f0-9]{64}$/.test(value))) fail("hash")
}

function fail(scope: string): never {
  throw new Error(`Portfolio Protective Stop Replacement Terminal ${scope} invalid`)
}
