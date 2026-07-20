import {
  REPLAY_PORTFOLIO_FIXED_PARTIAL_CYCLE_SEQUENCE_EVIDENCE_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_FIXED_PARTIAL_CYCLE_SEQUENCE_LIMITATIONS,
  REPLAY_PORTFOLIO_FIXED_PARTIAL_CYCLE_SEQUENCE_POLICY_VERSION,
  assertReplayPortfolioFixedPartialCycleSequenceEvidence,
  replayPortfolioFixedPartialCycleCommitHash,
  replayPortfolioFixedPartialCycleJournalEntryHash,
  replayPortfolioFixedPartialCycleLedgerEntryHash,
  replayPortfolioFixedPartialCycleSequenceEvidenceHash,
  type ReplayPortfolioFixedPartialCycleSequenceEvidence,
} from "../../../contracts/src/lib/replay-portfolio-fixed-partial-cycle-sequence-contracts"
import {
  REPLAY_PORTFOLIO_FIXED_PARTIAL_TERMINAL_ACCOUNTING_POLICY_VERSION,
  replayPortfolioFixedPartialAccountingTrialBalanceHash,
  type ReplayPortfolioFixedPartialJournalAccount,
  type ReplayPortfolioFixedPartialTerminalAccountingEvidence,
  type ReplayPortfolioFixedPartialTerminalAccountingArtifactManifest,
} from "../../../contracts/src/lib/replay-portfolio-fixed-partial-terminal-accounting-contracts"
import type {
  ReplayPortfolioFixedPartialTerminalArtifactManifest,
  ReplayPortfolioFixedPartialTerminalEvidence,
} from "../../../contracts/src/lib/replay-portfolio-fixed-partial-terminal-contracts"
import type { ReplayPortfolioCycleSequencePlan } from
  "../../../contracts/src/lib/replay-portfolio-cycle-sequence-contracts"
import type { ReplayPortfolioCycleSequenceReservationSnapshot } from
  "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import { addReplayDecimalValues } from "../../../contracts/src/lib/replay-decimal"

const ACCOUNTS: ReplayPortfolioFixedPartialJournalAccount[] = ["wallet_cash", "isolated_margin_collateral",
  "position_valuation", "opening_equity", "realized_pnl_income", "realized_pnl_loss", "funding_income",
  "funding_expense", "fee_expense", "liquidation_fee_expense", "unrealized_pnl_income", "unrealized_pnl_loss"]
const CREDIT = new Set<ReplayPortfolioFixedPartialJournalAccount>([
  "opening_equity", "realized_pnl_income", "funding_income", "unrealized_pnl_income"])
export interface ReplayPortfolioFixedPartialCycleSource {
  cycle_index: number; terminal_evidence: ReplayPortfolioFixedPartialTerminalEvidence
  terminal_manifest: ReplayPortfolioFixedPartialTerminalArtifactManifest
  accounting_evidence: ReplayPortfolioFixedPartialTerminalAccountingEvidence
  accounting_manifest: ReplayPortfolioFixedPartialTerminalAccountingArtifactManifest
}
export function createReplayPortfolioFixedPartialCycleSequenceEvidence(input: {
  plan: ReplayPortfolioCycleSequencePlan; reservation: ReplayPortfolioCycleSequenceReservationSnapshot
  cycles: ReplayPortfolioFixedPartialCycleSource[]
}): ReplayPortfolioFixedPartialCycleSequenceEvidence {
  const commits = input.cycles.map((cycle) => {
    const terminal = cycle.terminal_evidence; const accounting = cycle.accounting_evidence
    const times = terminal.lane_records.flatMap((record) => record.terminal_time ? [record.terminal_time] : [])
    if (terminal.lane_records.some((record) => record.ending_open)
        || terminal.ending_reserved_isolated_collateral !== 0 || terminal.ending_gross_mark_exposure !== 0
        || terminal.ending_net_mark_exposure !== 0 || terminal.ending_portfolio_frozen_stop_risk !== 0
        || times.length === 0) throw new Error(`Fixed-partial cycle ${cycle.cycle_index} is not full-flat`)
    const body = { cycle_index: cycle.cycle_index, opening_available_cash: accounting.shared_initial_cash,
      terminal_evidence_hash: terminal.evidence_hash, terminal_artifact_manifest_hash: cycle.terminal_manifest.manifest_hash,
      accounting_evidence_hash: accounting.evidence_hash,
      accounting_artifact_manifest_hash: cycle.accounting_manifest.manifest_hash,
      lane_result_hashes_hash: canonicalHash(terminal.lane_result_hashes),
      terminal_owner_set_hash: canonicalHash(terminal.lane_records.map((record) => ({ lane_id: record.lane_id,
        owner: record.owner, partial_status: record.partial_status, terminal_source_hash: record.terminal_source_hash }))),
      full_flat_close_time: times.sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1)!,
      ending_available_cash: accounting.trial_balance.ending_available_cash,
      trial_balance_hash: accounting.trial_balance.trial_balance_hash }
    return { ...body, cycle_commit_hash: replayPortfolioFixedPartialCycleCommitHash(body) }
  })
  const ledger = input.cycles.flatMap((cycle) => cycle.accounting_evidence.ledger.map((cycleEntry) => {
    const body = { global_ledger_sequence: 0, cycle_index: cycle.cycle_index,
      cycle_ledger_entry_hash: cycleEntry.ledger_entry_hash, cycle_entry: structuredClone(cycleEntry) }
    return body
  })).map((item, index) => { const body = { ...item, global_ledger_sequence: index + 1 }
    return { ...body, sequence_entry_hash: replayPortfolioFixedPartialCycleLedgerEntryHash(body) } })
  const journal = input.cycles.flatMap((cycle) => cycle.accounting_evidence.journal
    .filter((entry) => cycle.cycle_index === 1 || entry.posting_kind !== "opening_cash")
    .map((cycleEntry) => ({ global_journal_sequence: 0, cycle_index: cycle.cycle_index,
      cycle_journal_entry_hash: cycleEntry.journal_entry_hash, cycle_entry: structuredClone(cycleEntry) })))
    .map((item, index) => { const body = { ...item, global_journal_sequence: index + 1 }
      return { ...body, sequence_entry_hash: replayPortfolioFixedPartialCycleJournalEntryHash(body) } })
  const raw = Object.fromEntries(ACCOUNTS.map((account) => [account, 0])) as Record<ReplayPortfolioFixedPartialJournalAccount, number>
  let debits = 0; let credits = 0
  for (const entry of journal) for (const leg of entry.cycle_entry.legs) { debits = addReplayDecimalValues(debits, leg.debit)
    credits = addReplayDecimalValues(credits, leg.credit); raw[leg.account] = addReplayDecimalValues(raw[leg.account], leg.debit, -leg.credit) }
  const balances = Object.fromEntries(ACCOUNTS.map((account) => [account, CREDIT.has(account) ? -raw[account] : raw[account]])) as
    Record<ReplayPortfolioFixedPartialJournalAccount, number>
  const ending = commits.at(-1)!.ending_available_cash
  const balanceBody = { settlement_asset: input.reservation.settlement_asset,
    accounting_policy_version: REPLAY_PORTFOLIO_FIXED_PARTIAL_TERMINAL_ACCOUNTING_POLICY_VERSION,
    total_debits: debits, total_credits: credits, balances, ending_available_cash: ending,
    ending_reserved_isolated_collateral: 0, ending_settled_cash: ending, ending_unrealized_pnl: 0,
    ending_portfolio_nav: ending, balanced: true as const, opening_equity_posting_count: 1 as const }
  const trialBalance = { ...balanceBody, trial_balance_hash: replayPortfolioFixedPartialAccountingTrialBalanceHash(balanceBody) }
  const fingerprintBody = { cycle_commits_hash: canonicalHash(commits), consolidated_ledger_hash: canonicalHash(ledger),
    consolidated_journal_hash: canonicalHash(journal), consolidated_trial_balance_hash: trialBalance.trial_balance_hash,
    limitations_hash: canonicalHash(REPLAY_PORTFOLIO_FIXED_PARTIAL_CYCLE_SEQUENCE_LIMITATIONS) }
  const fingerprint = { ...fingerprintBody, fingerprint_hash: canonicalHash(fingerprintBody) }
  const body: Omit<ReplayPortfolioFixedPartialCycleSequenceEvidence, "evidence_hash"> = {
    schema_version: REPLAY_PORTFOLIO_FIXED_PARTIAL_CYCLE_SEQUENCE_EVIDENCE_SCHEMA_VERSION,
    policy_version: REPLAY_PORTFOLIO_FIXED_PARTIAL_CYCLE_SEQUENCE_POLICY_VERSION,
    experiment_id: input.reservation.experiment_id, trial_group_id: input.reservation.trial_group_id,
    trial_group_hash: input.reservation.trial_group_hash, portfolio_id: input.reservation.portfolio_id,
    sequence_plan_hash: input.plan.plan_hash, sequence_reservation_hash: input.reservation.reservation_hash,
    settlement_asset: input.reservation.settlement_asset, cycle_count: commits.length, cycle_commits: commits,
    cycle_commits_hash: canonicalHash(commits), consolidated_ledger: ledger, consolidated_journal: journal,
    consolidated_trial_balance: trialBalance, initial_cash: input.reservation.initial_cash,
    ending_available_cash: ending, ending_reserved_isolated_collateral: 0, ending_unrealized_pnl: 0,
    ending_portfolio_nav: ending, limitations: REPLAY_PORTFOLIO_FIXED_PARTIAL_CYCLE_SEQUENCE_LIMITATIONS, fingerprint }
  const evidence = { ...body, evidence_hash: replayPortfolioFixedPartialCycleSequenceEvidenceHash(body) }
  assertReplayPortfolioFixedPartialCycleSequenceEvidence(evidence); return evidence
}
