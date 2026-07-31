import { canonicalHash } from "./replay-contracts"
import {
  assertReplayPortfolioProtectiveTerminalCycleSequenceArtifactManifest,
  assertReplayPortfolioProtectiveTerminalCycleSequenceResult,
  replayPortfolioProtectiveTerminalCycleCommitHash,
  type ReplayPortfolioProtectiveTerminalCycleCommit,
  type ReplayPortfolioProtectiveTerminalCycleSequenceArtifactManifest,
  type ReplayPortfolioProtectiveTerminalCycleSequenceResult,
} from "./replay-portfolio-protective-terminal-cycle-sequence-contracts"
import {
  REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ACCOUNTING_POLICY_VERSION,
  assertReplayPortfolioProtectiveTerminalAccountingArtifactManifest,
  assertReplayPortfolioProtectiveTerminalAccountingEvidence,
  replayPortfolioProtectiveTerminalAccountingJournalEntryHash,
  replayPortfolioProtectiveTerminalAccountingLedgerEntryHash,
  type ReplayPortfolioProtectiveTerminalAccountingArtifactManifest,
  type ReplayPortfolioProtectiveTerminalAccountingEvidence,
  type ReplayPortfolioProtectiveTerminalAccountingJournalAccount,
  type ReplayPortfolioProtectiveTerminalAccountingJournalEntry,
  type ReplayPortfolioProtectiveTerminalAccountingLedgerEntry,
} from "./replay-portfolio-protective-terminal-accounting-contracts"
import { addReplayDecimalValues } from "./replay-decimal"

export const REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_ACCOUNTING_EVIDENCE_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-protective-terminal-cycle-sequence-accounting-evidence.v1" as const
export const REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_ACCOUNTING_ARTIFACT_MANIFEST_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-protective-terminal-cycle-sequence-accounting-artifact-manifest.v1" as const
export const REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_ACCOUNTING_OUTCOME_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-protective-terminal-cycle-sequence-accounting-outcome.v1" as const
export const REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_JOURNAL_POLICY_VERSION =
  "protective-terminal-cycle-opening-equity-once-roll-forward-v1" as const

export const REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_ACCOUNTING_LIMITATIONS = [
  "full_flat_protective_terminal_cycle_boundaries_with_one_sequence_opening_equity",
  "cycle_local_p16_entries_and_hashes_preserved_without_reclassification",
  "preempted_terminal_and_post_terminal_funding_exclusions_remain_cycle_local_p16_authority",
  "no_open_position_roll_forward_stop_mutation_partial_reentry_cross_margin_borrow_real_liquidity_or_fast",
] as const

export interface ReplayPortfolioProtectiveTerminalCycleSequenceLedgerEntry {
  sequence_entry_hash: string
  global_ledger_sequence: number
  cycle_index: number
  cycle_ledger_entry_hash: string
  cycle_entry: ReplayPortfolioProtectiveTerminalAccountingLedgerEntry
}

export interface ReplayPortfolioProtectiveTerminalCycleSequenceJournalEntry {
  sequence_entry_hash: string
  global_journal_sequence: number
  cycle_index: number
  cycle_journal_entry_hash: string
  cycle_entry: ReplayPortfolioProtectiveTerminalAccountingJournalEntry
}

export interface ReplayPortfolioProtectiveTerminalCycleSequenceTrialBalance {
  settlement_asset: string
  journal_policy_version: typeof REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_JOURNAL_POLICY_VERSION
  source_cycle_accounting_policy_version: typeof REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ACCOUNTING_POLICY_VERSION
  total_debits: number
  total_credits: number
  balances: Record<ReplayPortfolioProtectiveTerminalAccountingJournalAccount, number>
  opening_equity_posting_count: 1
  initial_cash: number
  ending_available_cash: number
  ending_reserved_isolated_collateral: 0
  ending_settled_cash: number
  ending_unrealized_pnl: 0
  ending_portfolio_nav: number
  balanced: true
  trial_balance_hash: string
}

export interface ReplayPortfolioProtectiveTerminalCycleSequenceAccountingFingerprint {
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  portfolio_id: string
  sequence_plan_hash: string
  sequence_reservation_hash: string
  sequence_result_hash: string
  sequence_artifact_manifest_hash: string
  cycle_commits_hash: string
  cycle_accounting_evidence_hashes: string[]
  cycle_accounting_artifact_manifest_hashes: string[]
  consolidated_ledger_hash: string
  consolidated_journal_hash: string
  consolidated_trial_balance_hash: string
  limitations_hash: string
  fingerprint_hash: string
}

export interface ReplayPortfolioProtectiveTerminalCycleSequenceAccountingEvidence {
  schema_version:
    typeof REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_ACCOUNTING_EVIDENCE_SCHEMA_VERSION
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  portfolio_id: string
  sequence_plan_hash: string
  sequence_reservation_hash: string
  sequence_result_hash: string
  sequence_artifact_manifest_hash: string
  settlement_asset: string
  cycle_count: number
  cycle_commits: ReplayPortfolioProtectiveTerminalCycleCommit[]
  cycle_accounting_evidence_hashes: string[]
  cycle_accounting_artifact_manifest_hashes: string[]
  consolidated_ledger: ReplayPortfolioProtectiveTerminalCycleSequenceLedgerEntry[]
  consolidated_journal: ReplayPortfolioProtectiveTerminalCycleSequenceJournalEntry[]
  consolidated_trial_balance: ReplayPortfolioProtectiveTerminalCycleSequenceTrialBalance
  fingerprint: ReplayPortfolioProtectiveTerminalCycleSequenceAccountingFingerprint
  limitations: typeof REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_ACCOUNTING_LIMITATIONS
  evidence_hash: string
}

export const REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_ACCOUNTING_ARTIFACT_ROLES = [
  "protective_terminal_cycle_sequence_result",
  "protective_terminal_cycle_sequence_artifact_manifest",
  "cycle_protective_terminal_accounting_artifact_manifests",
  "cycle_protective_terminal_accounting_evidence",
  "consolidated_ledger",
  "consolidated_journal",
  "consolidated_trial_balance",
  "consolidated_accounting_fingerprint",
  "consolidated_accounting_evidence",
] as const
export type ReplayPortfolioProtectiveTerminalCycleSequenceAccountingArtifactRole =
  typeof REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_ACCOUNTING_ARTIFACT_ROLES[number]

export interface ReplayPortfolioProtectiveTerminalCycleSequenceAccountingArtifactManifest {
  schema_version:
    typeof REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_ACCOUNTING_ARTIFACT_MANIFEST_SCHEMA_VERSION
  artifact_id: string
  portfolio_id: string
  accounting_evidence_hash: string
  accounting_fingerprint_hash: string
  sequence_result_hash: string
  files: Array<{
    role: ReplayPortfolioProtectiveTerminalCycleSequenceAccountingArtifactRole
    name: string
    ref: string
    sha256: string
  }>
  completeness: {
    authoritative_result: true
    required_roles: typeof REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_ACCOUNTING_ARTIFACT_ROLES
    commit_marker: "portfolio-protective-terminal-cycle-sequence-accounting-artifact-manifest.json"
    partial_payload_without_manifest_is_authoritative: false
  }
  authority_frozen_at: string
  manifest_hash: string
}

export interface ReplayPortfolioProtectiveTerminalCycleSequenceAccountingOutcome {
  schema_version:
    typeof REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_ACCOUNTING_OUTCOME_SCHEMA_VERSION
  portfolio_id: string
  sequence_plan_hash: string
  status: "completed" | "failed"
  sequence_result: ReplayPortfolioProtectiveTerminalCycleSequenceResult | null
  evidence: ReplayPortfolioProtectiveTerminalCycleSequenceAccountingEvidence | null
  artifact_manifest: ReplayPortfolioProtectiveTerminalCycleSequenceAccountingArtifactManifest | null
  idempotent_replay: boolean
  failure: {
    code: "protective-cycle-sequence-execution-failed" | "protective-cycle-sequence-artifact-read-failed"
      | "protective-cycle-accounting-artifact-read-failed" | "protective-cycle-sequence-accounting-invalid"
      | "protective-cycle-sequence-accounting-artifact-failed"
    message: string
    partial_accounting_result_published: false
  } | null
  outcome_hash: string
}

export function replayPortfolioProtectiveTerminalCycleSequenceLedgerEntryHash(
  value: ReplayPortfolioProtectiveTerminalCycleSequenceLedgerEntry
    | Omit<ReplayPortfolioProtectiveTerminalCycleSequenceLedgerEntry, "sequence_entry_hash">,
): string {
  const { sequence_entry_hash: _hash, ...body } = value as ReplayPortfolioProtectiveTerminalCycleSequenceLedgerEntry
  return canonicalHash(body)
}

export function replayPortfolioProtectiveTerminalCycleSequenceJournalEntryHash(
  value: ReplayPortfolioProtectiveTerminalCycleSequenceJournalEntry
    | Omit<ReplayPortfolioProtectiveTerminalCycleSequenceJournalEntry, "sequence_entry_hash">,
): string {
  const { sequence_entry_hash: _hash, ...body } = value as ReplayPortfolioProtectiveTerminalCycleSequenceJournalEntry
  return canonicalHash(body)
}

export function replayPortfolioProtectiveTerminalCycleSequenceTrialBalanceHash(
  value: ReplayPortfolioProtectiveTerminalCycleSequenceTrialBalance
    | Omit<ReplayPortfolioProtectiveTerminalCycleSequenceTrialBalance, "trial_balance_hash">,
): string {
  const { trial_balance_hash: _hash, ...body } = value as ReplayPortfolioProtectiveTerminalCycleSequenceTrialBalance
  return canonicalHash(body)
}

export function replayPortfolioProtectiveTerminalCycleSequenceAccountingFingerprintHash(
  value: ReplayPortfolioProtectiveTerminalCycleSequenceAccountingFingerprint
    | Omit<ReplayPortfolioProtectiveTerminalCycleSequenceAccountingFingerprint, "fingerprint_hash">,
): string {
  const { fingerprint_hash: _hash, ...body } =
    value as ReplayPortfolioProtectiveTerminalCycleSequenceAccountingFingerprint
  return canonicalHash(body)
}

export function replayPortfolioProtectiveTerminalCycleSequenceAccountingEvidenceHash(
  value: ReplayPortfolioProtectiveTerminalCycleSequenceAccountingEvidence
    | Omit<ReplayPortfolioProtectiveTerminalCycleSequenceAccountingEvidence, "evidence_hash">,
): string {
  const { evidence_hash: _hash, ...body } =
    value as ReplayPortfolioProtectiveTerminalCycleSequenceAccountingEvidence
  return canonicalHash(body)
}

export function replayPortfolioProtectiveTerminalCycleSequenceAccountingArtifactManifestHash(
  value: ReplayPortfolioProtectiveTerminalCycleSequenceAccountingArtifactManifest
    | Omit<ReplayPortfolioProtectiveTerminalCycleSequenceAccountingArtifactManifest, "manifest_hash">,
): string {
  const { manifest_hash: _hash, ...body } =
    value as ReplayPortfolioProtectiveTerminalCycleSequenceAccountingArtifactManifest
  return canonicalHash(body)
}

export function replayPortfolioProtectiveTerminalCycleSequenceAccountingOutcomeHash(
  value: ReplayPortfolioProtectiveTerminalCycleSequenceAccountingOutcome
    | Omit<ReplayPortfolioProtectiveTerminalCycleSequenceAccountingOutcome, "outcome_hash">,
): string {
  const { outcome_hash: _hash, ...body } =
    value as ReplayPortfolioProtectiveTerminalCycleSequenceAccountingOutcome
  return canonicalHash(body)
}

export function assertReplayPortfolioProtectiveTerminalCycleSequenceAccountingEvidence(
  value: ReplayPortfolioProtectiveTerminalCycleSequenceAccountingEvidence,
  source?: {
    sequence_result: ReplayPortfolioProtectiveTerminalCycleSequenceResult
    sequence_manifest: ReplayPortfolioProtectiveTerminalCycleSequenceArtifactManifest
    cycle_evidence: ReplayPortfolioProtectiveTerminalAccountingEvidence[]
    cycle_manifests: ReplayPortfolioProtectiveTerminalAccountingArtifactManifest[]
  },
): void {
  if (value.schema_version
      !== REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_ACCOUNTING_EVIDENCE_SCHEMA_VERSION
      || !value.experiment_id || !value.trial_group_id || !value.portfolio_id || !value.settlement_asset
      || value.cycle_count < 1 || value.cycle_commits.length !== value.cycle_count
      || value.cycle_accounting_evidence_hashes.length !== value.cycle_count
      || value.cycle_accounting_artifact_manifest_hashes.length !== value.cycle_count
      || JSON.stringify(value.limitations)
        !== JSON.stringify(REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_ACCOUNTING_LIMITATIONS)
      || value.evidence_hash !== replayPortfolioProtectiveTerminalCycleSequenceAccountingEvidenceHash(value)) {
    fail("evidence identity/policy")
  }
  hashes([value.trial_group_hash, value.sequence_plan_hash, value.sequence_reservation_hash,
    value.sequence_result_hash, value.sequence_artifact_manifest_hash, value.evidence_hash,
    ...value.cycle_accounting_evidence_hashes, ...value.cycle_accounting_artifact_manifest_hashes])
  value.cycle_commits.forEach((commit, index) => {
    if (commit.cycle_index !== index + 1
        || commit.cycle_commit_hash !== replayPortfolioProtectiveTerminalCycleCommitHash(commit)) fail("cycle commit")
  })
  let settled = value.consolidated_trial_balance.initial_cash
  value.consolidated_ledger.forEach((entry, index) => {
    if (entry.global_ledger_sequence !== index + 1 || entry.cycle_index < 1
        || entry.cycle_index > value.cycle_count
        || index > 0 && entry.cycle_index < value.consolidated_ledger[index - 1]!.cycle_index
        || entry.cycle_ledger_entry_hash !== entry.cycle_entry.ledger_entry_hash
        || entry.cycle_entry.ledger_entry_hash
          !== replayPortfolioProtectiveTerminalAccountingLedgerEntryHash(entry.cycle_entry)
        || entry.sequence_entry_hash
          !== replayPortfolioProtectiveTerminalCycleSequenceLedgerEntryHash(entry)) fail("ledger")
    settled = addReplayDecimalValues(settled, entry.cycle_entry.amount)
    if (settled !== entry.cycle_entry.settled_cash_after) fail("ledger cash chain")
  })
  let openings = 0
  value.consolidated_journal.forEach((entry, index) => {
    if (entry.global_journal_sequence !== index + 1 || entry.cycle_index < 1
        || entry.cycle_index > value.cycle_count
        || index > 0 && entry.cycle_index < value.consolidated_journal[index - 1]!.cycle_index
        || entry.cycle_journal_entry_hash !== entry.cycle_entry.journal_entry_hash
        || entry.cycle_entry.journal_entry_hash
          !== replayPortfolioProtectiveTerminalAccountingJournalEntryHash(entry.cycle_entry)
        || entry.sequence_entry_hash
          !== replayPortfolioProtectiveTerminalCycleSequenceJournalEntryHash(entry)) fail("journal")
    if (entry.cycle_entry.posting_kind === "opening_cash") openings += 1
  })
  if (openings !== 1 || value.consolidated_journal[0]?.cycle_entry.posting_kind !== "opening_cash") {
    fail("opening equity")
  }
  assertTrialBalance(value.consolidated_trial_balance, value.consolidated_journal)
  const fingerprint = value.fingerprint
  if (fingerprint.experiment_id !== value.experiment_id || fingerprint.trial_group_id !== value.trial_group_id
      || fingerprint.trial_group_hash !== value.trial_group_hash || fingerprint.portfolio_id !== value.portfolio_id
      || fingerprint.sequence_plan_hash !== value.sequence_plan_hash
      || fingerprint.sequence_reservation_hash !== value.sequence_reservation_hash
      || fingerprint.sequence_result_hash !== value.sequence_result_hash
      || fingerprint.sequence_artifact_manifest_hash !== value.sequence_artifact_manifest_hash
      || fingerprint.cycle_commits_hash !== canonicalHash(value.cycle_commits)
      || canonicalHash(fingerprint.cycle_accounting_evidence_hashes)
        !== canonicalHash(value.cycle_accounting_evidence_hashes)
      || canonicalHash(fingerprint.cycle_accounting_artifact_manifest_hashes)
        !== canonicalHash(value.cycle_accounting_artifact_manifest_hashes)
      || fingerprint.consolidated_ledger_hash !== canonicalHash(value.consolidated_ledger)
      || fingerprint.consolidated_journal_hash !== canonicalHash(value.consolidated_journal)
      || fingerprint.consolidated_trial_balance_hash !== value.consolidated_trial_balance.trial_balance_hash
      || fingerprint.limitations_hash !== canonicalHash(value.limitations)
      || fingerprint.fingerprint_hash
        !== replayPortfolioProtectiveTerminalCycleSequenceAccountingFingerprintHash(fingerprint)) fail("fingerprint")
  if (source) assertSource(value, source)
}

function assertSource(
  value: ReplayPortfolioProtectiveTerminalCycleSequenceAccountingEvidence,
  source: NonNullable<Parameters<typeof assertReplayPortfolioProtectiveTerminalCycleSequenceAccountingEvidence>[1]>,
): void {
  assertReplayPortfolioProtectiveTerminalCycleSequenceResult(source.sequence_result)
  assertReplayPortfolioProtectiveTerminalCycleSequenceArtifactManifest(source.sequence_manifest)
  if (value.sequence_result_hash !== source.sequence_result.result_hash
      || value.sequence_artifact_manifest_hash !== source.sequence_manifest.manifest_hash
      || source.sequence_manifest.sequence_result_hash !== source.sequence_result.result_hash
      || canonicalHash(value.cycle_commits) !== canonicalHash(source.sequence_result.cycle_commits)
      || source.cycle_evidence.length !== value.cycle_count || source.cycle_manifests.length !== value.cycle_count) {
    fail("sequence source")
  }
  source.cycle_evidence.forEach((evidence, index) => {
    const manifest = source.cycle_manifests[index]!
    const commit = value.cycle_commits[index]!
    assertReplayPortfolioProtectiveTerminalAccountingEvidence(evidence)
    assertReplayPortfolioProtectiveTerminalAccountingArtifactManifest(manifest)
    if (evidence.evidence_hash !== commit.protective_terminal_accounting_evidence_hash
        || manifest.manifest_hash !== commit.protective_terminal_accounting_artifact_manifest_hash
        || manifest.protective_terminal_accounting_evidence_hash !== evidence.evidence_hash
        || evidence.evidence_hash !== value.cycle_accounting_evidence_hashes[index]
        || manifest.manifest_hash !== value.cycle_accounting_artifact_manifest_hashes[index]
        || evidence.shared_initial_cash !== commit.opening_available_cash
        || evidence.trial_balance.ending_available_cash !== commit.ending_available_cash
        || evidence.trial_balance.trial_balance_hash !== commit.trial_balance_hash
        || evidence.settlement_asset !== value.settlement_asset) fail("cycle source")
  })
  const expectedLedger = source.cycle_evidence.flatMap((evidence, index) =>
    evidence.ledger.map((cycle_entry) => ({ cycle_index: index + 1, cycle_entry })))
  const expectedJournal = source.cycle_evidence.flatMap((evidence, index) => evidence.journal
    .filter((entry) => index === 0 || entry.posting_kind !== "opening_cash")
    .map((cycle_entry) => ({ cycle_index: index + 1, cycle_entry })))
  if (canonicalHash(value.consolidated_ledger.map((entry) => ({
    cycle_index: entry.cycle_index, cycle_entry: entry.cycle_entry,
  }))) !== canonicalHash(expectedLedger)
      || canonicalHash(value.consolidated_journal.map((entry) => ({
        cycle_index: entry.cycle_index, cycle_entry: entry.cycle_entry,
      }))) !== canonicalHash(expectedJournal)) fail("consolidated source")
}

function assertTrialBalance(
  value: ReplayPortfolioProtectiveTerminalCycleSequenceTrialBalance,
  journal: ReplayPortfolioProtectiveTerminalCycleSequenceJournalEntry[],
): void {
  const computed = recompute(journal)
  if (value.journal_policy_version
      !== REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_JOURNAL_POLICY_VERSION
      || value.source_cycle_accounting_policy_version
        !== REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ACCOUNTING_POLICY_VERSION
      || value.total_debits !== value.total_credits || value.total_debits !== computed.total_debits
      || canonicalHash(value.balances) !== canonicalHash(computed.balances)
      || value.opening_equity_posting_count !== 1 || value.balances.opening_equity !== value.initial_cash
      || value.ending_available_cash !== value.balances.wallet_cash
      || value.ending_reserved_isolated_collateral !== 0 || value.balances.isolated_margin_collateral !== 0
      || value.ending_settled_cash !== value.ending_available_cash
      || value.ending_unrealized_pnl !== 0 || value.balances.position_valuation !== 0
      || value.ending_portfolio_nav !== value.ending_settled_cash || value.balanced !== true
      || value.trial_balance_hash
        !== replayPortfolioProtectiveTerminalCycleSequenceTrialBalanceHash(value)) fail("trial balance")
}

const ACCOUNTS: ReplayPortfolioProtectiveTerminalAccountingJournalAccount[] = [
  "wallet_cash", "isolated_margin_collateral", "position_valuation", "opening_equity",
  "realized_pnl_income", "realized_pnl_loss", "funding_income", "funding_expense",
  "fee_expense", "liquidation_fee_expense", "unrealized_pnl_income", "unrealized_pnl_loss",
]
const CREDIT_NORMAL = new Set<ReplayPortfolioProtectiveTerminalAccountingJournalAccount>([
  "opening_equity", "realized_pnl_income", "funding_income", "unrealized_pnl_income",
])

function recompute(entries: ReplayPortfolioProtectiveTerminalCycleSequenceJournalEntry[]): {
  total_debits: number
  total_credits: number
  balances: Record<ReplayPortfolioProtectiveTerminalAccountingJournalAccount, number>
} {
  const raw = Object.fromEntries(ACCOUNTS.map((account) => [account, 0])) as
    Record<ReplayPortfolioProtectiveTerminalAccountingJournalAccount, number>
  let totalDebits = 0
  let totalCredits = 0
  for (const entry of entries) for (const leg of entry.cycle_entry.legs) {
    totalDebits = addReplayDecimalValues(totalDebits, leg.debit)
    totalCredits = addReplayDecimalValues(totalCredits, leg.credit)
    raw[leg.account] = addReplayDecimalValues(raw[leg.account], leg.debit, -leg.credit)
  }
  return {
    total_debits: totalDebits,
    total_credits: totalCredits,
    balances: Object.fromEntries(ACCOUNTS.map((account) => [
      account, CREDIT_NORMAL.has(account) ? -raw[account] : raw[account],
    ])) as Record<ReplayPortfolioProtectiveTerminalAccountingJournalAccount, number>,
  }
}

export function assertReplayPortfolioProtectiveTerminalCycleSequenceAccountingArtifactManifest(
  value: ReplayPortfolioProtectiveTerminalCycleSequenceAccountingArtifactManifest,
): void {
  if (value.schema_version
      !== REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_ACCOUNTING_ARTIFACT_MANIFEST_SCHEMA_VERSION
      || !value.artifact_id || !value.portfolio_id
      || value.files.length
        !== REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_ACCOUNTING_ARTIFACT_ROLES.length
      || JSON.stringify(value.files.map((file) => file.role))
        !== JSON.stringify(REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_ACCOUNTING_ARTIFACT_ROLES)
      || value.files.some((file) => !/^[a-z0-9][a-z0-9.-]*$/.test(file.name) || !file.ref)
      || value.completeness.authoritative_result !== true
      || value.completeness.commit_marker
        !== "portfolio-protective-terminal-cycle-sequence-accounting-artifact-manifest.json"
      || value.completeness.partial_payload_without_manifest_is_authoritative !== false
      || JSON.stringify(value.completeness.required_roles)
        !== JSON.stringify(REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_ACCOUNTING_ARTIFACT_ROLES)
      || !utc(value.authority_frozen_at)
      || value.manifest_hash
        !== replayPortfolioProtectiveTerminalCycleSequenceAccountingArtifactManifestHash(value)) {
    fail("artifact manifest")
  }
  hashes([value.accounting_evidence_hash, value.accounting_fingerprint_hash,
    value.sequence_result_hash, value.manifest_hash, ...value.files.map((file) => file.sha256)])
}

export function assertReplayPortfolioProtectiveTerminalCycleSequenceAccountingOutcome(
  value: ReplayPortfolioProtectiveTerminalCycleSequenceAccountingOutcome,
): void {
  if (value.schema_version
      !== REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_ACCOUNTING_OUTCOME_SCHEMA_VERSION
      || !value.portfolio_id
      || value.status === "completed" !== (value.sequence_result !== null && value.evidence !== null
        && value.artifact_manifest !== null && value.failure === null)
      || value.status === "failed" !== (value.sequence_result === null && value.evidence === null
        && value.artifact_manifest === null && value.failure !== null)
      || value.failure && value.failure.partial_accounting_result_published !== false
      || value.outcome_hash
        !== replayPortfolioProtectiveTerminalCycleSequenceAccountingOutcomeHash(value)) fail("outcome")
  if (value.evidence) assertReplayPortfolioProtectiveTerminalCycleSequenceAccountingEvidence(value.evidence)
  if (value.artifact_manifest) {
    assertReplayPortfolioProtectiveTerminalCycleSequenceAccountingArtifactManifest(value.artifact_manifest)
  }
}

function hashes(values: string[]): void {
  if (values.some((value) => !/^[a-f0-9]{64}$/.test(value))) fail("hash")
}
function utc(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
    && Number.isFinite(Date.parse(value))
}
function fail(scope: string): never {
  throw new Error(`Portfolio Protective Terminal Cycle Sequence Accounting ${scope} invalid`)
}
