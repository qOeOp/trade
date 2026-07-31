import {
  REPLAY_PORTFOLIO_PROTECTIVE_STRATEGY_EXIT_CANCEL_CYCLE_SEQUENCE_EVIDENCE_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_PROTECTIVE_STRATEGY_EXIT_CANCEL_CYCLE_SEQUENCE_JOURNAL_POLICY_VERSION,
  REPLAY_PORTFOLIO_PROTECTIVE_STRATEGY_EXIT_CANCEL_CYCLE_SEQUENCE_LIMITATIONS,
  REPLAY_PORTFOLIO_PROTECTIVE_STRATEGY_EXIT_CANCEL_CYCLE_SEQUENCE_POLICY_VERSION,
  assertReplayPortfolioProtectiveStrategyExitCancelCycleSequenceEvidence,
  replayPortfolioProtectiveStrategyExitCancelCycleCommitHash,
  replayPortfolioProtectiveStrategyExitCancelCycleSequenceEvidenceHash,
  replayPortfolioProtectiveStrategyExitCancelCycleSequenceFingerprintHash,
  replayPortfolioProtectiveStrategyExitCancelCycleSequenceJournalEntryHash,
  replayPortfolioProtectiveStrategyExitCancelCycleSequenceLedgerEntryHash,
  replayPortfolioProtectiveStrategyExitCancelCycleSequenceTrialBalanceHash,
  type ReplayPortfolioProtectiveStrategyExitCancelCycleCommit,
  type ReplayPortfolioProtectiveStrategyExitCancelCycleSequenceAuthority,
  type ReplayPortfolioProtectiveStrategyExitCancelCycleSequenceEvidence,
  type ReplayPortfolioProtectiveStrategyExitCancelCycleSequenceFingerprint,
  type ReplayPortfolioProtectiveStrategyExitCancelCycleSequenceJournalEntry,
  type ReplayPortfolioProtectiveStrategyExitCancelCycleSequenceLedgerEntry,
  type ReplayPortfolioProtectiveStrategyExitCancelCycleSequenceTrialBalance,
  type ReplayPortfolioProtectiveStrategyExitCancelCycleSource,
} from "../../../contracts/src/lib/replay-portfolio-protective-strategy-exit-cancel-cycle-sequence-contracts"
import {
  REPLAY_PORTFOLIO_PROTECTIVE_STRATEGY_EXIT_CANCEL_TERMINAL_ACCOUNTING_POLICY_VERSION,
  type ReplayPortfolioProtectiveStrategyExitCancelTerminalAccountingJournalAccount,
} from "../../../contracts/src/lib/replay-portfolio-protective-strategy-exit-cancel-terminal-accounting-contracts"
import type { ReplayPortfolioCycleSequencePlan } from
  "../../../contracts/src/lib/replay-portfolio-cycle-sequence-contracts"
import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import { addReplayDecimalValues } from "../../../contracts/src/lib/replay-decimal"

const ACCOUNTS: ReplayPortfolioProtectiveStrategyExitCancelTerminalAccountingJournalAccount[] = [
  "wallet_cash", "isolated_margin_collateral", "position_valuation", "opening_equity",
  "realized_pnl_income", "realized_pnl_loss", "funding_income", "funding_expense",
  "fee_expense", "liquidation_fee_expense", "unrealized_pnl_income", "unrealized_pnl_loss",
]
const CREDIT_NORMAL = new Set<ReplayPortfolioProtectiveStrategyExitCancelTerminalAccountingJournalAccount>([
  "opening_equity", "realized_pnl_income", "funding_income", "unrealized_pnl_income",
])
export interface ReplayPortfolioProtectiveStrategyExitCancelCycleSequenceAccountingInput {
  plan: ReplayPortfolioCycleSequencePlan
  reservation: ReplayPortfolioProtectiveStrategyExitCancelCycleSequenceAuthority
  cycles: ReplayPortfolioProtectiveStrategyExitCancelCycleSource[]
}

export function createReplayPortfolioProtectiveStrategyExitCancelCycleSequenceEvidence(
  input: ReplayPortfolioProtectiveStrategyExitCancelCycleSequenceAccountingInput,
): ReplayPortfolioProtectiveStrategyExitCancelCycleSequenceEvidence {
  const commits = createCommits(input.cycles)
  const ledger: ReplayPortfolioProtectiveStrategyExitCancelCycleSequenceLedgerEntry[] = []
  const journal: ReplayPortfolioProtectiveStrategyExitCancelCycleSequenceJournalEntry[] = []
  for (const cycle of input.cycles) {
    for (const cycleEntry of cycle.accounting_evidence.ledger) {
      const body = { global_ledger_sequence: ledger.length + 1, cycle_index: cycle.cycle_index,
        cycle_ledger_entry_hash: cycleEntry.ledger_entry_hash, cycle_entry: structuredClone(cycleEntry) }
      ledger.push({ ...body,
        sequence_entry_hash: replayPortfolioProtectiveStrategyExitCancelCycleSequenceLedgerEntryHash(body) })
    }
    const openings = cycle.accounting_evidence.journal.filter((entry) => entry.posting_kind === "opening_cash")
    if (openings.length !== 1 || cycle.accounting_evidence.journal[0]?.posting_kind !== "opening_cash") {
      throw new Error(`Cancel cycle ${cycle.cycle_index} opening Journal is invalid`)
    }
    for (const cycleEntry of cycle.accounting_evidence.journal) {
      if (cycle.cycle_index > 1 && cycleEntry.posting_kind === "opening_cash") continue
      const body = { global_journal_sequence: journal.length + 1, cycle_index: cycle.cycle_index,
        cycle_journal_entry_hash: cycleEntry.journal_entry_hash, cycle_entry: structuredClone(cycleEntry) }
      journal.push({ ...body,
        sequence_entry_hash: replayPortfolioProtectiveStrategyExitCancelCycleSequenceJournalEntryHash(body) })
    }
  }
  const endingCash = commits.at(-1)!.ending_available_cash
  const trialBalance = createTrialBalance(input.reservation, endingCash, journal)
  const fingerprintBody: Omit<ReplayPortfolioProtectiveStrategyExitCancelCycleSequenceFingerprint,
    "fingerprint_hash"> = {
      experiment_id: input.reservation.experiment_id, trial_group_id: input.reservation.trial_group_id,
      trial_group_hash: input.reservation.trial_group_hash, portfolio_id: input.reservation.portfolio_id,
      sequence_plan_hash: input.plan.plan_hash, sequence_reservation_hash: input.reservation.reservation_hash,
      policy_version: REPLAY_PORTFOLIO_PROTECTIVE_STRATEGY_EXIT_CANCEL_CYCLE_SEQUENCE_POLICY_VERSION,
      cycle_commits_hash: canonicalHash(commits), consolidated_ledger_hash: canonicalHash(ledger),
      consolidated_journal_hash: canonicalHash(journal),
      consolidated_trial_balance_hash: trialBalance.trial_balance_hash,
      limitations_hash: canonicalHash(REPLAY_PORTFOLIO_PROTECTIVE_STRATEGY_EXIT_CANCEL_CYCLE_SEQUENCE_LIMITATIONS),
    }
  const fingerprint = { ...fingerprintBody,
    fingerprint_hash: replayPortfolioProtectiveStrategyExitCancelCycleSequenceFingerprintHash(fingerprintBody) }
  const body: Omit<ReplayPortfolioProtectiveStrategyExitCancelCycleSequenceEvidence, "evidence_hash"> = {
    schema_version: REPLAY_PORTFOLIO_PROTECTIVE_STRATEGY_EXIT_CANCEL_CYCLE_SEQUENCE_EVIDENCE_SCHEMA_VERSION,
    policy_version: REPLAY_PORTFOLIO_PROTECTIVE_STRATEGY_EXIT_CANCEL_CYCLE_SEQUENCE_POLICY_VERSION,
    experiment_id: input.reservation.experiment_id, trial_group_id: input.reservation.trial_group_id,
    trial_group_hash: input.reservation.trial_group_hash, portfolio_id: input.reservation.portfolio_id,
    sequence_plan_hash: input.plan.plan_hash, sequence_reservation_hash: input.reservation.reservation_hash,
    settlement_asset: input.reservation.settlement_asset, cycle_count: commits.length,
    cycle_commits: commits, cycle_commits_hash: canonicalHash(commits), consolidated_ledger: ledger,
    consolidated_journal: journal, consolidated_trial_balance: trialBalance,
    initial_cash: input.reservation.initial_cash, ending_available_cash: endingCash,
    ending_reserved_isolated_collateral: 0, ending_unrealized_pnl: 0, ending_portfolio_nav: endingCash,
    limitations: REPLAY_PORTFOLIO_PROTECTIVE_STRATEGY_EXIT_CANCEL_CYCLE_SEQUENCE_LIMITATIONS, fingerprint,
  }
  const evidence = { ...body,
    evidence_hash: replayPortfolioProtectiveStrategyExitCancelCycleSequenceEvidenceHash(body) }
  assertReplayPortfolioProtectiveStrategyExitCancelCycleSequenceEvidence(evidence, input)
  return evidence
}

function createCommits(cycles: ReplayPortfolioProtectiveStrategyExitCancelCycleSource[]):
ReplayPortfolioProtectiveStrategyExitCancelCycleCommit[] {
  return cycles.map((cycle) => {
    const terminal = cycle.cancel_terminal_evidence; const accounting = cycle.accounting_evidence
    const closeTimes = terminal.lane_records.flatMap((record) => record.terminal_time ? [record.terminal_time] : [])
    if (closeTimes.length === 0 || terminal.lane_records.some((record) => record.ending_open)
        || terminal.ending_reserved_isolated_collateral !== 0 || terminal.ending_unrealized_pnl !== 0
        || accounting.trial_balance.ending_reserved_isolated_collateral !== 0
        || accounting.trial_balance.ending_unrealized_pnl !== 0) {
      throw new Error(`Cancel cycle ${cycle.cycle_index} is not full-flat`)
    }
    const body: Omit<ReplayPortfolioProtectiveStrategyExitCancelCycleCommit, "cycle_commit_hash"> = {
      cycle_index: cycle.cycle_index, opening_available_cash: accounting.shared_initial_cash,
      cancel_terminal_evidence_hash: terminal.evidence_hash,
      cancel_terminal_artifact_manifest_hash: cycle.cancel_terminal_manifest.manifest_hash,
      cancel_terminal_accounting_evidence_hash: accounting.evidence_hash,
      cancel_terminal_accounting_artifact_manifest_hash: cycle.accounting_manifest.manifest_hash,
      risk_result_hash: accounting.risk_result_hash,
      terminal_owner_set_hash: canonicalHash(terminal.lane_records.map((record) => ({ lane_id: record.lane_id,
        owner: record.owner, protection_mode: record.active_protection_mode,
        terminal_source_hash: record.terminal_source_hash }))),
      full_flat_close_time: closeTimes.sort((left, right) => Date.parse(left) - Date.parse(right)).at(-1)!,
      ending_available_cash: accounting.trial_balance.ending_available_cash,
      trial_balance_hash: accounting.trial_balance.trial_balance_hash,
    }
    return { ...body, cycle_commit_hash: replayPortfolioProtectiveStrategyExitCancelCycleCommitHash(body) }
  })
}
function createTrialBalance(reservation: ReplayPortfolioProtectiveStrategyExitCancelCycleSequenceAuthority,
  endingCash: number, journal: ReplayPortfolioProtectiveStrategyExitCancelCycleSequenceJournalEntry[]):
ReplayPortfolioProtectiveStrategyExitCancelCycleSequenceTrialBalance {
  const raw = Object.fromEntries(ACCOUNTS.map((account) => [account, 0])) as
    Record<ReplayPortfolioProtectiveStrategyExitCancelTerminalAccountingJournalAccount, number>
  let totalDebits = 0; let totalCredits = 0
  for (const entry of journal) for (const leg of entry.cycle_entry.legs) {
    totalDebits = addReplayDecimalValues(totalDebits, leg.debit)
    totalCredits = addReplayDecimalValues(totalCredits, leg.credit)
    raw[leg.account] = addReplayDecimalValues(raw[leg.account], leg.debit, -leg.credit)
  }
  const balances = Object.fromEntries(ACCOUNTS.map((account) => [account,
    CREDIT_NORMAL.has(account) ? -raw[account] : raw[account]])) as
    Record<ReplayPortfolioProtectiveStrategyExitCancelTerminalAccountingJournalAccount, number>
  const body: Omit<ReplayPortfolioProtectiveStrategyExitCancelCycleSequenceTrialBalance, "trial_balance_hash"> = {
    settlement_asset: reservation.settlement_asset,
    journal_policy_version: REPLAY_PORTFOLIO_PROTECTIVE_STRATEGY_EXIT_CANCEL_CYCLE_SEQUENCE_JOURNAL_POLICY_VERSION,
    source_cycle_accounting_policy_version:
      REPLAY_PORTFOLIO_PROTECTIVE_STRATEGY_EXIT_CANCEL_TERMINAL_ACCOUNTING_POLICY_VERSION,
    total_debits: totalDebits, total_credits: totalCredits, balances, opening_equity_posting_count: 1,
    initial_cash: reservation.initial_cash, ending_available_cash: endingCash,
    ending_reserved_isolated_collateral: 0, ending_settled_cash: endingCash,
    ending_unrealized_pnl: 0, ending_portfolio_nav: endingCash, balanced: true,
  }
  return { ...body, trial_balance_hash: replayPortfolioProtectiveStrategyExitCancelCycleSequenceTrialBalanceHash(body) }
}
