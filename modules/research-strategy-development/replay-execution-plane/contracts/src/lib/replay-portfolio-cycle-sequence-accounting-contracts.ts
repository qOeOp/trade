import { canonicalHash } from "./replay-contracts"
import {
  assertReplayPortfolioCycleSequenceArtifactManifest,
  replayPortfolioCycleSequenceRecordHash,
  type ReplayPortfolioCycleSequenceArtifactManifest,
  type ReplayPortfolioCycleSequenceRecord,
  type ReplayPortfolioCycleSequenceResult,
} from "./replay-portfolio-cycle-sequence-contracts"
import {
  assertReplayRuntimeSharedWalletPortfolioEvidence,
  replayPortfolioJournalEntryHash,
  replayPortfolioLedgerEntryHash,
  type ReplayPortfolioJournalAccount,
  type ReplayPortfolioJournalEntry,
  type ReplayPortfolioLedgerEntry,
  type ReplayRuntimeSharedWalletPortfolioEvidence,
} from "./replay-runtime-shared-wallet-artifact-contracts"

export const REPLAY_PORTFOLIO_CYCLE_SEQUENCE_ACCOUNTING_EVIDENCE_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-cycle-sequence-accounting-evidence.v1" as const
export const REPLAY_PORTFOLIO_CYCLE_SEQUENCE_ACCOUNTING_ARTIFACT_MANIFEST_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-cycle-sequence-accounting-artifact-manifest.v1" as const
export const REPLAY_PORTFOLIO_CYCLE_SEQUENCE_ACCOUNTING_OUTCOME_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-cycle-sequence-accounting-outcome.v1" as const
export const REPLAY_PORTFOLIO_CYCLE_SEQUENCE_JOURNAL_POLICY_VERSION =
  "bounded-cycle-opening-equity-once-roll-forward-v1" as const

export const REPLAY_PORTFOLIO_CYCLE_SEQUENCE_ACCOUNTING_LIMITATIONS = [
  "full_flat_cycle_boundaries_with_one_sequence_opening_equity_only",
  "cycle_local_entries_preserved_without_cross_cycle_reclassification",
  "no_open_position_roll_forward_partial_cross_margin_borrow_or_fast",
] as const

export interface ReplayPortfolioCycleSequenceLedgerEntry {
  sequence_entry_hash: string
  global_ledger_sequence: number
  cycle_index: number
  cycle_ledger_entry_hash: string
  cycle_entry: ReplayPortfolioLedgerEntry
}

export interface ReplayPortfolioCycleSequenceJournalEntry {
  sequence_entry_hash: string
  global_journal_sequence: number
  cycle_index: number
  cycle_journal_entry_hash: string
  cycle_entry: ReplayPortfolioJournalEntry
}

export interface ReplayPortfolioCycleSequenceTrialBalance {
  settlement_asset: string
  journal_policy_version: typeof REPLAY_PORTFOLIO_CYCLE_SEQUENCE_JOURNAL_POLICY_VERSION
  total_debits: number
  total_credits: number
  balances: Record<ReplayPortfolioJournalAccount, number>
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

export interface ReplayPortfolioCycleSequenceAccountingFingerprint {
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  portfolio_id: string
  sequence_reservation_hash: string
  sequence_plan_hash: string
  sequence_result_hash: string
  sequence_artifact_manifest_hash: string
  cycle_records_hash: string
  cycle_accounting_evidence_hashes: string[]
  consolidated_ledger_hash: string
  consolidated_journal_hash: string
  consolidated_trial_balance_hash: string
  limitations_hash: string
  fingerprint_hash: string
}

export interface ReplayPortfolioCycleSequenceAccountingEvidence {
  schema_version: typeof REPLAY_PORTFOLIO_CYCLE_SEQUENCE_ACCOUNTING_EVIDENCE_SCHEMA_VERSION
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  portfolio_id: string
  sequence_plan_hash: string
  sequence_reservation_hash: string
  sequence_result_hash: string
  sequence_artifact_manifest_hash: string
  cycle_count: number
  cycle_records: ReplayPortfolioCycleSequenceRecord[]
  cycle_accounting_evidence_hashes: string[]
  consolidated_ledger: ReplayPortfolioCycleSequenceLedgerEntry[]
  consolidated_journal: ReplayPortfolioCycleSequenceJournalEntry[]
  consolidated_trial_balance: ReplayPortfolioCycleSequenceTrialBalance
  fingerprint: ReplayPortfolioCycleSequenceAccountingFingerprint
  limitations: typeof REPLAY_PORTFOLIO_CYCLE_SEQUENCE_ACCOUNTING_LIMITATIONS
  evidence_hash: string
}

export const REPLAY_PORTFOLIO_CYCLE_SEQUENCE_ACCOUNTING_ARTIFACT_ROLES = [
  "sequence_result", "sequence_artifact_manifest", "cycle_accounting_evidence",
  "consolidated_ledger", "consolidated_journal", "consolidated_trial_balance",
  "consolidated_fingerprint", "consolidated_accounting_evidence",
] as const
export type ReplayPortfolioCycleSequenceAccountingArtifactRole =
  typeof REPLAY_PORTFOLIO_CYCLE_SEQUENCE_ACCOUNTING_ARTIFACT_ROLES[number]

export interface ReplayPortfolioCycleSequenceAccountingArtifactManifest {
  schema_version: typeof REPLAY_PORTFOLIO_CYCLE_SEQUENCE_ACCOUNTING_ARTIFACT_MANIFEST_SCHEMA_VERSION
  artifact_id: string
  portfolio_id: string
  accounting_evidence_hash: string
  accounting_fingerprint_hash: string
  sequence_result_hash: string
  files: Array<{
    role: ReplayPortfolioCycleSequenceAccountingArtifactRole
    name: string
    ref: string
    sha256: string
  }>
  completeness: {
    authoritative_result: true
    required_roles: typeof REPLAY_PORTFOLIO_CYCLE_SEQUENCE_ACCOUNTING_ARTIFACT_ROLES
    commit_marker: "portfolio-cycle-sequence-accounting-artifact-manifest.json"
    partial_payload_without_manifest_is_authoritative: false
  }
  authority_frozen_at: string
  manifest_hash: string
}

export interface ReplayPortfolioCycleSequenceAccountingOutcome {
  schema_version: typeof REPLAY_PORTFOLIO_CYCLE_SEQUENCE_ACCOUNTING_OUTCOME_SCHEMA_VERSION
  portfolio_id: string
  sequence_plan_hash: string
  status: "completed" | "failed"
  sequence_result: ReplayPortfolioCycleSequenceResult | null
  evidence: ReplayPortfolioCycleSequenceAccountingEvidence | null
  artifact_manifest: ReplayPortfolioCycleSequenceAccountingArtifactManifest | null
  idempotent_replay: boolean
  failure: {
    code: "sequence-execution-failed" | "sequence-artifact-read-failed"
      | "sequence-accounting-invalid" | "sequence-accounting-artifact-failed"
    message: string
    partial_result_published: false
  } | null
  outcome_hash: string
}

export function replayPortfolioCycleSequenceLedgerEntryHash(
  value: ReplayPortfolioCycleSequenceLedgerEntry | Omit<ReplayPortfolioCycleSequenceLedgerEntry, "sequence_entry_hash">,
): string {
  const { sequence_entry_hash: _hash, ...body } = value as ReplayPortfolioCycleSequenceLedgerEntry
  return canonicalHash(body)
}

export function replayPortfolioCycleSequenceJournalEntryHash(
  value: ReplayPortfolioCycleSequenceJournalEntry
    | Omit<ReplayPortfolioCycleSequenceJournalEntry, "sequence_entry_hash">,
): string {
  const { sequence_entry_hash: _hash, ...body } = value as ReplayPortfolioCycleSequenceJournalEntry
  return canonicalHash(body)
}

export function replayPortfolioCycleSequenceTrialBalanceHash(
  value: ReplayPortfolioCycleSequenceTrialBalance | Omit<ReplayPortfolioCycleSequenceTrialBalance, "trial_balance_hash">,
): string {
  const { trial_balance_hash: _hash, ...body } = value as ReplayPortfolioCycleSequenceTrialBalance
  return canonicalHash(body)
}

export function replayPortfolioCycleSequenceAccountingFingerprintHash(
  value: ReplayPortfolioCycleSequenceAccountingFingerprint
    | Omit<ReplayPortfolioCycleSequenceAccountingFingerprint, "fingerprint_hash">,
): string {
  const { fingerprint_hash: _hash, ...body } = value as ReplayPortfolioCycleSequenceAccountingFingerprint
  return canonicalHash(body)
}

export function replayPortfolioCycleSequenceAccountingEvidenceHash(
  value: ReplayPortfolioCycleSequenceAccountingEvidence
    | Omit<ReplayPortfolioCycleSequenceAccountingEvidence, "evidence_hash">,
): string {
  const { evidence_hash: _hash, ...body } = value as ReplayPortfolioCycleSequenceAccountingEvidence
  return canonicalHash(body)
}

export function replayPortfolioCycleSequenceAccountingArtifactManifestHash(
  value: ReplayPortfolioCycleSequenceAccountingArtifactManifest
    | Omit<ReplayPortfolioCycleSequenceAccountingArtifactManifest, "manifest_hash">,
): string {
  const { manifest_hash: _hash, ...body } = value as ReplayPortfolioCycleSequenceAccountingArtifactManifest
  return canonicalHash(body)
}

export function replayPortfolioCycleSequenceAccountingOutcomeHash(
  value: ReplayPortfolioCycleSequenceAccountingOutcome
    | Omit<ReplayPortfolioCycleSequenceAccountingOutcome, "outcome_hash">,
): string {
  const { outcome_hash: _hash, ...body } = value as ReplayPortfolioCycleSequenceAccountingOutcome
  return canonicalHash(body)
}

export function assertReplayPortfolioCycleSequenceAccountingEvidence(
  value: ReplayPortfolioCycleSequenceAccountingEvidence,
  input?: {
    sequence_result: ReplayPortfolioCycleSequenceResult
    sequence_manifest: ReplayPortfolioCycleSequenceArtifactManifest
    cycle_evidence: ReplayRuntimeSharedWalletPortfolioEvidence[]
  },
): void {
  if (value.schema_version !== REPLAY_PORTFOLIO_CYCLE_SEQUENCE_ACCOUNTING_EVIDENCE_SCHEMA_VERSION
      || value.experiment_id.trim() === "" || value.trial_group_id.trim() === ""
      || value.cycle_count < 1 || value.cycle_records.length !== value.cycle_count
      || value.cycle_accounting_evidence_hashes.length !== value.cycle_count
      || JSON.stringify(value.limitations) !== JSON.stringify(REPLAY_PORTFOLIO_CYCLE_SEQUENCE_ACCOUNTING_LIMITATIONS)) {
    fail("Evidence policy/coverage")
  }
  hashes([value.trial_group_hash, value.sequence_plan_hash, value.sequence_reservation_hash,
    value.sequence_result_hash, value.sequence_artifact_manifest_hash, value.evidence_hash])
  value.cycle_records.forEach((record, index) => {
    if (record.cycle_index !== index + 1 || record.record_hash !== replayPortfolioCycleSequenceRecordHash(record)) {
      fail("cycle record")
    }
  })
  value.cycle_accounting_evidence_hashes.forEach((hash) => hashes([hash]))
  let settled = value.consolidated_trial_balance.initial_cash
  value.consolidated_ledger.forEach((entry, index) => {
    if (entry.global_ledger_sequence !== index + 1 || entry.cycle_index < 1
        || entry.cycle_index > value.cycle_count
        || (index > 0 && entry.cycle_index < value.consolidated_ledger[index - 1]!.cycle_index)
        || entry.cycle_ledger_entry_hash !== entry.cycle_entry.ledger_entry_hash
        || entry.cycle_entry.ledger_entry_hash !== replayPortfolioLedgerEntryHash(entry.cycle_entry)
        || entry.sequence_entry_hash !== replayPortfolioCycleSequenceLedgerEntryHash(entry)) fail("Ledger entry")
    settled = add(settled, entry.cycle_entry.amount)
    if (entry.cycle_entry.settled_cash_after !== settled) fail("Ledger cash roll-forward")
  })
  let openingCount = 0
  value.consolidated_journal.forEach((entry, index) => {
    if (entry.global_journal_sequence !== index + 1 || entry.cycle_index < 1
        || entry.cycle_index > value.cycle_count
        || (index > 0 && entry.cycle_index < value.consolidated_journal[index - 1]!.cycle_index)
        || entry.cycle_journal_entry_hash !== entry.cycle_entry.journal_entry_hash
        || entry.cycle_entry.journal_entry_hash !== replayPortfolioJournalEntryHash(entry.cycle_entry)
        || entry.sequence_entry_hash !== replayPortfolioCycleSequenceJournalEntryHash(entry)) fail("Journal entry")
    if (entry.cycle_entry.posting_kind === "opening_cash") openingCount += 1
  })
  if (openingCount !== 1 || value.consolidated_journal[0]?.cycle_entry.posting_kind !== "opening_cash") {
    fail("opening equity count")
  }
  assertTrialBalance(value.consolidated_trial_balance, value.consolidated_journal)
  const fingerprint = value.fingerprint
  if (fingerprint.experiment_id !== value.experiment_id
      || fingerprint.trial_group_id !== value.trial_group_id
      || fingerprint.trial_group_hash !== value.trial_group_hash
      || fingerprint.portfolio_id !== value.portfolio_id
      || fingerprint.sequence_reservation_hash !== value.sequence_reservation_hash
      || fingerprint.sequence_plan_hash !== value.sequence_plan_hash
      || fingerprint.sequence_result_hash !== value.sequence_result_hash
      || fingerprint.sequence_artifact_manifest_hash !== value.sequence_artifact_manifest_hash
      || fingerprint.cycle_records_hash !== canonicalHash(value.cycle_records)
      || JSON.stringify(fingerprint.cycle_accounting_evidence_hashes)
        !== JSON.stringify(value.cycle_accounting_evidence_hashes)
      || fingerprint.consolidated_ledger_hash !== canonicalHash(value.consolidated_ledger)
      || fingerprint.consolidated_journal_hash !== canonicalHash(value.consolidated_journal)
      || fingerprint.consolidated_trial_balance_hash !== value.consolidated_trial_balance.trial_balance_hash
      || fingerprint.limitations_hash !== canonicalHash(value.limitations)
      || fingerprint.fingerprint_hash !== replayPortfolioCycleSequenceAccountingFingerprintHash(fingerprint)) {
    fail("Fingerprint")
  }
  if (value.evidence_hash !== replayPortfolioCycleSequenceAccountingEvidenceHash(value)) fail("Evidence hash")
  if (input) {
    assertReplayPortfolioCycleSequenceArtifactManifest(input.sequence_manifest)
    if (value.portfolio_id !== input.sequence_result.portfolio_id
        || value.sequence_plan_hash !== input.sequence_result.sequence_plan_hash
        || value.sequence_reservation_hash !== input.sequence_result.sequence_reservation_hash
        || value.sequence_result_hash !== input.sequence_result.result_hash
        || value.sequence_artifact_manifest_hash !== input.sequence_manifest.manifest_hash
        || input.sequence_manifest.sequence_result_hash !== input.sequence_result.result_hash
        || value.cycle_count !== input.sequence_result.cycle_count
        || JSON.stringify(value.cycle_records) !== JSON.stringify(input.sequence_result.cycle_records)
        || input.cycle_evidence.length !== value.cycle_count) fail("Sequence binding")
    input.cycle_evidence.forEach((evidence, index) => {
      assertReplayRuntimeSharedWalletPortfolioEvidence(evidence)
      if (evidence.evidence_hash !== value.cycle_accounting_evidence_hashes[index]
          || evidence.evidence_hash !== value.cycle_records[index]?.portfolio_evidence_hash
          || evidence.trial_balance.settlement_asset !== value.consolidated_trial_balance.settlement_asset
          || evidence.trial_balance.balances.opening_equity
            !== value.cycle_records[index]?.opening_available_cash
          || evidence.trial_balance.ending_available_cash
            !== value.cycle_records[index]?.ending_available_cash) fail("cycle Evidence binding")
    })
    const expectedLedger = input.cycle_evidence.flatMap((evidence, index) =>
      evidence.portfolio_ledger.map((cycle_entry) => ({ cycle_index: index + 1, cycle_entry })))
    const expectedJournal = input.cycle_evidence.flatMap((evidence, index) =>
      evidence.portfolio_journal
        .filter((entry) => index === 0 || entry.posting_kind !== "opening_cash")
        .map((cycle_entry) => ({ cycle_index: index + 1, cycle_entry })))
    if (JSON.stringify(value.consolidated_ledger.map((entry) => ({
      cycle_index: entry.cycle_index, cycle_entry: entry.cycle_entry,
    }))) !== JSON.stringify(expectedLedger)
        || JSON.stringify(value.consolidated_journal.map((entry) => ({
          cycle_index: entry.cycle_index, cycle_entry: entry.cycle_entry,
        }))) !== JSON.stringify(expectedJournal)) fail("consolidated entry binding")
  }
}

function assertTrialBalance(
  value: ReplayPortfolioCycleSequenceTrialBalance,
  journal: ReplayPortfolioCycleSequenceJournalEntry[],
): void {
  const recomputed = recompute(journal)
  if (value.journal_policy_version !== REPLAY_PORTFOLIO_CYCLE_SEQUENCE_JOURNAL_POLICY_VERSION
      || value.opening_equity_posting_count !== 1 || value.balanced !== true
      || value.total_debits !== value.total_credits || value.total_debits !== recomputed.total_debits
      || JSON.stringify(value.balances) !== JSON.stringify(recomputed.balances)
      || value.balances.opening_equity !== value.initial_cash
      || value.ending_available_cash !== value.balances.wallet_cash
      || value.ending_reserved_isolated_collateral !== 0
      || value.balances.isolated_margin_collateral !== 0
      || value.ending_settled_cash !== value.ending_available_cash
      || value.ending_unrealized_pnl !== 0 || value.balances.position_valuation !== 0
      || value.ending_portfolio_nav !== value.ending_settled_cash
      || value.trial_balance_hash !== replayPortfolioCycleSequenceTrialBalanceHash(value)) fail("Trial Balance")
}

function recompute(entries: ReplayPortfolioCycleSequenceJournalEntry[]): {
  total_debits: number
  total_credits: number
  balances: Record<ReplayPortfolioJournalAccount, number>
} {
  const accounts: ReplayPortfolioJournalAccount[] = [
    "wallet_cash", "isolated_margin_collateral", "position_valuation", "opening_equity",
    "realized_pnl_income", "realized_pnl_loss", "funding_income", "funding_expense",
    "fee_expense", "liquidation_fee_expense", "unrealized_pnl_income", "unrealized_pnl_loss",
  ]
  const creditNormal = new Set<ReplayPortfolioJournalAccount>([
    "opening_equity", "realized_pnl_income", "funding_income", "unrealized_pnl_income",
  ])
  const raw = Object.fromEntries(
    accounts.map((account) => [account, 0]),
  ) as Record<ReplayPortfolioJournalAccount, number>
  let totalDebits = 0
  let totalCredits = 0
  for (const entry of entries) {
    for (const leg of entry.cycle_entry.legs) {
      totalDebits = add(totalDebits, leg.debit)
      totalCredits = add(totalCredits, leg.credit)
      raw[leg.account] = add(raw[leg.account], leg.debit, -leg.credit)
    }
  }
  return {
    total_debits: totalDebits,
    total_credits: totalCredits,
    balances: Object.fromEntries(accounts.map((account) => [
      account, creditNormal.has(account) ? -raw[account] : raw[account],
    ])) as Record<ReplayPortfolioJournalAccount, number>,
  }
}

export function assertReplayPortfolioCycleSequenceAccountingArtifactManifest(
  value: ReplayPortfolioCycleSequenceAccountingArtifactManifest,
): void {
  if (value.schema_version !== REPLAY_PORTFOLIO_CYCLE_SEQUENCE_ACCOUNTING_ARTIFACT_MANIFEST_SCHEMA_VERSION
      || value.files.length !== REPLAY_PORTFOLIO_CYCLE_SEQUENCE_ACCOUNTING_ARTIFACT_ROLES.length
      || value.files.some((file, index) =>
        file.role !== REPLAY_PORTFOLIO_CYCLE_SEQUENCE_ACCOUNTING_ARTIFACT_ROLES[index]
        || !/^[a-z0-9][a-z0-9.-]*$/.test(file.name) || file.ref.trim() === ""
        || !/^[a-f0-9]{64}$/.test(file.sha256))
      || value.completeness.authoritative_result !== true
      || JSON.stringify(value.completeness.required_roles)
        !== JSON.stringify(REPLAY_PORTFOLIO_CYCLE_SEQUENCE_ACCOUNTING_ARTIFACT_ROLES)
      || value.completeness.commit_marker !== "portfolio-cycle-sequence-accounting-artifact-manifest.json"
      || value.completeness.partial_payload_without_manifest_is_authoritative !== false
      || !utc(value.authority_frozen_at)
      || value.manifest_hash !== replayPortfolioCycleSequenceAccountingArtifactManifestHash(value)) {
    fail("Artifact Manifest")
  }
  hashes([value.accounting_evidence_hash, value.accounting_fingerprint_hash,
    value.sequence_result_hash, value.manifest_hash])
}

export function assertReplayPortfolioCycleSequenceAccountingOutcome(
  value: ReplayPortfolioCycleSequenceAccountingOutcome,
): void {
  if (value.schema_version !== REPLAY_PORTFOLIO_CYCLE_SEQUENCE_ACCOUNTING_OUTCOME_SCHEMA_VERSION) fail("Outcome schema")
  if (value.status === "completed") {
    if (!value.sequence_result || !value.evidence || !value.artifact_manifest || value.failure !== null
        || value.sequence_result.result_hash !== value.artifact_manifest.sequence_result_hash
        || value.evidence.evidence_hash !== value.artifact_manifest.accounting_evidence_hash) fail("completed Outcome")
    assertReplayPortfolioCycleSequenceAccountingEvidence(value.evidence)
    assertReplayPortfolioCycleSequenceAccountingArtifactManifest(value.artifact_manifest)
  } else if (value.sequence_result !== null || value.evidence !== null || value.artifact_manifest !== null
      || !value.failure || value.idempotent_replay || value.failure.partial_result_published !== false) {
    fail("failed Outcome")
  }
  if (value.outcome_hash !== replayPortfolioCycleSequenceAccountingOutcomeHash(value)) fail("Outcome hash")
}

function hashes(values: string[]): void {
  if (values.some((value) => !/^[a-f0-9]{64}$/.test(value))) fail("hash")
}
function utc(value: string): boolean { return value.endsWith("Z") && Number.isFinite(Date.parse(value)) }
function add(...values: number[]): number {
  return Number(values.reduce((sum, value) => sum + value, 0).toFixed(12))
}
function fail(message: string): never {
  throw new Error(`Replay Portfolio Cycle Sequence Accounting ${message}`)
}
