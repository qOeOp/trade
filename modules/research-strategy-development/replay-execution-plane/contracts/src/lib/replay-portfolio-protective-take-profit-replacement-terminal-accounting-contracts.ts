import { canonicalHash } from "./replay-contracts"
import type {
  ReplayPortfolioProtectiveTerminalAccountingCashflowKind,
  ReplayPortfolioProtectiveTerminalAccountingJournalAccount,
} from "./replay-portfolio-protective-terminal-accounting-contracts"
import {
  assertReplayPortfolioProtectiveTakeProfitReplacementTerminalArtifactManifest,
  assertReplayPortfolioProtectiveTakeProfitReplacementTerminalEvidence,
  type ReplayPortfolioProtectiveTakeProfitReplacementTerminalArtifactManifest,
  type ReplayPortfolioProtectiveTakeProfitReplacementTerminalEvidence,
  type ReplayPortfolioProtectiveTakeProfitReplacementTerminalOwner,
} from "./replay-portfolio-protective-take-profit-replacement-terminal-contracts"
import type { ReplayRuntimeSharedWalletRiskResult } from "./replay-runtime-shared-wallet-risk-contracts"
import {
  assertReplayPortfolioProtectiveReplacementAccountingChains,
  assertReplayPortfolioProtectiveReplacementAccountingSource,
  assertReplayPortfolioProtectiveReplacementAccountingTrialBalance,
} from "./replay-portfolio-protective-replacement-contract-validation"

export const REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_ACCOUNTING_EVIDENCE_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-protective-take-profit-replacement-terminal-accounting-evidence.v1" as const
export const REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_ACCOUNTING_ARTIFACT_MANIFEST_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-protective-take-profit-replacement-terminal-accounting-artifact-manifest.v1" as const
export const REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_ACCOUNTING_OUTCOME_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-protective-take-profit-replacement-terminal-accounting-outcome.v1" as const
export const REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_ACCOUNTING_POLICY_VERSION =
  "take-profit-replacement-terminal-owner-double-entry-v1" as const

export const REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_ACCOUNTING_LIMITATIONS = [
  "single_initial_allocation_cycle_no_reentry",
  "winning_replacement_aware_terminal_only_preempted_and_post_terminal_funding_excluded",
  "zero_or_one_predeclared_full_position_take_profit_replacement",
  "isolated_margin_no_cross_margin_borrow_real_liquidity_or_fast",
] as const

export type ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingCashflowKind =
  ReplayPortfolioProtectiveTerminalAccountingCashflowKind
export type ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingJournalAccount =
  ReplayPortfolioProtectiveTerminalAccountingJournalAccount

export interface ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingLedgerEntry {
  ledger_sequence: number
  accounting_ordinal: number
  event_time: string
  boundary_phase: 10 | 15 | 20
  source_event_hash: string
  terminal_record_hash: string
  lane_id: string
  symbol: string
  terminal_owner: ReplayPortfolioProtectiveTakeProfitReplacementTerminalOwner
  cashflow_kind: ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingCashflowKind
  amount: number
  settled_cash_after: number
  ledger_entry_hash: string
}

export interface ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingJournalLeg {
  account: ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingJournalAccount
  debit: number
  credit: number
}

export interface ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingJournalEntry {
  journal_sequence: number
  accounting_ordinal: number | null
  event_time: string
  boundary_phase: 10 | 15 | 20 | null
  source_event_hash: string | null
  terminal_record_hash: string | null
  lane_id: string | null
  terminal_owner: ReplayPortfolioProtectiveTakeProfitReplacementTerminalOwner | null
  posting_kind:
    | "opening_cash"
    | "collateral_reserve"
    | "collateral_release"
    | ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingCashflowKind
    | "terminal_mark_to_market"
  legs: [ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingJournalLeg,
    ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingJournalLeg]
  journal_entry_hash: string
}

export interface ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingTrialBalance {
  settlement_asset: string
  accounting_policy_version:
    typeof REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_ACCOUNTING_POLICY_VERSION
  total_debits: number
  total_credits: number
  balances: Record<ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingJournalAccount, number>
  ending_available_cash: number
  ending_reserved_isolated_collateral: number
  ending_settled_cash: number
  ending_unrealized_pnl: number
  ending_portfolio_nav: number
  balanced: true
  trial_balance_hash: string
}

export interface ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingFingerprint {
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  portfolio_id: string
  replacement_terminal_evidence_hash: string
  replacement_terminal_artifact_manifest_hash: string
  risk_result_hash: string
  ledger_hash: string
  journal_hash: string
  trial_balance_hash: string
  excluded_preempted_source_hashes_hash: string
  excluded_post_terminal_funding_source_hashes_hash: string
  limitations_hash: string
  fingerprint_hash: string
}

export interface ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingEvidence {
  schema_version:
    typeof REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_ACCOUNTING_EVIDENCE_SCHEMA_VERSION
  accounting_policy_version:
    typeof REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_ACCOUNTING_POLICY_VERSION
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  portfolio_id: string
  settlement_asset: string
  shared_initial_cash: number
  replacement_terminal_evidence_hash: string
  replacement_terminal_artifact_manifest_hash: string
  risk_result_hash: string
  ledger: ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingLedgerEntry[]
  journal: ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingJournalEntry[]
  trial_balance: ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingTrialBalance
  excluded_preempted_source_hashes: string[]
  excluded_post_terminal_funding_source_hashes: string[]
  limitations: typeof REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_ACCOUNTING_LIMITATIONS
  fingerprint: ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingFingerprint
  evidence_hash: string
}

export const REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_ACCOUNTING_ARTIFACT_ROLES = [
  "replacement_terminal_artifact_manifest",
  "risk_result",
  "replacement_terminal_evidence",
  "replacement_terminal_ledger",
  "replacement_terminal_journal",
  "replacement_terminal_trial_balance",
  "replacement_terminal_accounting_fingerprint",
  "replacement_terminal_accounting_evidence",
] as const
export type ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingArtifactRole =
  typeof REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_ACCOUNTING_ARTIFACT_ROLES[number]

export interface ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingArtifactManifest {
  schema_version:
    typeof REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_ACCOUNTING_ARTIFACT_MANIFEST_SCHEMA_VERSION
  artifact_id: string
  portfolio_id: string
  replacement_terminal_accounting_evidence_hash: string
  replacement_terminal_accounting_fingerprint_hash: string
  replacement_terminal_evidence_hash: string
  files: Array<{
    role: ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingArtifactRole
    name: string
    ref: string
    sha256: string
  }>
  completeness: {
    authoritative_result: true
    required_roles: typeof REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_ACCOUNTING_ARTIFACT_ROLES
    commit_marker: "portfolio-protective-take-profit-replacement-terminal-accounting-artifact-manifest.json"
    partial_payload_without_manifest_is_authoritative: false
  }
  authority_frozen_at: string
  manifest_hash: string
}

export interface ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingOutcome {
  schema_version:
    typeof REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_ACCOUNTING_OUTCOME_SCHEMA_VERSION
  portfolio_id: string
  status: "completed" | "failed"
  replacement_terminal_evidence: ReplayPortfolioProtectiveTakeProfitReplacementTerminalEvidence | null
  evidence: ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingEvidence | null
  artifact_manifest: ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingArtifactManifest | null
  idempotent_replay: boolean
  failure: {
    code: "replacement-terminal-execution-failed" | "replacement-terminal-artifact-read-failed"
      | "replacement-terminal-accounting-invalid" | "replacement-terminal-accounting-artifact-failed"
    message: string
    partial_result_published: false
  } | null
  outcome_hash: string
}

export function replayPortfolioProtectiveTakeProfitReplacementTerminalAccountingLedgerEntryHash(
  value: ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingLedgerEntry
    | Omit<ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingLedgerEntry, "ledger_entry_hash">,
): string {
  const { ledger_entry_hash: _hash, ...body } =
    value as ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingLedgerEntry
  return canonicalHash(body)
}

export function replayPortfolioProtectiveTakeProfitReplacementTerminalAccountingJournalEntryHash(
  value: ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingJournalEntry
    | Omit<ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingJournalEntry, "journal_entry_hash">,
): string {
  const { journal_entry_hash: _hash, ...body } =
    value as ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingJournalEntry
  return canonicalHash(body)
}

export function replayPortfolioProtectiveTakeProfitReplacementTerminalAccountingTrialBalanceHash(
  value: ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingTrialBalance
    | Omit<ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingTrialBalance, "trial_balance_hash">,
): string {
  const { trial_balance_hash: _hash, ...body } =
    value as ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingTrialBalance
  return canonicalHash(body)
}

export function replayPortfolioProtectiveTakeProfitReplacementTerminalAccountingFingerprintHash(
  value: ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingFingerprint
    | Omit<ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingFingerprint, "fingerprint_hash">,
): string {
  const { fingerprint_hash: _hash, ...body } =
    value as ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingFingerprint
  return canonicalHash(body)
}

export function replayPortfolioProtectiveTakeProfitReplacementTerminalAccountingEvidenceHash(
  value: ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingEvidence
    | Omit<ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingEvidence, "evidence_hash">,
): string {
  const { evidence_hash: _hash, ...body } =
    value as ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingEvidence
  return canonicalHash(body)
}

export function replayPortfolioProtectiveTakeProfitReplacementTerminalAccountingArtifactManifestHash(
  value: ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingArtifactManifest
    | Omit<ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingArtifactManifest, "manifest_hash">,
): string {
  const { manifest_hash: _hash, ...body } =
    value as ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingArtifactManifest
  return canonicalHash(body)
}

export function replayPortfolioProtectiveTakeProfitReplacementTerminalAccountingOutcomeHash(
  value: ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingOutcome
    | Omit<ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingOutcome, "outcome_hash">,
): string {
  const { outcome_hash: _hash, ...body } =
    value as ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingOutcome
  return canonicalHash(body)
}

export function assertReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingEvidence(
  value: ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingEvidence,
  source?: {
    replacement_terminal_evidence: ReplayPortfolioProtectiveTakeProfitReplacementTerminalEvidence
    replacement_terminal_manifest: ReplayPortfolioProtectiveTakeProfitReplacementTerminalArtifactManifest
    risk_result: ReplayRuntimeSharedWalletRiskResult
  },
): void {
  if (value.schema_version
      !== REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_ACCOUNTING_EVIDENCE_SCHEMA_VERSION
      || value.accounting_policy_version
        !== REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_ACCOUNTING_POLICY_VERSION
      || !value.experiment_id || !value.trial_group_id || !value.portfolio_id || !value.settlement_asset
      || JSON.stringify(value.limitations)
        !== JSON.stringify(REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_ACCOUNTING_LIMITATIONS)) fail("identity/policy")
  hashes([value.trial_group_hash, value.replacement_terminal_evidence_hash,
    value.replacement_terminal_artifact_manifest_hash, value.risk_result_hash,
    value.trial_balance.trial_balance_hash, value.fingerprint.fingerprint_hash, value.evidence_hash,
    ...value.excluded_preempted_source_hashes, ...value.excluded_post_terminal_funding_source_hashes])
  if (!sortedUnique(value.excluded_preempted_source_hashes)
      || !sortedUnique(value.excluded_post_terminal_funding_source_hashes)) fail("exclusions")
  assertReplayPortfolioProtectiveReplacementAccountingChains({
    value,
    ledger_hash: (entry) => replayPortfolioProtectiveTakeProfitReplacementTerminalAccountingLedgerEntryHash(
      entry as ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingLedgerEntry,
    ),
    journal_hash: (entry) => replayPortfolioProtectiveTakeProfitReplacementTerminalAccountingJournalEntryHash(
      entry as ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingJournalEntry,
    ),
    fail,
  })
  assertReplayPortfolioProtectiveReplacementAccountingTrialBalance({
    balance: value.trial_balance,
    journal: value.journal,
    policy_version: REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_ACCOUNTING_POLICY_VERSION,
    balance_hash:
      replayPortfolioProtectiveTakeProfitReplacementTerminalAccountingTrialBalanceHash(value.trial_balance),
    fail,
  })
  const fingerprint = value.fingerprint
  if (fingerprint.experiment_id !== value.experiment_id || fingerprint.trial_group_id !== value.trial_group_id
      || fingerprint.trial_group_hash !== value.trial_group_hash || fingerprint.portfolio_id !== value.portfolio_id
      || fingerprint.replacement_terminal_evidence_hash !== value.replacement_terminal_evidence_hash
      || fingerprint.replacement_terminal_artifact_manifest_hash
        !== value.replacement_terminal_artifact_manifest_hash
      || fingerprint.risk_result_hash !== value.risk_result_hash
      || fingerprint.ledger_hash !== canonicalHash(value.ledger)
      || fingerprint.journal_hash !== canonicalHash(value.journal)
      || fingerprint.trial_balance_hash !== value.trial_balance.trial_balance_hash
      || fingerprint.excluded_preempted_source_hashes_hash
        !== canonicalHash(value.excluded_preempted_source_hashes)
      || fingerprint.excluded_post_terminal_funding_source_hashes_hash
        !== canonicalHash(value.excluded_post_terminal_funding_source_hashes)
      || fingerprint.limitations_hash !== canonicalHash(value.limitations)
      || fingerprint.fingerprint_hash
        !== replayPortfolioProtectiveTakeProfitReplacementTerminalAccountingFingerprintHash(fingerprint)) fail("fingerprint")
  if (value.evidence_hash
      !== replayPortfolioProtectiveTakeProfitReplacementTerminalAccountingEvidenceHash(value)) fail("evidence hash")
  if (source) assertReplayPortfolioProtectiveReplacementAccountingSource({
    value,
    source,
    assert_terminal_evidence: (evidence) =>
      assertReplayPortfolioProtectiveTakeProfitReplacementTerminalEvidence(
        evidence as ReplayPortfolioProtectiveTakeProfitReplacementTerminalEvidence,
      ),
    assert_terminal_manifest: (manifest) =>
      assertReplayPortfolioProtectiveTakeProfitReplacementTerminalArtifactManifest(
        manifest as ReplayPortfolioProtectiveTakeProfitReplacementTerminalArtifactManifest,
      ),
    fail,
  })
}

export function assertReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingArtifactManifest(
  value: ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingArtifactManifest,
): void {
  if (value.schema_version
      !== REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_ACCOUNTING_ARTIFACT_MANIFEST_SCHEMA_VERSION
      || !value.artifact_id || !value.portfolio_id
      || value.files.length
        !== REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_ACCOUNTING_ARTIFACT_ROLES.length
      || JSON.stringify(value.files.map((file) => file.role))
        !== JSON.stringify(REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_ACCOUNTING_ARTIFACT_ROLES)
      || value.completeness.authoritative_result !== true
      || value.completeness.commit_marker
        !== "portfolio-protective-take-profit-replacement-terminal-accounting-artifact-manifest.json"
      || value.completeness.partial_payload_without_manifest_is_authoritative !== false
      || JSON.stringify(value.completeness.required_roles)
        !== JSON.stringify(REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_ACCOUNTING_ARTIFACT_ROLES)
      || !timestamp(value.authority_frozen_at)
      || value.manifest_hash
        !== replayPortfolioProtectiveTakeProfitReplacementTerminalAccountingArtifactManifestHash(value)) fail("artifact manifest")
  hashes([value.replacement_terminal_accounting_evidence_hash,
    value.replacement_terminal_accounting_fingerprint_hash, value.replacement_terminal_evidence_hash,
    ...value.files.map((file) => file.sha256)])
}

export function assertReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingOutcome(
  value: ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingOutcome,
): void {
  if (value.schema_version
      !== REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_ACCOUNTING_OUTCOME_SCHEMA_VERSION
      || !value.portfolio_id
      || value.status === "completed" !== (value.replacement_terminal_evidence !== null
        && value.evidence !== null && value.artifact_manifest !== null && value.failure === null)
      || value.status === "failed" !== (value.replacement_terminal_evidence === null
        && value.evidence === null && value.artifact_manifest === null && value.failure !== null)
      || value.failure && value.failure.partial_result_published !== false
      || value.outcome_hash
        !== replayPortfolioProtectiveTakeProfitReplacementTerminalAccountingOutcomeHash(value)) fail("outcome")
  if (value.evidence) assertReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingEvidence(value.evidence)
  if (value.artifact_manifest) {
    assertReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingArtifactManifest(value.artifact_manifest)
  }
}

function sortedUnique(values: string[]): boolean {
  return new Set(values).size === values.length
    && JSON.stringify(values) === JSON.stringify([...values].sort())
}

function timestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value)) && value.endsWith("Z")
}

function hashes(values: string[]): void {
  if (values.some((value) => !/^[a-f0-9]{64}$/.test(value))) fail("hash")
}

function fail(scope: string): never {
  throw new Error(`Portfolio Protective Take Profit Replacement Terminal Accounting ${scope} invalid`)
}
