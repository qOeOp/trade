import {
  REPLAY_PORTFOLIO_FIXED_PARTIAL_TERMINAL_ACCOUNTING_EVIDENCE_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_FIXED_PARTIAL_TERMINAL_ACCOUNTING_LIMITATIONS,
  REPLAY_PORTFOLIO_FIXED_PARTIAL_TERMINAL_ACCOUNTING_POLICY_VERSION,
  assertReplayPortfolioFixedPartialTerminalAccountingEvidence,
  replayPortfolioFixedPartialAccountingJournalEntryHash,
  replayPortfolioFixedPartialAccountingLedgerEntryHash,
  replayPortfolioFixedPartialAccountingTrialBalanceHash,
  replayPortfolioFixedPartialTerminalAccountingEvidenceHash,
  type ReplayPortfolioFixedPartialAccountingJournalEntry,
  type ReplayPortfolioFixedPartialAccountingLedgerEntry,
  type ReplayPortfolioFixedPartialJournalAccount,
  type ReplayPortfolioFixedPartialPostingKind,
  type ReplayPortfolioFixedPartialTerminalAccountingEvidence,
} from "../../../contracts/src/lib/replay-portfolio-fixed-partial-terminal-accounting-contracts"
import {
  assertReplayPortfolioFixedPartialTerminalArtifactManifest,
  assertReplayPortfolioFixedPartialTerminalEvidence,
  type ReplayPortfolioFixedPartialCashflowEvent,
  type ReplayPortfolioFixedPartialTerminalArtifactManifest,
  type ReplayPortfolioFixedPartialTerminalEvidence,
  type ReplayPortfolioFixedPartialTerminalRecord,
} from "../../../contracts/src/lib/replay-portfolio-fixed-partial-terminal-contracts"
import { canonicalHash, compareReplayEventKeys, type ReplayEventKey } from
  "../../../contracts/src/lib/replay-contracts"
import { addReplayDecimalValues } from "../../../contracts/src/lib/replay-decimal"

const ACCOUNTS: ReplayPortfolioFixedPartialJournalAccount[] = ["wallet_cash", "isolated_margin_collateral",
  "position_valuation", "opening_equity", "realized_pnl_income", "realized_pnl_loss", "funding_income",
  "funding_expense", "fee_expense", "liquidation_fee_expense", "unrealized_pnl_income", "unrealized_pnl_loss"]
const CREDIT_NORMAL = new Set<ReplayPortfolioFixedPartialJournalAccount>([
  "opening_equity", "realized_pnl_income", "funding_income", "unrealized_pnl_income",
])
interface Event { key: ReplayEventKey; rank: number; record: ReplayPortfolioFixedPartialTerminalRecord
  kind: "entry" | "cashflow" | "release" | "mark"; cashflow?: ReplayPortfolioFixedPartialCashflowEvent }

export function createReplayPortfolioFixedPartialTerminalAccountingEvidence(input: {
  terminal_evidence: ReplayPortfolioFixedPartialTerminalEvidence
  terminal_manifest: ReplayPortfolioFixedPartialTerminalArtifactManifest
}): ReplayPortfolioFixedPartialTerminalAccountingEvidence {
  assertReplayPortfolioFixedPartialTerminalEvidence(input.terminal_evidence)
  assertReplayPortfolioFixedPartialTerminalArtifactManifest(input.terminal_manifest)
  if (input.terminal_manifest.evidence_hash !== input.terminal_evidence.evidence_hash) {
    throw new Error("Fixed-partial accounting source closure drift")
  }
  const events = materializeEvents(input.terminal_evidence)
  const ledger = createLedger(input.terminal_evidence.shared_initial_cash, events)
  const journal = createJournal(input.terminal_evidence, input.terminal_manifest.authority_frozen_at, events)
  const trialBalance = createTrialBalance(input.terminal_evidence, journal)
  const fingerprintBody = { terminal_evidence_hash: input.terminal_evidence.evidence_hash,
    terminal_artifact_manifest_hash: input.terminal_manifest.manifest_hash, ledger_hash: canonicalHash(ledger),
    journal_hash: canonicalHash(journal), trial_balance_hash: trialBalance.trial_balance_hash,
    limitations_hash: canonicalHash(REPLAY_PORTFOLIO_FIXED_PARTIAL_TERMINAL_ACCOUNTING_LIMITATIONS) }
  const fingerprint = { ...fingerprintBody, fingerprint_hash: canonicalHash(fingerprintBody) }
  const body: Omit<ReplayPortfolioFixedPartialTerminalAccountingEvidence, "evidence_hash"> = {
    schema_version: REPLAY_PORTFOLIO_FIXED_PARTIAL_TERMINAL_ACCOUNTING_EVIDENCE_SCHEMA_VERSION,
    accounting_policy_version: REPLAY_PORTFOLIO_FIXED_PARTIAL_TERMINAL_ACCOUNTING_POLICY_VERSION,
    experiment_id: input.terminal_evidence.experiment_id, trial_group_id: input.terminal_evidence.trial_group_id,
    trial_group_hash: input.terminal_evidence.trial_group_hash, portfolio_id: input.terminal_evidence.portfolio_id,
    settlement_asset: input.terminal_evidence.settlement_asset,
    shared_initial_cash: input.terminal_evidence.shared_initial_cash,
    terminal_evidence_hash: input.terminal_evidence.evidence_hash,
    terminal_artifact_manifest_hash: input.terminal_manifest.manifest_hash,
    ledger, journal, trial_balance: trialBalance,
    limitations: REPLAY_PORTFOLIO_FIXED_PARTIAL_TERMINAL_ACCOUNTING_LIMITATIONS, fingerprint,
  }
  const evidence = { ...body, evidence_hash: replayPortfolioFixedPartialTerminalAccountingEvidenceHash(body) }
  assertReplayPortfolioFixedPartialTerminalAccountingEvidence(evidence); return evidence
}

function materializeEvents(evidence: ReplayPortfolioFixedPartialTerminalEvidence): Event[] {
  const events: Event[] = []
  for (const record of evidence.lane_records) {
    if (!record.entry_time || !record.entry_fill_hash) continue
    events.push({ key: syntheticKey(record.entry_time, 20, record.priority_rank, record.entry_fill_hash),
      rank: 0, record, kind: "entry" })
    for (const cashflow of record.cashflow_events) events.push({ key: cashflow.event_key,
      rank: cashflow.kind === "entry_fee" ? 1 : cashflow.kind === "funding" ? 2 : 3,
      record, kind: "cashflow", cashflow })
    if (!record.ending_open && record.terminal_time && record.terminal_source_hash) events.push({
      key: syntheticKey(record.terminal_time, record.terminal_phase!, record.priority_rank,
        `${record.terminal_source_hash}:release`), rank: 4, record, kind: "release" })
    if (record.ending_open) events.push({ key: syntheticKey(record.ending_mark_time!,
      20, record.priority_rank, `${record.record_hash}:mark`), rank: 5, record, kind: "mark" })
  }
  return events.sort((a, b) => compareReplayEventKeys(a.key, b.key) || a.rank - b.rank
    || a.record.priority_rank - b.record.priority_rank || a.record.lane_id.localeCompare(b.record.lane_id))
}
function createLedger(initial: number, events: Event[]): ReplayPortfolioFixedPartialAccountingLedgerEntry[] {
  let settled = initial; const ledger: ReplayPortfolioFixedPartialAccountingLedgerEntry[] = []
  for (const event of events) {
    const flow = event.cashflow; if (event.kind !== "cashflow" || !flow || flow.amount === 0) continue
    settled = addReplayDecimalValues(settled, flow.amount)
    const body: Omit<ReplayPortfolioFixedPartialAccountingLedgerEntry, "ledger_entry_hash"> = {
      ledger_sequence: ledger.length + 1, event_time: event.key.event_time,
      boundary_phase: event.key.boundary_phase as 10 | 15 | 20, source_event_hash: flow.cashflow_hash,
      terminal_record_hash: event.record.record_hash, lane_id: event.record.lane_id, symbol: event.record.symbol,
      terminal_owner: event.record.owner, cashflow_kind: flow.kind, amount: flow.amount,
      settled_cash_after: settled,
    }
    ledger.push({ ...body, ledger_entry_hash: replayPortfolioFixedPartialAccountingLedgerEntryHash(body) })
  }
  return ledger
}
function createJournal(source: ReplayPortfolioFixedPartialTerminalEvidence, frozenAt: string,
  events: Event[]): ReplayPortfolioFixedPartialAccountingJournalEntry[] {
  const journal: ReplayPortfolioFixedPartialAccountingJournalEntry[] = []
  const post = (event: Event | null, kind: ReplayPortfolioFixedPartialPostingKind,
    debit: ReplayPortfolioFixedPartialJournalAccount, credit: ReplayPortfolioFixedPartialJournalAccount,
    amount: number) => {
    if (amount === 0) return
    const body: Omit<ReplayPortfolioFixedPartialAccountingJournalEntry, "journal_entry_hash"> = {
      journal_sequence: journal.length + 1, event_time: event?.key.event_time ?? frozenAt,
      boundary_phase: event ? event.key.boundary_phase as 10 | 15 | 20 : null,
      source_event_hash: event?.cashflow?.cashflow_hash ?? event?.key.stable_event_id ?? null,
      terminal_record_hash: event?.record.record_hash ?? null, lane_id: event?.record.lane_id ?? null,
      terminal_owner: event?.record.owner ?? null, posting_kind: kind,
      legs: [{ account: debit, debit: amount, credit: 0 }, { account: credit, debit: 0, credit: amount }],
    }
    journal.push({ ...body, journal_entry_hash: replayPortfolioFixedPartialAccountingJournalEntryHash(body) })
  }
  post(null, "opening_cash", "wallet_cash", "opening_equity", source.shared_initial_cash)
  for (const event of events) {
    if (event.kind === "entry") post(event, "collateral_reserve", "isolated_margin_collateral",
      "wallet_cash", event.record.isolated_collateral)
    if (event.kind === "release") post(event, "collateral_release", "wallet_cash",
      "isolated_margin_collateral", event.record.released_collateral)
    if (event.kind === "mark") signed(event, "terminal_mark_to_market", event.record.ending_unrealized_pnl,
      "position_valuation", "unrealized_pnl_income", "unrealized_pnl_loss", "position_valuation", post)
    if (event.kind !== "cashflow" || !event.cashflow) continue
    const { kind, amount } = event.cashflow
    if (kind === "entry_fee" || kind === "trading_fee") post(event, kind, "fee_expense", "wallet_cash", -amount)
    else if (kind === "liquidation_fee") post(event, kind, "liquidation_fee_expense", "wallet_cash", -amount)
    else if (kind === "funding") signed(event, kind, amount, "wallet_cash", "funding_income",
      "funding_expense", "wallet_cash", post)
    else signed(event, kind, amount, "wallet_cash", "realized_pnl_income",
      "realized_pnl_loss", "wallet_cash", post)
  }
  return journal
}
type Post = (event: Event | null, kind: ReplayPortfolioFixedPartialPostingKind,
  debit: ReplayPortfolioFixedPartialJournalAccount, credit: ReplayPortfolioFixedPartialJournalAccount,
  amount: number) => void
function signed(event: Event, kind: ReplayPortfolioFixedPartialPostingKind, amount: number,
  positiveDebit: ReplayPortfolioFixedPartialJournalAccount, positiveCredit: ReplayPortfolioFixedPartialJournalAccount,
  negativeDebit: ReplayPortfolioFixedPartialJournalAccount, negativeCredit: ReplayPortfolioFixedPartialJournalAccount,
  post: Post) {
  if (amount > 0) post(event, kind, positiveDebit, positiveCredit, amount)
  if (amount < 0) post(event, kind, negativeDebit, negativeCredit, -amount)
}
function createTrialBalance(source: ReplayPortfolioFixedPartialTerminalEvidence,
  journal: ReplayPortfolioFixedPartialAccountingJournalEntry[]) {
  const raw = Object.fromEntries(ACCOUNTS.map((account) => [account, 0])) as Record<ReplayPortfolioFixedPartialJournalAccount, number>
  let totalDebits = 0; let totalCredits = 0
  for (const entry of journal) for (const leg of entry.legs) {
    totalDebits = addReplayDecimalValues(totalDebits, leg.debit); totalCredits = addReplayDecimalValues(totalCredits, leg.credit)
    raw[leg.account] = addReplayDecimalValues(raw[leg.account], leg.debit, -leg.credit)
  }
  const balances = Object.fromEntries(ACCOUNTS.map((account) => [account,
    CREDIT_NORMAL.has(account) ? -raw[account] : raw[account]])) as Record<ReplayPortfolioFixedPartialJournalAccount, number>
  const body = { settlement_asset: source.settlement_asset,
    accounting_policy_version: REPLAY_PORTFOLIO_FIXED_PARTIAL_TERMINAL_ACCOUNTING_POLICY_VERSION,
    total_debits: totalDebits, total_credits: totalCredits, balances,
    ending_available_cash: source.ending_available_cash,
    ending_reserved_isolated_collateral: source.ending_reserved_isolated_collateral,
    ending_settled_cash: source.ending_settled_cash, ending_unrealized_pnl: source.ending_unrealized_pnl,
    ending_portfolio_nav: source.ending_portfolio_nav, balanced: true as const }
  const result = { ...body, trial_balance_hash: replayPortfolioFixedPartialAccountingTrialBalanceHash(body) }
  if (totalDebits !== totalCredits || balances.wallet_cash !== source.ending_available_cash
      || balances.isolated_margin_collateral !== source.ending_reserved_isolated_collateral
      || balances.position_valuation !== source.ending_unrealized_pnl) {
    throw new Error("Fixed-partial Trial Balance does not reconcile")
  }
  return result
}
function syntheticKey(time: string, phase: 15 | 20, sequence: number, id: string): ReplayEventKey {
  return { event_time: time, boundary_phase: phase, source_sequence: sequence, event_subphase: 0,
    stable_event_id: id }
}
