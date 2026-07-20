import {
  canonicalHash,
  type ReplayArtifactManifest,
  type ReplayEventKey,
  type ReplayResult,
} from "./replay-contracts"
import { addReplayDecimalValues } from "./replay-decimal"

export const REPLAY_PORTFOLIO_FIXED_PARTIAL_TERMINAL_EVIDENCE_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-fixed-partial-terminal-evidence.v1" as const
export const REPLAY_PORTFOLIO_FIXED_PARTIAL_TERMINAL_ARTIFACT_MANIFEST_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-fixed-partial-terminal-artifact-manifest.v1" as const
export const REPLAY_PORTFOLIO_FIXED_PARTIAL_TERMINAL_OUTCOME_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-fixed-partial-terminal-outcome.v1" as const
export const REPLAY_PORTFOLIO_FIXED_PARTIAL_TERMINAL_POLICY_VERSION =
  "certified-lane-result-shared-wallet-fixed-partial-resize-v1" as const
export const REPLAY_PORTFOLIO_FIXED_PARTIAL_COLLATERAL_POLICY_VERSION =
  "original-isolated-collateral-reserved-until-full-flat-v1" as const

export const REPLAY_PORTFOLIO_FIXED_PARTIAL_TERMINAL_LIMITATIONS = [
  "one_simultaneous_initial_allocation_cycle_no_reentry",
  "zero_or_one_predeclared_fixed_quantity_partial_reduce_per_lane",
  "partial_order_requires_full_fill_and_nonzero_remaining_position",
  "generation_one_terminal_and_exact_liquidation_precede_same-boundary-partial",
  "generation_two_bracket_preserves_triggers_and_uses_absolute_remaining_quantity",
  "original_isolated_collateral_reserved_until_full_flat",
  "historical_admission_risk_retained_and_current_active_stop_risk_resized",
  "no_dynamic_sizing_repeat_partial_post_partial_mutation_reentry_cross_margin_borrow_real_liquidity_or_fast",
] as const

export type ReplayPortfolioFixedPartialTerminalOwner = "not_opened" | "initial_protective_stop"
  | "initial_take_profit" | "generation_two_protective_stop" | "generation_two_take_profit"
  | "exact_liquidation" | "strategy_exit" | "open_at_data_end"
export type ReplayPortfolioFixedPartialStatus = "not_configured" | "not_opened"
  | "terminal_before_partial" | "filled_then_terminal" | "filled_open_at_data_end"

export interface ReplayPortfolioFixedPartialCashflowEvent {
  event_key: ReplayEventKey
  source_ref: string
  kind: "entry_fee" | "funding" | "realized_pnl" | "trading_fee" | "liquidation_fee"
  amount: number
  cashflow_hash: string
}

export interface ReplayPortfolioFixedPartialTerminalRecord {
  record_hash: string
  lane_id: string
  symbol: string
  priority_rank: number
  request_hash: string
  allocation_decision_hash: string
  source_protective_terminal_record_hash: string
  lane_result_hash: string | null
  lane_artifact_manifest_hash: string | null
  entry_fill_hash: string | null
  entry_time: string | null
  side: "long" | "short"
  entry_price: number
  initial_quantity: number
  isolated_collateral: number
  entry_fee: number
  stop_price: number
  target_price: number
  partial_status: ReplayPortfolioFixedPartialStatus
  partial_intent_hash: string | null
  partial_fill_hash: string | null
  partial_time: string | null
  partial_quantity: number
  partial_price: number | null
  partial_realized_pnl: number
  partial_trading_fee: number
  generation_two_quantity: number | null
  owner: ReplayPortfolioFixedPartialTerminalOwner
  terminal_time: string | null
  terminal_phase: 15 | 20 | null
  terminal_source_hash: string | null
  realized_pnl_total: number
  trading_fee_total: number
  liquidation_fee: number
  funding_cashflow_total: number
  cashflow_events: ReplayPortfolioFixedPartialCashflowEvent[]
  released_collateral: number
  ending_open: boolean
  ending_quantity: number
  ending_mark_price: number | null
  ending_mark_notional: number
  ending_unrealized_pnl: number
  admission_frozen_stop_risk_amount: number
  current_active_stop_risk_amount: number
  reserved_admission_risk_amount: number
  risk_budget_release_amount: number
}

export interface ReplayPortfolioFixedPartialTerminalEvidence {
  schema_version: typeof REPLAY_PORTFOLIO_FIXED_PARTIAL_TERMINAL_EVIDENCE_SCHEMA_VERSION
  policy_version: typeof REPLAY_PORTFOLIO_FIXED_PARTIAL_TERMINAL_POLICY_VERSION
  collateral_policy_version: typeof REPLAY_PORTFOLIO_FIXED_PARTIAL_COLLATERAL_POLICY_VERSION
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  portfolio_id: string
  settlement_asset: string
  shared_initial_cash: number
  source_protective_terminal_evidence_hash: string
  source_protective_terminal_artifact_manifest_hash: string
  risk_result_hash: string
  lane_records: ReplayPortfolioFixedPartialTerminalRecord[]
  lane_records_hash: string
  lane_result_hashes: string[]
  ending_settled_cash: number
  ending_reserved_isolated_collateral: number
  ending_available_cash: number
  ending_unrealized_pnl: number
  ending_portfolio_nav: number
  ending_gross_mark_exposure: number
  ending_net_mark_exposure: number
  historical_admission_frozen_stop_risk: number
  ending_portfolio_frozen_stop_risk: number
  ending_portfolio_active_stop_bounded_risk: number
  total_risk_budget_released: number
  terminal_owner_counts: Record<ReplayPortfolioFixedPartialTerminalOwner, number>
  limitations: typeof REPLAY_PORTFOLIO_FIXED_PARTIAL_TERMINAL_LIMITATIONS
  fingerprint: {
    source_hash: string
    lane_records_hash: string
    lane_result_hashes_hash: string
    economic_summary_hash: string
    risk_summary_hash: string
    limitations_hash: string
    fingerprint_hash: string
  }
  evidence_hash: string
}

export const REPLAY_PORTFOLIO_FIXED_PARTIAL_TERMINAL_ARTIFACT_ROLES = [
  "source_protective_terminal_artifact_manifest", "source_protective_terminal_evidence",
  "lane_result_artifact_manifests", "lane_results", "fixed_partial_terminal_records",
  "fixed_partial_terminal_fingerprint", "fixed_partial_terminal_evidence",
] as const
export type ReplayPortfolioFixedPartialTerminalArtifactRole =
  typeof REPLAY_PORTFOLIO_FIXED_PARTIAL_TERMINAL_ARTIFACT_ROLES[number]

export interface ReplayPortfolioFixedPartialTerminalArtifactManifest {
  schema_version: typeof REPLAY_PORTFOLIO_FIXED_PARTIAL_TERMINAL_ARTIFACT_MANIFEST_SCHEMA_VERSION
  artifact_id: string
  portfolio_id: string
  evidence_hash: string
  fingerprint_hash: string
  source_protective_terminal_evidence_hash: string
  files: Array<{ role: ReplayPortfolioFixedPartialTerminalArtifactRole; name: string; ref: string; sha256: string }>
  completeness: {
    authoritative_result: true
    required_roles: typeof REPLAY_PORTFOLIO_FIXED_PARTIAL_TERMINAL_ARTIFACT_ROLES
    commit_marker: "portfolio-fixed-partial-terminal-artifact-manifest.json"
    partial_payload_without_manifest_is_authoritative: false
  }
  authority_frozen_at: string
  manifest_hash: string
}

export interface ReplayPortfolioFixedPartialTerminalOutcome {
  schema_version: typeof REPLAY_PORTFOLIO_FIXED_PARTIAL_TERMINAL_OUTCOME_SCHEMA_VERSION
  portfolio_id: string
  status: "completed" | "failed"
  evidence: ReplayPortfolioFixedPartialTerminalEvidence | null
  artifact_manifest: ReplayPortfolioFixedPartialTerminalArtifactManifest | null
  lane_results: Array<{ lane_id: string; result: ReplayResult; artifact_manifest: ReplayArtifactManifest }> | null
  idempotent_replay: boolean
  failure: { code: "source-terminal-failed" | "lane-replay-failed" | "partial-terminal-engine-failed"
    | "partial-terminal-artifact-failed"; message: string; partial_result_published: false } | null
  outcome_hash: string
}

export const replayPortfolioFixedPartialCashflowHash = (value: ReplayPortfolioFixedPartialCashflowEvent
  | Omit<ReplayPortfolioFixedPartialCashflowEvent, "cashflow_hash">): string => stripHash(value, "cashflow_hash")
export const replayPortfolioFixedPartialTerminalRecordHash = (value: ReplayPortfolioFixedPartialTerminalRecord
  | Omit<ReplayPortfolioFixedPartialTerminalRecord, "record_hash">): string => stripHash(value, "record_hash")
export const replayPortfolioFixedPartialTerminalEvidenceHash = (value: ReplayPortfolioFixedPartialTerminalEvidence
  | Omit<ReplayPortfolioFixedPartialTerminalEvidence, "evidence_hash">): string => stripHash(value, "evidence_hash")
export const replayPortfolioFixedPartialTerminalArtifactManifestHash =
  (value: ReplayPortfolioFixedPartialTerminalArtifactManifest
    | Omit<ReplayPortfolioFixedPartialTerminalArtifactManifest, "manifest_hash">): string => stripHash(value, "manifest_hash")
export const replayPortfolioFixedPartialTerminalOutcomeHash = (value: ReplayPortfolioFixedPartialTerminalOutcome
  | Omit<ReplayPortfolioFixedPartialTerminalOutcome, "outcome_hash">): string => stripHash(value, "outcome_hash")

export function assertReplayPortfolioFixedPartialTerminalEvidence(
  value: ReplayPortfolioFixedPartialTerminalEvidence,
): void {
  if (value.schema_version !== REPLAY_PORTFOLIO_FIXED_PARTIAL_TERMINAL_EVIDENCE_SCHEMA_VERSION
      || value.policy_version !== REPLAY_PORTFOLIO_FIXED_PARTIAL_TERMINAL_POLICY_VERSION
      || value.collateral_policy_version !== REPLAY_PORTFOLIO_FIXED_PARTIAL_COLLATERAL_POLICY_VERSION
      || !value.experiment_id || !value.trial_group_id || !value.portfolio_id || !value.settlement_asset
      || JSON.stringify(value.limitations) !== JSON.stringify(REPLAY_PORTFOLIO_FIXED_PARTIAL_TERMINAL_LIMITATIONS)) fail("identity")
  const laneIds = value.lane_records.map((record) => record.lane_id)
  if (new Set(laneIds).size !== laneIds.length || JSON.stringify(laneIds) !== JSON.stringify([...laneIds].sort())
      || value.lane_records_hash !== canonicalHash(value.lane_records)
      || value.lane_result_hashes.length !== new Set(value.lane_result_hashes).size) fail("lane collection")
  for (const record of value.lane_records) {
    const filled = record.partial_status === "filled_then_terminal"
      || record.partial_status === "filled_open_at_data_end"
    if (record.record_hash !== replayPortfolioFixedPartialTerminalRecordHash(record)
        || record.cashflow_events.some((event) => event.cashflow_hash !== replayPortfolioFixedPartialCashflowHash(event))
        || record.ending_open !== (record.owner === "open_at_data_end")
        || record.ending_open !== (record.ending_quantity > 0)
        || filled !== (record.partial_fill_hash !== null && record.partial_time !== null
          && record.partial_quantity > 0 && record.partial_price !== null && record.generation_two_quantity !== null)
        || filled && record.generation_two_quantity !== addReplayDecimalValues(
          record.initial_quantity, -record.partial_quantity)
        || filled && record.generation_two_quantity !== record.ending_quantity && record.ending_open
        || record.ending_open && record.released_collateral !== 0
        || !record.ending_open && record.reserved_admission_risk_amount !== 0
        || record.ending_open && record.reserved_admission_risk_amount !== record.admission_frozen_stop_risk_amount
        || record.owner === "not_opened" !== (record.partial_status === "not_opened")) fail("record semantics")
  }
  const economics = economicSummary(value.lane_records, value.shared_initial_cash)
  const risk = riskSummary(value.lane_records)
  if (canonicalHash(economics) !== value.fingerprint.economic_summary_hash
      || canonicalHash(risk) !== value.fingerprint.risk_summary_hash
      || Object.entries(economics).some(([key, item]) => value[key as keyof typeof value] !== item)
      || Object.entries(risk).some(([key, item]) => value[key as keyof typeof value] !== item)
      || value.fingerprint.source_hash !== canonicalHash({
        evidence: value.source_protective_terminal_evidence_hash,
        manifest: value.source_protective_terminal_artifact_manifest_hash,
        risk: value.risk_result_hash,
      })
      || value.fingerprint.lane_records_hash !== value.lane_records_hash
      || value.fingerprint.lane_result_hashes_hash !== canonicalHash(value.lane_result_hashes)
      || value.fingerprint.limitations_hash !== canonicalHash(value.limitations)
      || value.fingerprint.fingerprint_hash !== stripHash(value.fingerprint, "fingerprint_hash")
      || value.evidence_hash !== replayPortfolioFixedPartialTerminalEvidenceHash(value)) fail("aggregate/fingerprint")
}

export function assertReplayPortfolioFixedPartialTerminalArtifactManifest(
  value: ReplayPortfolioFixedPartialTerminalArtifactManifest,
): void {
  if (value.schema_version !== REPLAY_PORTFOLIO_FIXED_PARTIAL_TERMINAL_ARTIFACT_MANIFEST_SCHEMA_VERSION
      || JSON.stringify(value.files.map((file) => file.role))
        !== JSON.stringify(REPLAY_PORTFOLIO_FIXED_PARTIAL_TERMINAL_ARTIFACT_ROLES)
      || JSON.stringify(value.completeness.required_roles)
        !== JSON.stringify(REPLAY_PORTFOLIO_FIXED_PARTIAL_TERMINAL_ARTIFACT_ROLES)
      || value.completeness.authoritative_result !== true
      || value.completeness.commit_marker !== "portfolio-fixed-partial-terminal-artifact-manifest.json"
      || value.completeness.partial_payload_without_manifest_is_authoritative !== false
      || value.manifest_hash !== replayPortfolioFixedPartialTerminalArtifactManifestHash(value)) fail("manifest")
}

export function assertReplayPortfolioFixedPartialTerminalOutcome(
  value: ReplayPortfolioFixedPartialTerminalOutcome,
): void {
  if (value.status === "completed" !== Boolean(value.evidence && value.artifact_manifest && value.lane_results && !value.failure)
      || value.status === "failed" !== Boolean(!value.evidence && !value.artifact_manifest && !value.lane_results && value.failure)
      || value.outcome_hash !== replayPortfolioFixedPartialTerminalOutcomeHash(value)) fail("outcome")
  if (value.evidence) assertReplayPortfolioFixedPartialTerminalEvidence(value.evidence)
  if (value.artifact_manifest) assertReplayPortfolioFixedPartialTerminalArtifactManifest(value.artifact_manifest)
}

function economicSummary(records: ReplayPortfolioFixedPartialTerminalRecord[], initial: number) {
  const settled = addReplayDecimalValues(initial, ...records.flatMap((record) =>
    record.cashflow_events.map((event) => event.amount)))
  const reserved = addReplayDecimalValues(...records.map((record) => record.ending_open ? record.isolated_collateral : 0))
  const unrealized = addReplayDecimalValues(...records.map((record) => record.ending_unrealized_pnl))
  const notionals = records.filter((record) => record.ending_open).map((record) => ({
    side: record.side, value: record.ending_mark_notional,
  }))
  return { ending_settled_cash: settled, ending_reserved_isolated_collateral: reserved,
    ending_available_cash: addReplayDecimalValues(settled, -reserved), ending_unrealized_pnl: unrealized,
    ending_portfolio_nav: addReplayDecimalValues(settled, unrealized),
    ending_gross_mark_exposure: addReplayDecimalValues(...notionals.map((item) => item.value)),
    ending_net_mark_exposure: addReplayDecimalValues(...notionals.map((item) => item.side === "long" ? item.value : -item.value)) }
}
function riskSummary(records: ReplayPortfolioFixedPartialTerminalRecord[]) {
  return { historical_admission_frozen_stop_risk: addReplayDecimalValues(...records.map((r) => r.admission_frozen_stop_risk_amount)),
    ending_portfolio_frozen_stop_risk: addReplayDecimalValues(...records.map((r) => r.reserved_admission_risk_amount)),
    ending_portfolio_active_stop_bounded_risk: addReplayDecimalValues(...records.map((r) => r.current_active_stop_risk_amount)),
    total_risk_budget_released: addReplayDecimalValues(...records.map((r) => r.risk_budget_release_amount)) }
}
function stripHash(value: unknown, key: string): string {
  const body = { ...(value as Record<string, unknown>) }; delete body[key]; return canonicalHash(body)
}
function fail(area: string): never { throw new Error(`Portfolio fixed-partial terminal ${area} drift`) }
