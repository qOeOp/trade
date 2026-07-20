import { canonicalHash } from "./replay-contracts"
import {
  assertReplayPortfolioProtectiveReplacementAccountingChains,
  assertReplayPortfolioProtectiveReplacementAccountingSource,
  assertReplayPortfolioProtectiveReplacementAccountingTrialBalance,
} from "./replay-portfolio-protective-replacement-contract-validation"
import {
  assertReplayPortfolioProtectiveStopCancelTerminalArtifactManifest,
  assertReplayPortfolioProtectiveStopCancelTerminalEvidence,
  type ReplayPortfolioProtectiveStopCancelTerminalArtifactManifest,
  type ReplayPortfolioProtectiveStopCancelTerminalEvidence,
} from "./replay-portfolio-protective-stop-cancel-terminal-contracts"
import type {
  ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingJournalAccount,
  ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingJournalEntry,
  ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingJournalLeg,
  ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingLedgerEntry,
} from "./replay-portfolio-protective-take-profit-replacement-terminal-accounting-contracts"
import type { ReplayRuntimeSharedWalletRiskResult } from "./replay-runtime-shared-wallet-risk-contracts"

export const REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_ACCOUNTING_EVIDENCE_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-protective-stop-cancel-terminal-accounting-evidence.v1" as const
export const REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_ACCOUNTING_ARTIFACT_MANIFEST_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-protective-stop-cancel-terminal-accounting-artifact-manifest.v1" as const
export const REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_ACCOUNTING_OUTCOME_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-protective-stop-cancel-terminal-accounting-outcome.v1" as const
export const REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_ACCOUNTING_POLICY_VERSION =
  "protective-stop-cancel-risk-degraded-terminal-owner-double-entry-v1" as const
export const REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_ACCOUNTING_LIMITATIONS = [
  "single_initial_allocation_cycle_no_reentry",
  "cancel_aware_winning_terminal_only_preempted_and_post_terminal_funding_excluded",
  "zero_or_one_predeclared_full_position_protective_stop_cancel_target_preserved",
  "cancel_has_no_posting_and_risk_budget_releases_only_on_full_flat",
  "isolated_margin_no_repeat_mutation_partial_cross_margin_borrow_real_liquidity_or_fast",
] as const

export type ReplayPortfolioProtectiveStopCancelTerminalAccountingJournalAccount =
  ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingJournalAccount
export type ReplayPortfolioProtectiveStopCancelTerminalAccountingLedgerEntry =
  ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingLedgerEntry
export type ReplayPortfolioProtectiveStopCancelTerminalAccountingJournalLeg =
  ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingJournalLeg
export type ReplayPortfolioProtectiveStopCancelTerminalAccountingJournalEntry =
  ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingJournalEntry

export interface ReplayPortfolioProtectiveStopCancelTerminalAccountingTrialBalance {
  settlement_asset: string
  accounting_policy_version: typeof REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_ACCOUNTING_POLICY_VERSION
  total_debits: number
  total_credits: number
  balances: Record<ReplayPortfolioProtectiveStopCancelTerminalAccountingJournalAccount, number>
  ending_available_cash: number
  ending_reserved_isolated_collateral: number
  ending_settled_cash: number
  ending_unrealized_pnl: number
  ending_portfolio_nav: number
  balanced: true
  trial_balance_hash: string
}

export interface ReplayPortfolioProtectiveStopCancelTerminalAccountingFingerprint {
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  portfolio_id: string
  cancel_terminal_evidence_hash: string
  cancel_terminal_artifact_manifest_hash: string
  risk_result_hash: string
  ledger_hash: string
  journal_hash: string
  trial_balance_hash: string
  excluded_preempted_source_hashes_hash: string
  excluded_post_terminal_funding_source_hashes_hash: string
  limitations_hash: string
  fingerprint_hash: string
}

export interface ReplayPortfolioProtectiveStopCancelTerminalAccountingEvidence {
  schema_version: typeof REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_ACCOUNTING_EVIDENCE_SCHEMA_VERSION
  accounting_policy_version: typeof REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_ACCOUNTING_POLICY_VERSION
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  portfolio_id: string
  settlement_asset: string
  shared_initial_cash: number
  cancel_terminal_evidence_hash: string
  cancel_terminal_artifact_manifest_hash: string
  risk_result_hash: string
  ledger: ReplayPortfolioProtectiveStopCancelTerminalAccountingLedgerEntry[]
  journal: ReplayPortfolioProtectiveStopCancelTerminalAccountingJournalEntry[]
  trial_balance: ReplayPortfolioProtectiveStopCancelTerminalAccountingTrialBalance
  excluded_preempted_source_hashes: string[]
  excluded_post_terminal_funding_source_hashes: string[]
  limitations: typeof REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_ACCOUNTING_LIMITATIONS
  fingerprint: ReplayPortfolioProtectiveStopCancelTerminalAccountingFingerprint
  evidence_hash: string
}

export const REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_ACCOUNTING_ARTIFACT_ROLES = [
  "cancel_terminal_artifact_manifest", "risk_result", "cancel_terminal_evidence",
  "cancel_terminal_ledger", "cancel_terminal_journal", "cancel_terminal_trial_balance",
  "cancel_terminal_accounting_fingerprint", "cancel_terminal_accounting_evidence",
] as const
export type ReplayPortfolioProtectiveStopCancelTerminalAccountingArtifactRole =
  typeof REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_ACCOUNTING_ARTIFACT_ROLES[number]

export interface ReplayPortfolioProtectiveStopCancelTerminalAccountingArtifactManifest {
  schema_version: typeof REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_ACCOUNTING_ARTIFACT_MANIFEST_SCHEMA_VERSION
  artifact_id: string
  portfolio_id: string
  cancel_terminal_accounting_evidence_hash: string
  cancel_terminal_accounting_fingerprint_hash: string
  cancel_terminal_evidence_hash: string
  files: Array<{ role: ReplayPortfolioProtectiveStopCancelTerminalAccountingArtifactRole; name: string; ref: string; sha256: string }>
  completeness: {
    authoritative_result: true
    required_roles: typeof REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_ACCOUNTING_ARTIFACT_ROLES
    commit_marker: "portfolio-protective-stop-cancel-terminal-accounting-artifact-manifest.json"
    partial_payload_without_manifest_is_authoritative: false
  }
  authority_frozen_at: string
  manifest_hash: string
}

export interface ReplayPortfolioProtectiveStopCancelTerminalAccountingOutcome {
  schema_version: typeof REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_ACCOUNTING_OUTCOME_SCHEMA_VERSION
  portfolio_id: string
  status: "completed" | "failed"
  cancel_terminal_evidence: ReplayPortfolioProtectiveStopCancelTerminalEvidence | null
  evidence: ReplayPortfolioProtectiveStopCancelTerminalAccountingEvidence | null
  artifact_manifest: ReplayPortfolioProtectiveStopCancelTerminalAccountingArtifactManifest | null
  idempotent_replay: boolean
  failure: {
    code: "cancel-terminal-execution-failed" | "cancel-terminal-artifact-read-failed"
      | "cancel-terminal-accounting-invalid" | "cancel-terminal-accounting-artifact-failed"
    message: string
    partial_result_published: false
  } | null
  outcome_hash: string
}

function withoutHash(value: object, key: string): Record<string, unknown> {
  const body = { ...value } as Record<string, unknown>; delete body[key]; return body
}
export const replayPortfolioProtectiveStopCancelTerminalAccountingLedgerEntryHash =
  (value: ReplayPortfolioProtectiveStopCancelTerminalAccountingLedgerEntry): string =>
    canonicalHash(withoutHash(value, "ledger_entry_hash"))
export const replayPortfolioProtectiveStopCancelTerminalAccountingJournalEntryHash =
  (value: ReplayPortfolioProtectiveStopCancelTerminalAccountingJournalEntry): string =>
    canonicalHash(withoutHash(value, "journal_entry_hash"))
export const replayPortfolioProtectiveStopCancelTerminalAccountingTrialBalanceHash =
  (value: ReplayPortfolioProtectiveStopCancelTerminalAccountingTrialBalance | Omit<ReplayPortfolioProtectiveStopCancelTerminalAccountingTrialBalance, "trial_balance_hash">): string =>
    canonicalHash(withoutHash(value as ReplayPortfolioProtectiveStopCancelTerminalAccountingTrialBalance, "trial_balance_hash"))
export const replayPortfolioProtectiveStopCancelTerminalAccountingFingerprintHash =
  (value: ReplayPortfolioProtectiveStopCancelTerminalAccountingFingerprint | Omit<ReplayPortfolioProtectiveStopCancelTerminalAccountingFingerprint, "fingerprint_hash">): string =>
    canonicalHash(withoutHash(value as ReplayPortfolioProtectiveStopCancelTerminalAccountingFingerprint, "fingerprint_hash"))
export const replayPortfolioProtectiveStopCancelTerminalAccountingEvidenceHash =
  (value: ReplayPortfolioProtectiveStopCancelTerminalAccountingEvidence | Omit<ReplayPortfolioProtectiveStopCancelTerminalAccountingEvidence, "evidence_hash">): string =>
    canonicalHash(withoutHash(value as ReplayPortfolioProtectiveStopCancelTerminalAccountingEvidence, "evidence_hash"))
export const replayPortfolioProtectiveStopCancelTerminalAccountingArtifactManifestHash =
  (value: ReplayPortfolioProtectiveStopCancelTerminalAccountingArtifactManifest | Omit<ReplayPortfolioProtectiveStopCancelTerminalAccountingArtifactManifest, "manifest_hash">): string =>
    canonicalHash(withoutHash(value as ReplayPortfolioProtectiveStopCancelTerminalAccountingArtifactManifest, "manifest_hash"))
export const replayPortfolioProtectiveStopCancelTerminalAccountingOutcomeHash =
  (value: ReplayPortfolioProtectiveStopCancelTerminalAccountingOutcome | Omit<ReplayPortfolioProtectiveStopCancelTerminalAccountingOutcome, "outcome_hash">): string =>
    canonicalHash(withoutHash(value as ReplayPortfolioProtectiveStopCancelTerminalAccountingOutcome, "outcome_hash"))

export function assertReplayPortfolioProtectiveStopCancelTerminalAccountingEvidence(
  value: ReplayPortfolioProtectiveStopCancelTerminalAccountingEvidence,
  source?: { cancel_terminal_evidence: ReplayPortfolioProtectiveStopCancelTerminalEvidence; cancel_terminal_manifest: ReplayPortfolioProtectiveStopCancelTerminalArtifactManifest; risk_result: ReplayRuntimeSharedWalletRiskResult },
): void {
  if (value.schema_version !== REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_ACCOUNTING_EVIDENCE_SCHEMA_VERSION
      || value.accounting_policy_version !== REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_ACCOUNTING_POLICY_VERSION
      || !value.experiment_id || !value.trial_group_id || !value.portfolio_id || !value.settlement_asset
      || JSON.stringify(value.limitations) !== JSON.stringify(REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_ACCOUNTING_LIMITATIONS)) fail("identity/policy")
  hashes([value.trial_group_hash, value.cancel_terminal_evidence_hash,
    value.cancel_terminal_artifact_manifest_hash, value.risk_result_hash,
    value.trial_balance.trial_balance_hash, value.fingerprint.fingerprint_hash, value.evidence_hash,
    ...value.excluded_preempted_source_hashes, ...value.excluded_post_terminal_funding_source_hashes])
  assertReplayPortfolioProtectiveReplacementAccountingChains({ value: mappedEvidence(value),
    ledger_hash: (entry) => replayPortfolioProtectiveStopCancelTerminalAccountingLedgerEntryHash(entry as ReplayPortfolioProtectiveStopCancelTerminalAccountingLedgerEntry),
    journal_hash: (entry) => replayPortfolioProtectiveStopCancelTerminalAccountingJournalEntryHash(entry as ReplayPortfolioProtectiveStopCancelTerminalAccountingJournalEntry), fail })
  assertReplayPortfolioProtectiveReplacementAccountingTrialBalance({ balance: value.trial_balance,
    journal: value.journal, policy_version: REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_ACCOUNTING_POLICY_VERSION,
    balance_hash: replayPortfolioProtectiveStopCancelTerminalAccountingTrialBalanceHash(value.trial_balance), fail })
  const fingerprint = value.fingerprint
  if (fingerprint.experiment_id !== value.experiment_id || fingerprint.trial_group_id !== value.trial_group_id
      || fingerprint.trial_group_hash !== value.trial_group_hash || fingerprint.portfolio_id !== value.portfolio_id
      || fingerprint.cancel_terminal_evidence_hash !== value.cancel_terminal_evidence_hash
      || fingerprint.cancel_terminal_artifact_manifest_hash !== value.cancel_terminal_artifact_manifest_hash
      || fingerprint.risk_result_hash !== value.risk_result_hash
      || fingerprint.ledger_hash !== canonicalHash(value.ledger) || fingerprint.journal_hash !== canonicalHash(value.journal)
      || fingerprint.trial_balance_hash !== value.trial_balance.trial_balance_hash
      || fingerprint.excluded_preempted_source_hashes_hash !== canonicalHash(value.excluded_preempted_source_hashes)
      || fingerprint.excluded_post_terminal_funding_source_hashes_hash !== canonicalHash(value.excluded_post_terminal_funding_source_hashes)
      || fingerprint.limitations_hash !== canonicalHash(value.limitations)
      || fingerprint.fingerprint_hash !== replayPortfolioProtectiveStopCancelTerminalAccountingFingerprintHash(fingerprint)
      || value.evidence_hash !== replayPortfolioProtectiveStopCancelTerminalAccountingEvidenceHash(value)) fail("fingerprint/evidence")
  if (source) assertReplayPortfolioProtectiveReplacementAccountingSource({ value: mappedEvidence(value),
    source: { replacement_terminal_evidence: source.cancel_terminal_evidence,
      replacement_terminal_manifest: { ...source.cancel_terminal_manifest,
        replacement_terminal_evidence_hash: source.cancel_terminal_manifest.cancel_terminal_evidence_hash },
      risk_result: source.risk_result },
    assert_terminal_evidence: (candidate) => assertReplayPortfolioProtectiveStopCancelTerminalEvidence(candidate as ReplayPortfolioProtectiveStopCancelTerminalEvidence),
    assert_terminal_manifest: () => assertReplayPortfolioProtectiveStopCancelTerminalArtifactManifest(source.cancel_terminal_manifest), fail })
}

export function assertReplayPortfolioProtectiveStopCancelTerminalAccountingArtifactManifest(
  value: ReplayPortfolioProtectiveStopCancelTerminalAccountingArtifactManifest,
): void {
  if (value.schema_version !== REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_ACCOUNTING_ARTIFACT_MANIFEST_SCHEMA_VERSION
      || !value.artifact_id || !value.portfolio_id
      || JSON.stringify(value.files.map((file) => file.role)) !== JSON.stringify(REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_ACCOUNTING_ARTIFACT_ROLES)
      || JSON.stringify(value.completeness.required_roles) !== JSON.stringify(REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_ACCOUNTING_ARTIFACT_ROLES)
      || value.completeness.authoritative_result !== true
      || value.completeness.commit_marker !== "portfolio-protective-stop-cancel-terminal-accounting-artifact-manifest.json"
      || value.completeness.partial_payload_without_manifest_is_authoritative !== false
      || !utc(value.authority_frozen_at)
      || value.manifest_hash !== replayPortfolioProtectiveStopCancelTerminalAccountingArtifactManifestHash(value)) fail("artifact manifest")
  hashes([value.cancel_terminal_accounting_evidence_hash, value.cancel_terminal_accounting_fingerprint_hash,
    value.cancel_terminal_evidence_hash, ...value.files.map((file) => file.sha256)])
}

export function assertReplayPortfolioProtectiveStopCancelTerminalAccountingOutcome(
  value: ReplayPortfolioProtectiveStopCancelTerminalAccountingOutcome,
): void {
  const completed = value.cancel_terminal_evidence !== null && value.evidence !== null
    && value.artifact_manifest !== null && value.failure === null
  const failed = value.cancel_terminal_evidence === null && value.evidence === null
    && value.artifact_manifest === null && value.failure !== null
  if (value.schema_version !== REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_ACCOUNTING_OUTCOME_SCHEMA_VERSION
      || !value.portfolio_id || (value.status === "completed") !== completed || (value.status === "failed") !== failed
      || value.failure !== null && value.failure.partial_result_published !== false
      || value.outcome_hash !== replayPortfolioProtectiveStopCancelTerminalAccountingOutcomeHash(value)) fail("outcome")
  if (value.evidence) assertReplayPortfolioProtectiveStopCancelTerminalAccountingEvidence(value.evidence)
  if (value.artifact_manifest) assertReplayPortfolioProtectiveStopCancelTerminalAccountingArtifactManifest(value.artifact_manifest)
}

function mappedEvidence(value: ReplayPortfolioProtectiveStopCancelTerminalAccountingEvidence) {
  return { ...value, replacement_terminal_evidence_hash: value.cancel_terminal_evidence_hash,
    replacement_terminal_artifact_manifest_hash: value.cancel_terminal_artifact_manifest_hash }
}
function utc(value: string): boolean { return value.endsWith("Z") && Number.isFinite(Date.parse(value)) }
function hashes(values: string[]): void { if (values.some((value) => !/^[a-f0-9]{64}$/.test(value))) fail("hash") }
function fail(scope: string): never { throw new Error(`Portfolio Protective Stop Cancel Terminal Accounting ${scope} invalid`) }
