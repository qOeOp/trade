import {
  REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_CYCLE_SEQUENCE_EVIDENCE_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_CYCLE_SEQUENCE_LIMITATIONS,
  REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_CYCLE_SEQUENCE_POLICY_VERSION,
  assertReplayPortfolioTwoFixedPartialCycleSequenceEvidence,
  replayPortfolioTwoFixedPartialCycleCommitHash,
  replayPortfolioTwoFixedPartialCycleJournalEntryHash,
  replayPortfolioTwoFixedPartialCycleLedgerEntryHash,
  replayPortfolioTwoFixedPartialCycleSequenceEvidenceHash,
  type ReplayPortfolioTwoFixedPartialCycleSequenceEvidence,
} from "../../../contracts/src/lib/replay-portfolio-two-fixed-partial-cycle-sequence-contracts"
import {
  REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_ACCOUNTING_POLICY_VERSION,
  replayPortfolioTwoFixedPartialAccountingTrialBalanceHash,
  type ReplayPortfolioTwoFixedPartialAccountingArtifactManifest,
  type ReplayPortfolioTwoFixedPartialAccountingEvidence,
  type ReplayPortfolioTwoFixedPartialJournalAccount,
} from "../../../contracts/src/lib/replay-portfolio-two-fixed-partial-accounting-contracts"
import type { ReplayPortfolioTwoFixedPartialTerminalEvidence } from
  "../../../contracts/src/lib/replay-portfolio-two-fixed-partial-terminal-contracts"
import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import { addReplayDecimalValues } from "../../../contracts/src/lib/replay-decimal"

const ACCOUNTS: ReplayPortfolioTwoFixedPartialJournalAccount[] = [
  "wallet_cash", "isolated_margin_collateral", "position_valuation", "opening_equity",
  "realized_pnl_income", "realized_pnl_loss", "funding_income", "funding_expense", "fee_expense",
  "liquidation_fee_expense", "unrealized_pnl_income", "unrealized_pnl_loss",
]
const CREDIT_NORMAL = new Set<ReplayPortfolioTwoFixedPartialJournalAccount>([
  "opening_equity", "realized_pnl_income", "funding_income", "unrealized_pnl_income",
])
export interface ReplayPortfolioTwoFixedPartialCycleSequenceAuthorityBinding {
  reservation_hash: string
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  portfolio_id: string
  settlement_asset: string
  initial_cash: number
  cycles: Array<{ cycle_index: number; two_fixed_partial_reservation_hash: string }>
}
export interface ReplayPortfolioTwoFixedPartialCycleSource {
  cycle_index: number
  child_reservation_hash: string
  terminal_evidence: ReplayPortfolioTwoFixedPartialTerminalEvidence
  accounting_evidence: ReplayPortfolioTwoFixedPartialAccountingEvidence
  accounting_manifest: ReplayPortfolioTwoFixedPartialAccountingArtifactManifest
}

export function createReplayPortfolioTwoFixedPartialCycleSequenceEvidence(input: {
  authority: ReplayPortfolioTwoFixedPartialCycleSequenceAuthorityBinding
  cycles: ReplayPortfolioTwoFixedPartialCycleSource[]
}): ReplayPortfolioTwoFixedPartialCycleSequenceEvidence {
  if (input.cycles.length !== input.authority.cycles.length || input.cycles.length < 1
      || input.cycles.length > 8) throw new Error("P27 cycle source coverage drift")
  const commits = input.cycles.map((cycle, index) => {
    const declared = input.authority.cycles[index]!
    const terminal = cycle.terminal_evidence; const accounting = cycle.accounting_evidence
    const times = terminal.lane_records.flatMap((record) => record.terminal_time ? [record.terminal_time] : [])
    if (cycle.cycle_index !== index + 1 || declared.cycle_index !== cycle.cycle_index
        || cycle.child_reservation_hash !== declared.two_fixed_partial_reservation_hash
        || accounting.reservation_hash !== cycle.child_reservation_hash
        || accounting.terminal_evidence_hash !== terminal.evidence_hash
        || cycle.accounting_manifest.accounting_evidence_hash !== accounting.evidence_hash
        || cycle.accounting_manifest.terminal_evidence_hash !== terminal.evidence_hash
        || terminal.lane_records.some((record) => record.ending_open)
        || terminal.ending_reserved_isolated_collateral !== 0 || terminal.ending_gross_mark_exposure !== 0
        || terminal.ending_net_mark_exposure !== 0 || terminal.ending_active_stop_bounded_risk !== 0
        || terminal.ending_unrealized_pnl !== 0 || times.length !== terminal.lane_records.length
        || accounting.trial_balance.ending_reserved_isolated_collateral !== 0
        || accounting.trial_balance.ending_unrealized_pnl !== 0) {
      throw new Error(`P27 cycle ${cycle.cycle_index} is not a committed full-flat child`)
    }
    const opening = accounting.shared_initial_cash
    const expectedOpening = index === 0 ? input.authority.initial_cash
      : input.cycles[index - 1]!.accounting_evidence.trial_balance.ending_available_cash
    if (opening !== expectedOpening) throw new Error(`P27 cycle ${cycle.cycle_index} cash bridge drift`)
    const body = { cycle_index: cycle.cycle_index, opening_available_cash: opening,
      child_reservation_hash: cycle.child_reservation_hash, terminal_evidence_hash: terminal.evidence_hash,
      accounting_evidence_hash: accounting.evidence_hash,
      accounting_artifact_manifest_hash: cycle.accounting_manifest.manifest_hash,
      lane_result_hashes_hash: canonicalHash(accounting.lane_result_hashes),
      terminal_owner_set_hash: canonicalHash(terminal.lane_records.map((record) => ({ lane_id: record.lane_id,
        owner: record.owner, partial_status: record.partial_status, terminal_fill_hash: record.terminal_fill_hash }))),
      full_flat_close_time: times.sort((left, right) => Date.parse(left) - Date.parse(right)).at(-1)!,
      ending_available_cash: accounting.trial_balance.ending_available_cash,
      trial_balance_hash: accounting.trial_balance.trial_balance_hash }
    return { ...body, cycle_commit_hash: replayPortfolioTwoFixedPartialCycleCommitHash(body) }
  })
  const ledger = input.cycles.flatMap((cycle) => cycle.accounting_evidence.ledger.map((cycleEntry) => ({
    global_ledger_sequence: 0, cycle_index: cycle.cycle_index,
    cycle_ledger_entry_hash: cycleEntry.ledger_entry_hash, cycle_entry: structuredClone(cycleEntry),
  }))).map((entry, index) => { const body = { ...entry, global_ledger_sequence: index + 1 }
    return { ...body, sequence_entry_hash: replayPortfolioTwoFixedPartialCycleLedgerEntryHash(body) } })
  const journal = input.cycles.flatMap((cycle) => cycle.accounting_evidence.journal
    .filter((entry) => cycle.cycle_index === 1 || entry.posting_kind !== "opening_cash")
    .map((cycleEntry) => ({ global_journal_sequence: 0, cycle_index: cycle.cycle_index,
      cycle_journal_entry_hash: cycleEntry.journal_entry_hash, cycle_entry: structuredClone(cycleEntry) })))
    .map((entry, index) => { const body = { ...entry, global_journal_sequence: index + 1 }
      return { ...body, sequence_entry_hash: replayPortfolioTwoFixedPartialCycleJournalEntryHash(body) } })
  const raw = Object.fromEntries(ACCOUNTS.map((account) => [account, 0])) as
    Record<ReplayPortfolioTwoFixedPartialJournalAccount, number>
  let totalDebits = 0; let totalCredits = 0
  for (const entry of journal) for (const leg of entry.cycle_entry.legs) {
    totalDebits = addReplayDecimalValues(totalDebits, leg.debit)
    totalCredits = addReplayDecimalValues(totalCredits, leg.credit)
    raw[leg.account] = addReplayDecimalValues(raw[leg.account], leg.debit, -leg.credit)
  }
  const balances = Object.fromEntries(ACCOUNTS.map((account) => [account,
    CREDIT_NORMAL.has(account) ? -raw[account] : raw[account]])) as
    Record<ReplayPortfolioTwoFixedPartialJournalAccount, number>
  const ending = commits.at(-1)!.ending_available_cash
  const trialBalanceBody = { settlement_asset: input.authority.settlement_asset,
    accounting_policy_version: REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_ACCOUNTING_POLICY_VERSION,
    total_debits: totalDebits, total_credits: totalCredits, balances,
    ending_available_cash: ending, ending_reserved_isolated_collateral: 0,
    ending_settled_cash: ending, ending_unrealized_pnl: 0, ending_portfolio_nav: ending,
    balanced: true as const, opening_equity_posting_count: 1 as const }
  const trialBalance = { ...trialBalanceBody,
    trial_balance_hash: replayPortfolioTwoFixedPartialAccountingTrialBalanceHash(trialBalanceBody) }
  if (totalDebits !== totalCredits || balances.wallet_cash !== ending
      || balances.isolated_margin_collateral !== 0 || balances.position_valuation !== 0) {
    throw new Error("P27 cycle consolidated Trial Balance does not reconcile")
  }
  const cycleCommitsHash = canonicalHash(commits)
  const fingerprintHash = canonicalHash({ cycle_commits_hash: cycleCommitsHash,
    consolidated_ledger_hash: canonicalHash(ledger), consolidated_journal_hash: canonicalHash(journal),
    consolidated_trial_balance_hash: trialBalance.trial_balance_hash,
    limitations: REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_CYCLE_SEQUENCE_LIMITATIONS })
  const body: Omit<ReplayPortfolioTwoFixedPartialCycleSequenceEvidence, "evidence_hash"> = {
    schema_version: REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_CYCLE_SEQUENCE_EVIDENCE_SCHEMA_VERSION,
    policy_version: REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_CYCLE_SEQUENCE_POLICY_VERSION,
    experiment_id: input.authority.experiment_id, trial_group_id: input.authority.trial_group_id,
    trial_group_hash: input.authority.trial_group_hash, portfolio_id: input.authority.portfolio_id,
    sequence_reservation_hash: input.authority.reservation_hash,
    settlement_asset: input.authority.settlement_asset, cycle_count: commits.length,
    cycle_commits: commits, cycle_commits_hash: cycleCommitsHash, consolidated_ledger: ledger,
    consolidated_journal: journal, consolidated_trial_balance: trialBalance,
    initial_cash: input.authority.initial_cash, ending_available_cash: ending,
    ending_reserved_isolated_collateral: 0, ending_unrealized_pnl: 0, ending_portfolio_nav: ending,
    limitations: REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_CYCLE_SEQUENCE_LIMITATIONS,
    fingerprint_hash: fingerprintHash,
  }
  const evidence = { ...body, evidence_hash: replayPortfolioTwoFixedPartialCycleSequenceEvidenceHash(body) }
  assertReplayPortfolioTwoFixedPartialCycleSequenceEvidence(evidence)
  return evidence
}
