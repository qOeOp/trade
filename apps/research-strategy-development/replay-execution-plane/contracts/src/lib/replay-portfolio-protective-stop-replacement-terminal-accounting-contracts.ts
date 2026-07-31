import { canonicalHash } from "./replay-contracts"
import type {
  ReplayPortfolioProtectiveTerminalAccountingCashflowKind,
  ReplayPortfolioProtectiveTerminalAccountingJournalAccount,
} from "./replay-portfolio-protective-terminal-accounting-contracts"
import {
  assertReplayPortfolioProtectiveStopReplacementTerminalArtifactManifest,
  assertReplayPortfolioProtectiveStopReplacementTerminalEvidence,
  type ReplayPortfolioProtectiveStopReplacementTerminalArtifactManifest,
  type ReplayPortfolioProtectiveStopReplacementTerminalEvidence,
  type ReplayPortfolioProtectiveStopReplacementTerminalOwner,
} from "./replay-portfolio-protective-stop-replacement-terminal-contracts"
import type { ReplayRuntimeSharedWalletRiskResult } from "./replay-runtime-shared-wallet-risk-contracts"
import {
  assertReplayPortfolioProtectiveReplacementAccountingChains,
  assertReplayPortfolioProtectiveReplacementAccountingSource,
  assertReplayPortfolioProtectiveReplacementAccountingTrialBalance,
} from "./replay-portfolio-protective-replacement-contract-validation"

export const REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_ACCOUNTING_EVIDENCE_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-protective-stop-replacement-terminal-accounting-evidence.v1" as const
export const REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_ACCOUNTING_ARTIFACT_MANIFEST_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-protective-stop-replacement-terminal-accounting-artifact-manifest.v1" as const
export const REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_ACCOUNTING_OUTCOME_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-protective-stop-replacement-terminal-accounting-outcome.v1" as const
export const REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_ACCOUNTING_POLICY_VERSION =
  "replacement-terminal-owner-double-entry-v1" as const

export const REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_ACCOUNTING_LIMITATIONS = [
  "single_initial_allocation_cycle_no_reentry",
  "winning_replacement_aware_terminal_only_preempted_and_post_terminal_funding_excluded",
  "zero_or_one_predeclared_tighten_only_full_position_stop_replacement",
  "isolated_margin_no_cross_margin_borrow_real_liquidity_or_fast",
] as const

export type ReplayPortfolioProtectiveStopReplacementTerminalAccountingCashflowKind =
  ReplayPortfolioProtectiveTerminalAccountingCashflowKind
export type ReplayPortfolioProtectiveStopReplacementTerminalAccountingJournalAccount =
  ReplayPortfolioProtectiveTerminalAccountingJournalAccount

export interface ReplayPortfolioProtectiveStopReplacementTerminalAccountingLedgerEntry {
  ledger_sequence: number
  accounting_ordinal: number
  event_time: string
  boundary_phase: 10 | 15 | 20
  source_event_hash: string
  terminal_record_hash: string
  lane_id: string
  symbol: string
  terminal_owner: ReplayPortfolioProtectiveStopReplacementTerminalOwner
  cashflow_kind: ReplayPortfolioProtectiveStopReplacementTerminalAccountingCashflowKind
  amount: number
  settled_cash_after: number
  ledger_entry_hash: string
}

export interface ReplayPortfolioProtectiveStopReplacementTerminalAccountingJournalLeg {
  account: ReplayPortfolioProtectiveStopReplacementTerminalAccountingJournalAccount
  debit: number
  credit: number
}

export interface ReplayPortfolioProtectiveStopReplacementTerminalAccountingJournalEntry {
  journal_sequence: number
  accounting_ordinal: number | null
  event_time: string
  boundary_phase: 10 | 15 | 20 | null
  source_event_hash: string | null
  terminal_record_hash: string | null
  lane_id: string | null
  terminal_owner: ReplayPortfolioProtectiveStopReplacementTerminalOwner | null
  posting_kind:
    | "opening_cash"
    | "collateral_reserve"
    | "collateral_release"
    | ReplayPortfolioProtectiveStopReplacementTerminalAccountingCashflowKind
    | "terminal_mark_to_market"
  legs: [ReplayPortfolioProtectiveStopReplacementTerminalAccountingJournalLeg,
    ReplayPortfolioProtectiveStopReplacementTerminalAccountingJournalLeg]
  journal_entry_hash: string
}

export interface ReplayPortfolioProtectiveStopReplacementTerminalAccountingTrialBalance {
  settlement_asset: string
  accounting_policy_version:
    typeof REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_ACCOUNTING_POLICY_VERSION
  total_debits: number
  total_credits: number
  balances: Record<ReplayPortfolioProtectiveStopReplacementTerminalAccountingJournalAccount, number>
  ending_available_cash: number
  ending_reserved_isolated_collateral: number
  ending_settled_cash: number
  ending_unrealized_pnl: number
  ending_portfolio_nav: number
  balanced: true
  trial_balance_hash: string
}

export interface ReplayPortfolioProtectiveStopReplacementTerminalAccountingFingerprint {
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

export interface ReplayPortfolioProtectiveStopReplacementTerminalAccountingEvidence {
  schema_version:
    typeof REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_ACCOUNTING_EVIDENCE_SCHEMA_VERSION
  accounting_policy_version:
    typeof REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_ACCOUNTING_POLICY_VERSION
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  portfolio_id: string
  settlement_asset: string
  shared_initial_cash: number
  replacement_terminal_evidence_hash: string
  replacement_terminal_artifact_manifest_hash: string
  risk_result_hash: string
  ledger: ReplayPortfolioProtectiveStopReplacementTerminalAccountingLedgerEntry[]
  journal: ReplayPortfolioProtectiveStopReplacementTerminalAccountingJournalEntry[]
  trial_balance: ReplayPortfolioProtectiveStopReplacementTerminalAccountingTrialBalance
  excluded_preempted_source_hashes: string[]
  excluded_post_terminal_funding_source_hashes: string[]
  limitations: typeof REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_ACCOUNTING_LIMITATIONS
  fingerprint: ReplayPortfolioProtectiveStopReplacementTerminalAccountingFingerprint
  evidence_hash: string
}

export const REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_ACCOUNTING_ARTIFACT_ROLES = [
  "replacement_terminal_artifact_manifest",
  "risk_result",
  "replacement_terminal_evidence",
  "replacement_terminal_ledger",
  "replacement_terminal_journal",
  "replacement_terminal_trial_balance",
  "replacement_terminal_accounting_fingerprint",
  "replacement_terminal_accounting_evidence",
] as const
export type ReplayPortfolioProtectiveStopReplacementTerminalAccountingArtifactRole =
  typeof REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_ACCOUNTING_ARTIFACT_ROLES[number]

export interface ReplayPortfolioProtectiveStopReplacementTerminalAccountingArtifactManifest {
  schema_version:
    typeof REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_ACCOUNTING_ARTIFACT_MANIFEST_SCHEMA_VERSION
  artifact_id: string
  portfolio_id: string
  replacement_terminal_accounting_evidence_hash: string
  replacement_terminal_accounting_fingerprint_hash: string
  replacement_terminal_evidence_hash: string
  files: Array<{
    role: ReplayPortfolioProtectiveStopReplacementTerminalAccountingArtifactRole
    name: string
    ref: string
    sha256: string
  }>
  completeness: {
    authoritative_result: true
    required_roles: typeof REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_ACCOUNTING_ARTIFACT_ROLES
    commit_marker: "portfolio-protective-stop-replacement-terminal-accounting-artifact-manifest.json"
    partial_payload_without_manifest_is_authoritative: false
  }
  authority_frozen_at: string
  manifest_hash: string
}

export interface ReplayPortfolioProtectiveStopReplacementTerminalAccountingOutcome {
  schema_version:
    typeof REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_ACCOUNTING_OUTCOME_SCHEMA_VERSION
  portfolio_id: string
  status: "completed" | "failed"
  replacement_terminal_evidence: ReplayPortfolioProtectiveStopReplacementTerminalEvidence | null
  evidence: ReplayPortfolioProtectiveStopReplacementTerminalAccountingEvidence | null
  artifact_manifest: ReplayPortfolioProtectiveStopReplacementTerminalAccountingArtifactManifest | null
  idempotent_replay: boolean
  failure: {
    code: "replacement-terminal-execution-failed" | "replacement-terminal-artifact-read-failed"
      | "replacement-terminal-accounting-invalid" | "replacement-terminal-accounting-artifact-failed"
    message: string
    partial_result_published: false
  } | null
  outcome_hash: string
}

export function replayPortfolioProtectiveStopReplacementTerminalAccountingLedgerEntryHash(
  value: ReplayPortfolioProtectiveStopReplacementTerminalAccountingLedgerEntry
    | Omit<ReplayPortfolioProtectiveStopReplacementTerminalAccountingLedgerEntry, "ledger_entry_hash">,
): string {
  const { ledger_entry_hash: _hash, ...body } =
    value as ReplayPortfolioProtectiveStopReplacementTerminalAccountingLedgerEntry
  return canonicalHash(body)
}

export function replayPortfolioProtectiveStopReplacementTerminalAccountingJournalEntryHash(
  value: ReplayPortfolioProtectiveStopReplacementTerminalAccountingJournalEntry
    | Omit<ReplayPortfolioProtectiveStopReplacementTerminalAccountingJournalEntry, "journal_entry_hash">,
): string {
  const { journal_entry_hash: _hash, ...body } =
    value as ReplayPortfolioProtectiveStopReplacementTerminalAccountingJournalEntry
  return canonicalHash(body)
}

export function replayPortfolioProtectiveStopReplacementTerminalAccountingTrialBalanceHash(
  value: ReplayPortfolioProtectiveStopReplacementTerminalAccountingTrialBalance
    | Omit<ReplayPortfolioProtectiveStopReplacementTerminalAccountingTrialBalance, "trial_balance_hash">,
): string {
  const { trial_balance_hash: _hash, ...body } =
    value as ReplayPortfolioProtectiveStopReplacementTerminalAccountingTrialBalance
  return canonicalHash(body)
}

export function replayPortfolioProtectiveStopReplacementTerminalAccountingFingerprintHash(
  value: ReplayPortfolioProtectiveStopReplacementTerminalAccountingFingerprint
    | Omit<ReplayPortfolioProtectiveStopReplacementTerminalAccountingFingerprint, "fingerprint_hash">,
): string {
  const { fingerprint_hash: _hash, ...body } =
    value as ReplayPortfolioProtectiveStopReplacementTerminalAccountingFingerprint
  return canonicalHash(body)
}

export function replayPortfolioProtectiveStopReplacementTerminalAccountingEvidenceHash(
  value: ReplayPortfolioProtectiveStopReplacementTerminalAccountingEvidence
    | Omit<ReplayPortfolioProtectiveStopReplacementTerminalAccountingEvidence, "evidence_hash">,
): string {
  const { evidence_hash: _hash, ...body } =
    value as ReplayPortfolioProtectiveStopReplacementTerminalAccountingEvidence
  return canonicalHash(body)
}

export function replayPortfolioProtectiveStopReplacementTerminalAccountingArtifactManifestHash(
  value: ReplayPortfolioProtectiveStopReplacementTerminalAccountingArtifactManifest
    | Omit<ReplayPortfolioProtectiveStopReplacementTerminalAccountingArtifactManifest, "manifest_hash">,
): string {
  const { manifest_hash: _hash, ...body } =
    value as ReplayPortfolioProtectiveStopReplacementTerminalAccountingArtifactManifest
  return canonicalHash(body)
}

export function replayPortfolioProtectiveStopReplacementTerminalAccountingOutcomeHash(
  value: ReplayPortfolioProtectiveStopReplacementTerminalAccountingOutcome
    | Omit<ReplayPortfolioProtectiveStopReplacementTerminalAccountingOutcome, "outcome_hash">,
): string {
  const { outcome_hash: _hash, ...body } =
    value as ReplayPortfolioProtectiveStopReplacementTerminalAccountingOutcome
  return canonicalHash(body)
}

export function assertReplayPortfolioProtectiveStopReplacementTerminalAccountingEvidence(
  value: ReplayPortfolioProtectiveStopReplacementTerminalAccountingEvidence,
  source?: {
    replacement_terminal_evidence: ReplayPortfolioProtectiveStopReplacementTerminalEvidence
    replacement_terminal_manifest: ReplayPortfolioProtectiveStopReplacementTerminalArtifactManifest
    risk_result: ReplayRuntimeSharedWalletRiskResult
  },
): void {
  if (value.schema_version
      !== REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_ACCOUNTING_EVIDENCE_SCHEMA_VERSION
      || value.accounting_policy_version
        !== REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_ACCOUNTING_POLICY_VERSION
      || !value.experiment_id || !value.trial_group_id || !value.portfolio_id || !value.settlement_asset
      || JSON.stringify(value.limitations)
        !== JSON.stringify(REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_ACCOUNTING_LIMITATIONS)) fail("identity/policy")
  hashes([value.trial_group_hash, value.replacement_terminal_evidence_hash,
    value.replacement_terminal_artifact_manifest_hash, value.risk_result_hash,
    value.trial_balance.trial_balance_hash, value.fingerprint.fingerprint_hash, value.evidence_hash,
    ...value.excluded_preempted_source_hashes, ...value.excluded_post_terminal_funding_source_hashes])
  if (!sortedUnique(value.excluded_preempted_source_hashes)
      || !sortedUnique(value.excluded_post_terminal_funding_source_hashes)) fail("exclusions")
  assertReplayPortfolioProtectiveReplacementAccountingChains({
    value,
    ledger_hash: (entry) => replayPortfolioProtectiveStopReplacementTerminalAccountingLedgerEntryHash(
      entry as ReplayPortfolioProtectiveStopReplacementTerminalAccountingLedgerEntry,
    ),
    journal_hash: (entry) => replayPortfolioProtectiveStopReplacementTerminalAccountingJournalEntryHash(
      entry as ReplayPortfolioProtectiveStopReplacementTerminalAccountingJournalEntry,
    ),
    fail,
  })
  assertReplayPortfolioProtectiveReplacementAccountingTrialBalance({
    balance: value.trial_balance,
    journal: value.journal,
    policy_version: REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_ACCOUNTING_POLICY_VERSION,
    balance_hash: replayPortfolioProtectiveStopReplacementTerminalAccountingTrialBalanceHash(value.trial_balance),
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
        !== replayPortfolioProtectiveStopReplacementTerminalAccountingFingerprintHash(fingerprint)) fail("fingerprint")
  if (value.evidence_hash
      !== replayPortfolioProtectiveStopReplacementTerminalAccountingEvidenceHash(value)) fail("evidence hash")
  if (source) assertReplayPortfolioProtectiveReplacementAccountingSource({
    value,
    source,
    assert_terminal_evidence: (evidence) => assertReplayPortfolioProtectiveStopReplacementTerminalEvidence(
      evidence as ReplayPortfolioProtectiveStopReplacementTerminalEvidence,
    ),
    assert_terminal_manifest: (manifest) => assertReplayPortfolioProtectiveStopReplacementTerminalArtifactManifest(
      manifest as ReplayPortfolioProtectiveStopReplacementTerminalArtifactManifest,
    ),
    fail,
  })
}

export function assertReplayPortfolioProtectiveStopReplacementTerminalAccountingArtifactManifest(
  value: ReplayPortfolioProtectiveStopReplacementTerminalAccountingArtifactManifest,
): void {
  if (value.schema_version
      !== REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_ACCOUNTING_ARTIFACT_MANIFEST_SCHEMA_VERSION
      || !value.artifact_id || !value.portfolio_id
      || value.files.length
        !== REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_ACCOUNTING_ARTIFACT_ROLES.length
      || JSON.stringify(value.files.map((file) => file.role))
        !== JSON.stringify(REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_ACCOUNTING_ARTIFACT_ROLES)
      || value.completeness.authoritative_result !== true
      || value.completeness.commit_marker
        !== "portfolio-protective-stop-replacement-terminal-accounting-artifact-manifest.json"
      || value.completeness.partial_payload_without_manifest_is_authoritative !== false
      || JSON.stringify(value.completeness.required_roles)
        !== JSON.stringify(REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_ACCOUNTING_ARTIFACT_ROLES)
      || !timestamp(value.authority_frozen_at)
      || value.manifest_hash
        !== replayPortfolioProtectiveStopReplacementTerminalAccountingArtifactManifestHash(value)) fail("artifact manifest")
  hashes([value.replacement_terminal_accounting_evidence_hash,
    value.replacement_terminal_accounting_fingerprint_hash, value.replacement_terminal_evidence_hash,
    ...value.files.map((file) => file.sha256)])
}

export function assertReplayPortfolioProtectiveStopReplacementTerminalAccountingOutcome(
  value: ReplayPortfolioProtectiveStopReplacementTerminalAccountingOutcome,
): void {
  if (value.schema_version
      !== REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_ACCOUNTING_OUTCOME_SCHEMA_VERSION
      || !value.portfolio_id
      || value.status === "completed" !== (value.replacement_terminal_evidence !== null
        && value.evidence !== null && value.artifact_manifest !== null && value.failure === null)
      || value.status === "failed" !== (value.replacement_terminal_evidence === null
        && value.evidence === null && value.artifact_manifest === null && value.failure !== null)
      || value.failure && value.failure.partial_result_published !== false
      || value.outcome_hash
        !== replayPortfolioProtectiveStopReplacementTerminalAccountingOutcomeHash(value)) fail("outcome")
  if (value.evidence) assertReplayPortfolioProtectiveStopReplacementTerminalAccountingEvidence(value.evidence)
  if (value.artifact_manifest) {
    assertReplayPortfolioProtectiveStopReplacementTerminalAccountingArtifactManifest(value.artifact_manifest)
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
  throw new Error(`Portfolio Protective Stop Replacement Terminal Accounting ${scope} invalid`)
}
