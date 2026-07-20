import { canonicalHash } from "./replay-contracts"
import {
  assertReplayPortfolioProtectiveReplacementAccountingChains,
  assertReplayPortfolioProtectiveReplacementAccountingSource,
  assertReplayPortfolioProtectiveReplacementAccountingTrialBalance,
} from "./replay-portfolio-protective-replacement-contract-validation"
import {
  assertReplayPortfolioProtectiveTakeProfitCancelTerminalArtifactManifest,
  assertReplayPortfolioProtectiveTakeProfitCancelTerminalEvidence,
  type ReplayPortfolioProtectiveTakeProfitCancelTerminalArtifactManifest,
  type ReplayPortfolioProtectiveTakeProfitCancelTerminalEvidence,
} from "./replay-portfolio-protective-take-profit-cancel-terminal-contracts"
import type {
  ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingJournalAccount,
  ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingJournalEntry,
  ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingJournalLeg,
  ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingLedgerEntry,
} from "./replay-portfolio-protective-take-profit-replacement-terminal-accounting-contracts"
import type { ReplayRuntimeSharedWalletRiskResult } from "./replay-runtime-shared-wallet-risk-contracts"

export const REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_CANCEL_TERMINAL_ACCOUNTING_EVIDENCE_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-protective-take-profit-cancel-terminal-accounting-evidence.v1" as const
export const REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_CANCEL_TERMINAL_ACCOUNTING_ARTIFACT_MANIFEST_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-protective-take-profit-cancel-terminal-accounting-artifact-manifest.v1" as const
export const REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_CANCEL_TERMINAL_ACCOUNTING_OUTCOME_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-protective-take-profit-cancel-terminal-accounting-outcome.v1" as const
export const REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_CANCEL_TERMINAL_ACCOUNTING_POLICY_VERSION =
  "take-profit-cancel-stop-preserved-terminal-owner-double-entry-v1" as const
export const REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_CANCEL_TERMINAL_ACCOUNTING_LIMITATIONS = [
  "single_initial_allocation_cycle_no_reentry",
  "cancel_aware_winning_terminal_only_preempted_and_post_terminal_funding_excluded",
  "zero_or_one_predeclared_full_position_take_profit_cancel_stop_preserved",
  "isolated_margin_no_stop_cancel_partial_cross_margin_borrow_real_liquidity_or_fast",
] as const

export type ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingJournalAccount =
  ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingJournalAccount
export type ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingLedgerEntry =
  ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingLedgerEntry
export type ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingJournalLeg =
  ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingJournalLeg
export type ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingJournalEntry =
  ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingJournalEntry

export interface ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingTrialBalance {
  settlement_asset: string
  accounting_policy_version: typeof REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_CANCEL_TERMINAL_ACCOUNTING_POLICY_VERSION
  total_debits: number
  total_credits: number
  balances: Record<ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingJournalAccount, number>
  ending_available_cash: number
  ending_reserved_isolated_collateral: number
  ending_settled_cash: number
  ending_unrealized_pnl: number
  ending_portfolio_nav: number
  balanced: true
  trial_balance_hash: string
}

export interface ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingFingerprint {
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

export interface ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingEvidence {
  schema_version: typeof REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_CANCEL_TERMINAL_ACCOUNTING_EVIDENCE_SCHEMA_VERSION
  accounting_policy_version: typeof REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_CANCEL_TERMINAL_ACCOUNTING_POLICY_VERSION
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  portfolio_id: string
  settlement_asset: string
  shared_initial_cash: number
  cancel_terminal_evidence_hash: string
  cancel_terminal_artifact_manifest_hash: string
  risk_result_hash: string
  ledger: ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingLedgerEntry[]
  journal: ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingJournalEntry[]
  trial_balance: ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingTrialBalance
  excluded_preempted_source_hashes: string[]
  excluded_post_terminal_funding_source_hashes: string[]
  limitations: typeof REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_CANCEL_TERMINAL_ACCOUNTING_LIMITATIONS
  fingerprint: ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingFingerprint
  evidence_hash: string
}

export const REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_CANCEL_TERMINAL_ACCOUNTING_ARTIFACT_ROLES = [
  "cancel_terminal_artifact_manifest", "risk_result", "cancel_terminal_evidence",
  "cancel_terminal_ledger", "cancel_terminal_journal", "cancel_terminal_trial_balance",
  "cancel_terminal_accounting_fingerprint", "cancel_terminal_accounting_evidence",
] as const
export type ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingArtifactRole =
  typeof REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_CANCEL_TERMINAL_ACCOUNTING_ARTIFACT_ROLES[number]

export interface ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingArtifactManifest {
  schema_version: typeof REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_CANCEL_TERMINAL_ACCOUNTING_ARTIFACT_MANIFEST_SCHEMA_VERSION
  artifact_id: string
  portfolio_id: string
  cancel_terminal_accounting_evidence_hash: string
  cancel_terminal_accounting_fingerprint_hash: string
  cancel_terminal_evidence_hash: string
  files: Array<{ role: ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingArtifactRole; name: string; ref: string; sha256: string }>
  completeness: {
    authoritative_result: true
    required_roles: typeof REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_CANCEL_TERMINAL_ACCOUNTING_ARTIFACT_ROLES
    commit_marker: "portfolio-protective-take-profit-cancel-terminal-accounting-artifact-manifest.json"
    partial_payload_without_manifest_is_authoritative: false
  }
  authority_frozen_at: string
  manifest_hash: string
}

export interface ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingOutcome {
  schema_version: typeof REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_CANCEL_TERMINAL_ACCOUNTING_OUTCOME_SCHEMA_VERSION
  portfolio_id: string
  status: "completed" | "failed"
  cancel_terminal_evidence: ReplayPortfolioProtectiveTakeProfitCancelTerminalEvidence | null
  evidence: ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingEvidence | null
  artifact_manifest: ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingArtifactManifest | null
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
export const replayPortfolioProtectiveTakeProfitCancelTerminalAccountingLedgerEntryHash =
  (value: ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingLedgerEntry): string =>
    canonicalHash(withoutHash(value, "ledger_entry_hash"))
export const replayPortfolioProtectiveTakeProfitCancelTerminalAccountingJournalEntryHash =
  (value: ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingJournalEntry): string =>
    canonicalHash(withoutHash(value, "journal_entry_hash"))
export const replayPortfolioProtectiveTakeProfitCancelTerminalAccountingTrialBalanceHash =
  (value: ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingTrialBalance | Omit<ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingTrialBalance, "trial_balance_hash">): string =>
    canonicalHash(withoutHash(value as ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingTrialBalance, "trial_balance_hash"))
export const replayPortfolioProtectiveTakeProfitCancelTerminalAccountingFingerprintHash =
  (value: ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingFingerprint | Omit<ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingFingerprint, "fingerprint_hash">): string =>
    canonicalHash(withoutHash(value as ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingFingerprint, "fingerprint_hash"))
export const replayPortfolioProtectiveTakeProfitCancelTerminalAccountingEvidenceHash =
  (value: ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingEvidence | Omit<ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingEvidence, "evidence_hash">): string =>
    canonicalHash(withoutHash(value as ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingEvidence, "evidence_hash"))
export const replayPortfolioProtectiveTakeProfitCancelTerminalAccountingArtifactManifestHash =
  (value: ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingArtifactManifest | Omit<ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingArtifactManifest, "manifest_hash">): string =>
    canonicalHash(withoutHash(value as ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingArtifactManifest, "manifest_hash"))
export const replayPortfolioProtectiveTakeProfitCancelTerminalAccountingOutcomeHash =
  (value: ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingOutcome | Omit<ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingOutcome, "outcome_hash">): string =>
    canonicalHash(withoutHash(value as ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingOutcome, "outcome_hash"))

export function assertReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingEvidence(
  value: ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingEvidence,
  source?: { cancel_terminal_evidence: ReplayPortfolioProtectiveTakeProfitCancelTerminalEvidence; cancel_terminal_manifest: ReplayPortfolioProtectiveTakeProfitCancelTerminalArtifactManifest; risk_result: ReplayRuntimeSharedWalletRiskResult },
): void {
  if (value.schema_version !== REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_CANCEL_TERMINAL_ACCOUNTING_EVIDENCE_SCHEMA_VERSION
      || value.accounting_policy_version !== REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_CANCEL_TERMINAL_ACCOUNTING_POLICY_VERSION
      || !value.experiment_id || !value.trial_group_id || !value.portfolio_id || !value.settlement_asset
      || JSON.stringify(value.limitations) !== JSON.stringify(REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_CANCEL_TERMINAL_ACCOUNTING_LIMITATIONS)) fail("identity/policy")
  hashes([value.trial_group_hash, value.cancel_terminal_evidence_hash,
    value.cancel_terminal_artifact_manifest_hash, value.risk_result_hash,
    value.trial_balance.trial_balance_hash, value.fingerprint.fingerprint_hash, value.evidence_hash,
    ...value.excluded_preempted_source_hashes, ...value.excluded_post_terminal_funding_source_hashes])
  assertReplayPortfolioProtectiveReplacementAccountingChains({ value: mappedEvidence(value),
    ledger_hash: (entry) => replayPortfolioProtectiveTakeProfitCancelTerminalAccountingLedgerEntryHash(entry as ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingLedgerEntry),
    journal_hash: (entry) => replayPortfolioProtectiveTakeProfitCancelTerminalAccountingJournalEntryHash(entry as ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingJournalEntry), fail })
  assertReplayPortfolioProtectiveReplacementAccountingTrialBalance({ balance: value.trial_balance,
    journal: value.journal, policy_version: REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_CANCEL_TERMINAL_ACCOUNTING_POLICY_VERSION,
    balance_hash: replayPortfolioProtectiveTakeProfitCancelTerminalAccountingTrialBalanceHash(value.trial_balance), fail })
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
      || fingerprint.fingerprint_hash !== replayPortfolioProtectiveTakeProfitCancelTerminalAccountingFingerprintHash(fingerprint)
      || value.evidence_hash !== replayPortfolioProtectiveTakeProfitCancelTerminalAccountingEvidenceHash(value)) fail("fingerprint/evidence")
  if (source) assertReplayPortfolioProtectiveReplacementAccountingSource({ value: mappedEvidence(value),
    source: { replacement_terminal_evidence: source.cancel_terminal_evidence,
      replacement_terminal_manifest: { ...source.cancel_terminal_manifest,
        replacement_terminal_evidence_hash: source.cancel_terminal_manifest.cancel_terminal_evidence_hash },
      risk_result: source.risk_result },
    assert_terminal_evidence: (candidate) => assertReplayPortfolioProtectiveTakeProfitCancelTerminalEvidence(candidate as ReplayPortfolioProtectiveTakeProfitCancelTerminalEvidence),
    assert_terminal_manifest: () => assertReplayPortfolioProtectiveTakeProfitCancelTerminalArtifactManifest(source.cancel_terminal_manifest), fail })
}

export function assertReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingArtifactManifest(
  value: ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingArtifactManifest,
): void {
  if (value.schema_version !== REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_CANCEL_TERMINAL_ACCOUNTING_ARTIFACT_MANIFEST_SCHEMA_VERSION
      || !value.artifact_id || !value.portfolio_id
      || JSON.stringify(value.files.map((file) => file.role)) !== JSON.stringify(REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_CANCEL_TERMINAL_ACCOUNTING_ARTIFACT_ROLES)
      || JSON.stringify(value.completeness.required_roles) !== JSON.stringify(REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_CANCEL_TERMINAL_ACCOUNTING_ARTIFACT_ROLES)
      || value.completeness.authoritative_result !== true
      || value.completeness.commit_marker !== "portfolio-protective-take-profit-cancel-terminal-accounting-artifact-manifest.json"
      || value.completeness.partial_payload_without_manifest_is_authoritative !== false
      || !utc(value.authority_frozen_at)
      || value.manifest_hash !== replayPortfolioProtectiveTakeProfitCancelTerminalAccountingArtifactManifestHash(value)) fail("artifact manifest")
  hashes([value.cancel_terminal_accounting_evidence_hash, value.cancel_terminal_accounting_fingerprint_hash,
    value.cancel_terminal_evidence_hash, ...value.files.map((file) => file.sha256)])
}

export function assertReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingOutcome(
  value: ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingOutcome,
): void {
  const completed = value.cancel_terminal_evidence !== null && value.evidence !== null
    && value.artifact_manifest !== null && value.failure === null
  const failed = value.cancel_terminal_evidence === null && value.evidence === null
    && value.artifact_manifest === null && value.failure !== null
  if (value.schema_version !== REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_CANCEL_TERMINAL_ACCOUNTING_OUTCOME_SCHEMA_VERSION
      || !value.portfolio_id || (value.status === "completed") !== completed || (value.status === "failed") !== failed
      || value.failure !== null && value.failure.partial_result_published !== false
      || value.outcome_hash !== replayPortfolioProtectiveTakeProfitCancelTerminalAccountingOutcomeHash(value)) fail("outcome")
  if (value.evidence) assertReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingEvidence(value.evidence)
  if (value.artifact_manifest) assertReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingArtifactManifest(value.artifact_manifest)
}

function mappedEvidence(value: ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingEvidence) {
  return { ...value, replacement_terminal_evidence_hash: value.cancel_terminal_evidence_hash,
    replacement_terminal_artifact_manifest_hash: value.cancel_terminal_artifact_manifest_hash }
}
function utc(value: string): boolean { return value.endsWith("Z") && Number.isFinite(Date.parse(value)) }
function hashes(values: string[]): void { if (values.some((value) => !/^[a-f0-9]{64}$/.test(value))) fail("hash") }
function fail(scope: string): never { throw new Error(`Portfolio Protective Take Profit Cancel Terminal Accounting ${scope} invalid`) }
