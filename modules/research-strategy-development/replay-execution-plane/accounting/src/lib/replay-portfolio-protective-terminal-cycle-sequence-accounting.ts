import {
  REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_ACCOUNTING_EVIDENCE_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_ACCOUNTING_LIMITATIONS,
  REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_JOURNAL_POLICY_VERSION,
  assertReplayPortfolioProtectiveTerminalCycleSequenceAccountingEvidence,
  replayPortfolioProtectiveTerminalCycleSequenceAccountingEvidenceHash,
  replayPortfolioProtectiveTerminalCycleSequenceAccountingFingerprintHash,
  replayPortfolioProtectiveTerminalCycleSequenceJournalEntryHash,
  replayPortfolioProtectiveTerminalCycleSequenceLedgerEntryHash,
  replayPortfolioProtectiveTerminalCycleSequenceTrialBalanceHash,
  type ReplayPortfolioProtectiveTerminalCycleSequenceAccountingEvidence,
  type ReplayPortfolioProtectiveTerminalCycleSequenceAccountingFingerprint,
  type ReplayPortfolioProtectiveTerminalCycleSequenceJournalEntry,
  type ReplayPortfolioProtectiveTerminalCycleSequenceLedgerEntry,
  type ReplayPortfolioProtectiveTerminalCycleSequenceTrialBalance,
} from "../../../contracts/src/lib/replay-portfolio-protective-terminal-cycle-sequence-accounting-contracts"
import type {
  ReplayPortfolioProtectiveTerminalCycleSequenceArtifactManifest,
  ReplayPortfolioProtectiveTerminalCycleSequenceResult,
} from "../../../contracts/src/lib/replay-portfolio-protective-terminal-cycle-sequence-contracts"
import {
  REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ACCOUNTING_POLICY_VERSION,
  type ReplayPortfolioProtectiveTerminalAccountingArtifactManifest,
  type ReplayPortfolioProtectiveTerminalAccountingEvidence,
  type ReplayPortfolioProtectiveTerminalAccountingJournalAccount,
} from "../../../contracts/src/lib/replay-portfolio-protective-terminal-accounting-contracts"
import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import { addReplayDecimalValues } from "../../../contracts/src/lib/replay-decimal"

const ACCOUNTS: ReplayPortfolioProtectiveTerminalAccountingJournalAccount[] = [
  "wallet_cash", "isolated_margin_collateral", "position_valuation", "opening_equity",
  "realized_pnl_income", "realized_pnl_loss", "funding_income", "funding_expense",
  "fee_expense", "liquidation_fee_expense", "unrealized_pnl_income", "unrealized_pnl_loss",
]
const CREDIT_NORMAL = new Set<ReplayPortfolioProtectiveTerminalAccountingJournalAccount>([
  "opening_equity", "realized_pnl_income", "funding_income", "unrealized_pnl_income",
])

export interface ReplayPortfolioProtectiveTerminalCycleSequenceAccountingInput {
  sequence_result: ReplayPortfolioProtectiveTerminalCycleSequenceResult
  sequence_manifest: ReplayPortfolioProtectiveTerminalCycleSequenceArtifactManifest
  cycle_evidence: ReplayPortfolioProtectiveTerminalAccountingEvidence[]
  cycle_manifests: ReplayPortfolioProtectiveTerminalAccountingArtifactManifest[]
}

export function createReplayPortfolioProtectiveTerminalCycleSequenceAccountingEvidence(
  input: ReplayPortfolioProtectiveTerminalCycleSequenceAccountingInput,
): ReplayPortfolioProtectiveTerminalCycleSequenceAccountingEvidence {
  const ledger: ReplayPortfolioProtectiveTerminalCycleSequenceLedgerEntry[] = []
  const journal: ReplayPortfolioProtectiveTerminalCycleSequenceJournalEntry[] = []
  input.cycle_evidence.forEach((evidence, index) => {
    const cycleIndex = index + 1
    for (const cycleEntry of evidence.ledger) {
      const body: Omit<ReplayPortfolioProtectiveTerminalCycleSequenceLedgerEntry, "sequence_entry_hash"> = {
        global_ledger_sequence: ledger.length + 1,
        cycle_index: cycleIndex,
        cycle_ledger_entry_hash: cycleEntry.ledger_entry_hash,
        cycle_entry: cycleEntry,
      }
      ledger.push({ ...body,
        sequence_entry_hash: replayPortfolioProtectiveTerminalCycleSequenceLedgerEntryHash(body) })
    }
    const openings = evidence.journal.filter((entry) => entry.posting_kind === "opening_cash")
    if (openings.length !== 1 || evidence.journal[0]?.posting_kind !== "opening_cash") {
      throw new Error(`Protective Terminal Cycle ${cycleIndex} opening Journal is invalid`)
    }
    for (const cycleEntry of evidence.journal) {
      if (cycleIndex > 1 && cycleEntry.posting_kind === "opening_cash") continue
      const body: Omit<ReplayPortfolioProtectiveTerminalCycleSequenceJournalEntry, "sequence_entry_hash"> = {
        global_journal_sequence: journal.length + 1,
        cycle_index: cycleIndex,
        cycle_journal_entry_hash: cycleEntry.journal_entry_hash,
        cycle_entry: cycleEntry,
      }
      journal.push({ ...body,
        sequence_entry_hash: replayPortfolioProtectiveTerminalCycleSequenceJournalEntryHash(body) })
    }
  })
  const result = input.sequence_result
  const trialBalance = createTrialBalance(result, journal)
  const evidenceHashes = input.cycle_evidence.map((evidence) => evidence.evidence_hash)
  const manifestHashes = input.cycle_manifests.map((manifest) => manifest.manifest_hash)
  const fingerprintBody: Omit<
    ReplayPortfolioProtectiveTerminalCycleSequenceAccountingFingerprint,
    "fingerprint_hash"
  > = {
    experiment_id: result.experiment_id,
    trial_group_id: result.trial_group_id,
    trial_group_hash: result.trial_group_hash,
    portfolio_id: result.portfolio_id,
    sequence_plan_hash: result.sequence_plan_hash,
    sequence_reservation_hash: result.sequence_reservation_hash,
    sequence_result_hash: result.result_hash,
    sequence_artifact_manifest_hash: input.sequence_manifest.manifest_hash,
    cycle_commits_hash: result.cycle_commits_hash,
    cycle_accounting_evidence_hashes: evidenceHashes,
    cycle_accounting_artifact_manifest_hashes: manifestHashes,
    consolidated_ledger_hash: canonicalHash(ledger),
    consolidated_journal_hash: canonicalHash(journal),
    consolidated_trial_balance_hash: trialBalance.trial_balance_hash,
    limitations_hash: canonicalHash(
      REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_ACCOUNTING_LIMITATIONS,
    ),
  }
  const fingerprint = { ...fingerprintBody,
    fingerprint_hash: replayPortfolioProtectiveTerminalCycleSequenceAccountingFingerprintHash(fingerprintBody) }
  const body: Omit<ReplayPortfolioProtectiveTerminalCycleSequenceAccountingEvidence, "evidence_hash"> = {
    schema_version: REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_ACCOUNTING_EVIDENCE_SCHEMA_VERSION,
    experiment_id: result.experiment_id,
    trial_group_id: result.trial_group_id,
    trial_group_hash: result.trial_group_hash,
    portfolio_id: result.portfolio_id,
    sequence_plan_hash: result.sequence_plan_hash,
    sequence_reservation_hash: result.sequence_reservation_hash,
    sequence_result_hash: result.result_hash,
    sequence_artifact_manifest_hash: input.sequence_manifest.manifest_hash,
    settlement_asset: result.settlement_asset,
    cycle_count: result.cycle_count,
    cycle_commits: structuredClone(result.cycle_commits),
    cycle_accounting_evidence_hashes: evidenceHashes,
    cycle_accounting_artifact_manifest_hashes: manifestHashes,
    consolidated_ledger: ledger,
    consolidated_journal: journal,
    consolidated_trial_balance: trialBalance,
    fingerprint,
    limitations: REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_ACCOUNTING_LIMITATIONS,
  }
  const evidence = { ...body,
    evidence_hash: replayPortfolioProtectiveTerminalCycleSequenceAccountingEvidenceHash(body) }
  assertReplayPortfolioProtectiveTerminalCycleSequenceAccountingEvidence(evidence, input)
  return evidence
}

function createTrialBalance(
  result: ReplayPortfolioProtectiveTerminalCycleSequenceResult,
  journal: ReplayPortfolioProtectiveTerminalCycleSequenceJournalEntry[],
): ReplayPortfolioProtectiveTerminalCycleSequenceTrialBalance {
  const raw = Object.fromEntries(ACCOUNTS.map((account) => [account, 0])) as
    Record<ReplayPortfolioProtectiveTerminalAccountingJournalAccount, number>
  let totalDebits = 0
  let totalCredits = 0
  for (const entry of journal) for (const leg of entry.cycle_entry.legs) {
    totalDebits = addReplayDecimalValues(totalDebits, leg.debit)
    totalCredits = addReplayDecimalValues(totalCredits, leg.credit)
    raw[leg.account] = addReplayDecimalValues(raw[leg.account], leg.debit, -leg.credit)
  }
  const balances = Object.fromEntries(ACCOUNTS.map((account) => [
    account, CREDIT_NORMAL.has(account) ? -raw[account] : raw[account],
  ])) as Record<ReplayPortfolioProtectiveTerminalAccountingJournalAccount, number>
  const body: Omit<ReplayPortfolioProtectiveTerminalCycleSequenceTrialBalance, "trial_balance_hash"> = {
    settlement_asset: result.settlement_asset,
    journal_policy_version: REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_JOURNAL_POLICY_VERSION,
    source_cycle_accounting_policy_version: REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ACCOUNTING_POLICY_VERSION,
    total_debits: totalDebits,
    total_credits: totalCredits,
    balances,
    opening_equity_posting_count: 1,
    initial_cash: result.initial_cash,
    ending_available_cash: result.ending_available_cash,
    ending_reserved_isolated_collateral: 0,
    ending_settled_cash: result.ending_available_cash,
    ending_unrealized_pnl: 0,
    ending_portfolio_nav: result.ending_portfolio_nav,
    balanced: true,
  }
  return { ...body,
    trial_balance_hash: replayPortfolioProtectiveTerminalCycleSequenceTrialBalanceHash(body) }
}
