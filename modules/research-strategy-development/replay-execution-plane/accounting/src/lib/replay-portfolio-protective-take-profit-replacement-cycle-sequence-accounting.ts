import {
  REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_CYCLE_SEQUENCE_EVIDENCE_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_CYCLE_SEQUENCE_JOURNAL_POLICY_VERSION,
  REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_CYCLE_SEQUENCE_LIMITATIONS,
  REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_CYCLE_SEQUENCE_POLICY_VERSION,
  assertReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceEvidence,
  replayPortfolioProtectiveTakeProfitReplacementCycleCommitHash,
  replayPortfolioProtectiveTakeProfitReplacementCycleSequenceEvidenceHash,
  replayPortfolioProtectiveTakeProfitReplacementCycleSequenceFingerprintHash,
  replayPortfolioProtectiveTakeProfitReplacementCycleSequenceJournalEntryHash,
  replayPortfolioProtectiveTakeProfitReplacementCycleSequenceLedgerEntryHash,
  replayPortfolioProtectiveTakeProfitReplacementCycleSequenceTrialBalanceHash,
  type ReplayPortfolioProtectiveTakeProfitReplacementCycleCommit,
  type ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceEvidence,
  type ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceFingerprint,
  type ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceJournalEntry,
  type ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceLedgerEntry,
  type ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceTrialBalance,
  type ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceAuthority,
  type ReplayPortfolioProtectiveTakeProfitReplacementCycleSource,
} from "../../../contracts/src/lib/replay-portfolio-protective-take-profit-replacement-cycle-sequence-contracts"
import {
  REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_ACCOUNTING_POLICY_VERSION,
  type ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingJournalAccount,
} from "../../../contracts/src/lib/replay-portfolio-protective-take-profit-replacement-terminal-accounting-contracts"
import type { ReplayPortfolioCycleSequencePlan } from
  "../../../contracts/src/lib/replay-portfolio-cycle-sequence-contracts"
import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import { addReplayDecimalValues } from "../../../contracts/src/lib/replay-decimal"

const ACCOUNTS: ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingJournalAccount[] = [
  "wallet_cash", "isolated_margin_collateral", "position_valuation", "opening_equity",
  "realized_pnl_income", "realized_pnl_loss", "funding_income", "funding_expense",
  "fee_expense", "liquidation_fee_expense", "unrealized_pnl_income", "unrealized_pnl_loss",
]
const CREDIT_NORMAL = new Set<ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingJournalAccount>([
  "opening_equity", "realized_pnl_income", "funding_income", "unrealized_pnl_income",
])

export interface ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceAccountingInput {
  plan: ReplayPortfolioCycleSequencePlan
  reservation: ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceAuthority
  cycles: ReplayPortfolioProtectiveTakeProfitReplacementCycleSource[]
}

export function createReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceEvidence(
  input: ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceAccountingInput,
): ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceEvidence {
  const commits = createCommits(input.cycles)
  const ledger: ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceLedgerEntry[] = []
  const journal: ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceJournalEntry[] = []
  for (const cycle of input.cycles) {
    for (const cycleEntry of cycle.accounting_evidence.ledger) {
      const body: Omit<ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceLedgerEntry,
        "sequence_entry_hash"> = {
          global_ledger_sequence: ledger.length + 1,
          cycle_index: cycle.cycle_index,
          cycle_ledger_entry_hash: cycleEntry.ledger_entry_hash,
          cycle_entry: structuredClone(cycleEntry),
        }
      ledger.push({ ...body,
        sequence_entry_hash: replayPortfolioProtectiveTakeProfitReplacementCycleSequenceLedgerEntryHash(body) })
    }
    const openings = cycle.accounting_evidence.journal.filter((entry) => entry.posting_kind === "opening_cash")
    if (openings.length !== 1 || cycle.accounting_evidence.journal[0]?.posting_kind !== "opening_cash") {
      throw new Error(`Replacement cycle ${cycle.cycle_index} opening Journal is invalid`)
    }
    for (const cycleEntry of cycle.accounting_evidence.journal) {
      if (cycle.cycle_index > 1 && cycleEntry.posting_kind === "opening_cash") continue
      const body: Omit<ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceJournalEntry,
        "sequence_entry_hash"> = {
          global_journal_sequence: journal.length + 1,
          cycle_index: cycle.cycle_index,
          cycle_journal_entry_hash: cycleEntry.journal_entry_hash,
          cycle_entry: structuredClone(cycleEntry),
        }
      journal.push({ ...body,
        sequence_entry_hash: replayPortfolioProtectiveTakeProfitReplacementCycleSequenceJournalEntryHash(body) })
    }
  }
  const endingCash = commits.at(-1)!.ending_available_cash
  const trialBalance = createTrialBalance(input.reservation, endingCash, journal)
  const fingerprintBody: Omit<ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceFingerprint,
    "fingerprint_hash"> = {
      experiment_id: input.reservation.experiment_id,
      trial_group_id: input.reservation.trial_group_id,
      trial_group_hash: input.reservation.trial_group_hash,
      portfolio_id: input.reservation.portfolio_id,
      sequence_plan_hash: input.plan.plan_hash,
      sequence_reservation_hash: input.reservation.reservation_hash,
      policy_version: REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_CYCLE_SEQUENCE_POLICY_VERSION,
      cycle_commits_hash: canonicalHash(commits),
      consolidated_ledger_hash: canonicalHash(ledger),
      consolidated_journal_hash: canonicalHash(journal),
      consolidated_trial_balance_hash: trialBalance.trial_balance_hash,
      limitations_hash: canonicalHash(
        REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_CYCLE_SEQUENCE_LIMITATIONS,
      ),
    }
  const fingerprint = { ...fingerprintBody,
    fingerprint_hash:
      replayPortfolioProtectiveTakeProfitReplacementCycleSequenceFingerprintHash(fingerprintBody) }
  const body: Omit<ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceEvidence, "evidence_hash"> = {
    schema_version: REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_CYCLE_SEQUENCE_EVIDENCE_SCHEMA_VERSION,
    policy_version: REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_CYCLE_SEQUENCE_POLICY_VERSION,
    experiment_id: input.reservation.experiment_id,
    trial_group_id: input.reservation.trial_group_id,
    trial_group_hash: input.reservation.trial_group_hash,
    portfolio_id: input.reservation.portfolio_id,
    sequence_plan_hash: input.plan.plan_hash,
    sequence_reservation_hash: input.reservation.reservation_hash,
    settlement_asset: input.reservation.settlement_asset,
    cycle_count: commits.length,
    cycle_commits: commits,
    cycle_commits_hash: canonicalHash(commits),
    consolidated_ledger: ledger,
    consolidated_journal: journal,
    consolidated_trial_balance: trialBalance,
    initial_cash: input.reservation.initial_cash,
    ending_available_cash: endingCash,
    ending_reserved_isolated_collateral: 0,
    ending_unrealized_pnl: 0,
    ending_portfolio_nav: endingCash,
    limitations: REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_CYCLE_SEQUENCE_LIMITATIONS,
    fingerprint,
  }
  const evidence = { ...body,
    evidence_hash: replayPortfolioProtectiveTakeProfitReplacementCycleSequenceEvidenceHash(body) }
  assertReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceEvidence(evidence, input)
  return evidence
}

function createCommits(
  cycles: ReplayPortfolioProtectiveTakeProfitReplacementCycleSource[],
): ReplayPortfolioProtectiveTakeProfitReplacementCycleCommit[] {
  return cycles.map((cycle) => {
    const terminal = cycle.replacement_terminal_evidence
    const accounting = cycle.accounting_evidence
    const closeTimes = terminal.lane_records.flatMap((record) =>
      record.terminal_time ? [record.terminal_time] : [])
    if (closeTimes.length === 0 || terminal.lane_records.some((record) => record.ending_open)
        || terminal.ending_reserved_isolated_collateral !== 0 || terminal.ending_unrealized_pnl !== 0
        || accounting.trial_balance.ending_reserved_isolated_collateral !== 0
        || accounting.trial_balance.ending_unrealized_pnl !== 0) {
      throw new Error(`Replacement cycle ${cycle.cycle_index} is not full-flat`)
    }
    const body: Omit<ReplayPortfolioProtectiveTakeProfitReplacementCycleCommit, "cycle_commit_hash"> = {
      cycle_index: cycle.cycle_index,
      opening_available_cash: accounting.shared_initial_cash,
      replacement_terminal_evidence_hash: terminal.evidence_hash,
      replacement_terminal_artifact_manifest_hash: cycle.replacement_terminal_manifest.manifest_hash,
      replacement_terminal_accounting_evidence_hash: accounting.evidence_hash,
      replacement_terminal_accounting_artifact_manifest_hash: cycle.accounting_manifest.manifest_hash,
      risk_result_hash: accounting.risk_result_hash,
      terminal_owner_set_hash: canonicalHash(terminal.lane_records.map((record) => ({
        lane_id: record.lane_id,
        owner: record.owner,
        generation: record.active_protection_generation,
        terminal_source_hash: record.terminal_source_hash,
      }))),
      full_flat_close_time: closeTimes.sort((left, right) => Date.parse(left) - Date.parse(right)).at(-1)!,
      ending_available_cash: accounting.trial_balance.ending_available_cash,
      trial_balance_hash: accounting.trial_balance.trial_balance_hash,
    }
    return { ...body, cycle_commit_hash: replayPortfolioProtectiveTakeProfitReplacementCycleCommitHash(body) }
  })
}

function createTrialBalance(
  reservation: ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceAuthority,
  endingCash: number,
  journal: ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceJournalEntry[],
): ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceTrialBalance {
  const raw = Object.fromEntries(ACCOUNTS.map((account) => [account, 0])) as
    Record<ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingJournalAccount, number>
  let totalDebits = 0
  let totalCredits = 0
  for (const entry of journal) for (const leg of entry.cycle_entry.legs) {
    totalDebits = addReplayDecimalValues(totalDebits, leg.debit)
    totalCredits = addReplayDecimalValues(totalCredits, leg.credit)
    raw[leg.account] = addReplayDecimalValues(raw[leg.account], leg.debit, -leg.credit)
  }
  const balances = Object.fromEntries(ACCOUNTS.map((account) => [
    account, CREDIT_NORMAL.has(account) ? -raw[account] : raw[account],
  ])) as Record<ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingJournalAccount, number>
  const body: Omit<ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceTrialBalance,
    "trial_balance_hash"> = {
      settlement_asset: reservation.settlement_asset,
      journal_policy_version:
        REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_CYCLE_SEQUENCE_JOURNAL_POLICY_VERSION,
      source_cycle_accounting_policy_version:
        REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_ACCOUNTING_POLICY_VERSION,
      total_debits: totalDebits,
      total_credits: totalCredits,
      balances,
      opening_equity_posting_count: 1,
      initial_cash: reservation.initial_cash,
      ending_available_cash: endingCash,
      ending_reserved_isolated_collateral: 0,
      ending_settled_cash: endingCash,
      ending_unrealized_pnl: 0,
      ending_portfolio_nav: endingCash,
      balanced: true,
    }
  return { ...body,
    trial_balance_hash: replayPortfolioProtectiveTakeProfitReplacementCycleSequenceTrialBalanceHash(body) }
}
