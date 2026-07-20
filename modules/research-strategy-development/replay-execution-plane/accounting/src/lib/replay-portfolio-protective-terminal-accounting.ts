import {
  REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ACCOUNTING_EVIDENCE_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ACCOUNTING_LIMITATIONS,
  REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ACCOUNTING_POLICY_VERSION,
  assertReplayPortfolioProtectiveTerminalAccountingEvidence,
  replayPortfolioProtectiveTerminalAccountingEvidenceHash,
  replayPortfolioProtectiveTerminalAccountingFingerprintHash,
  replayPortfolioProtectiveTerminalAccountingJournalEntryHash,
  replayPortfolioProtectiveTerminalAccountingLedgerEntryHash,
  replayPortfolioProtectiveTerminalAccountingTrialBalanceHash,
  type ReplayPortfolioProtectiveTerminalAccountingEvidence,
  type ReplayPortfolioProtectiveTerminalAccountingFingerprint,
  type ReplayPortfolioProtectiveTerminalAccountingJournalAccount,
  type ReplayPortfolioProtectiveTerminalAccountingJournalEntry,
  type ReplayPortfolioProtectiveTerminalAccountingJournalLeg,
  type ReplayPortfolioProtectiveTerminalAccountingLedgerEntry,
  type ReplayPortfolioProtectiveTerminalAccountingTrialBalance,
} from "../../../contracts/src/lib/replay-portfolio-protective-terminal-accounting-contracts"
import {
  assertReplayPortfolioProtectiveTerminalArtifactManifest,
  assertReplayPortfolioProtectiveTerminalEvidence,
  type ReplayPortfolioProtectiveTerminalArtifactManifest,
  type ReplayPortfolioProtectiveTerminalEvidence,
  type ReplayPortfolioProtectiveTerminalRecord,
} from "../../../contracts/src/lib/replay-portfolio-protective-terminal-contracts"
import {
  replayRuntimeSharedWalletRiskResultHash,
  type ReplayRuntimeSharedWalletRiskEntryEvent,
  type ReplayRuntimeSharedWalletRiskResult,
} from "../../../contracts/src/lib/replay-runtime-shared-wallet-risk-contracts"
import type { ReplayRuntimeSharedWalletFundingEvent } from
  "../../../contracts/src/lib/replay-runtime-shared-wallet-funding-contracts"
import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import { addReplayDecimalValues } from "../../../contracts/src/lib/replay-decimal"
import { appendReplayPortfolioProtectiveTerminalPostEntryAccountingEvents } from
  "./replay-portfolio-protective-terminal-accounting-event-materialization"

const ACCOUNTS: ReplayPortfolioProtectiveTerminalAccountingJournalAccount[] = [
  "wallet_cash", "isolated_margin_collateral", "position_valuation", "opening_equity",
  "realized_pnl_income", "realized_pnl_loss", "funding_income", "funding_expense",
  "fee_expense", "liquidation_fee_expense", "unrealized_pnl_income", "unrealized_pnl_loss",
]

const CREDIT_NORMAL = new Set<ReplayPortfolioProtectiveTerminalAccountingJournalAccount>([
  "opening_equity", "realized_pnl_income", "funding_income", "unrealized_pnl_income",
])

export interface ReplayPortfolioProtectiveTerminalAccountingInput {
  protective_terminal_evidence: ReplayPortfolioProtectiveTerminalEvidence
  protective_terminal_manifest: ReplayPortfolioProtectiveTerminalArtifactManifest
  risk_result: ReplayRuntimeSharedWalletRiskResult
}

interface AccountingEvent {
  event_time: string
  boundary_phase: 10 | 15 | 20
  event_rank: number
  priority_rank: number
  lane_id: string
  source_event_hash: string
  record: ReplayPortfolioProtectiveTerminalRecord
  kind: "entry" | "funding" | "terminal" | "terminal_mark"
  funding_cashflow: number
}

export function createReplayPortfolioProtectiveTerminalAccountingEvidence(
  input: ReplayPortfolioProtectiveTerminalAccountingInput,
): ReplayPortfolioProtectiveTerminalAccountingEvidence {
  validateInput(input)
  const events = createAccountingEvents(input)
  const ledger = createLedger(input.protective_terminal_evidence.shared_initial_cash, events)
  const journal = createJournal(input, events)
  const trialBalance = createTrialBalance(input.protective_terminal_evidence, journal)
  const excludedPreempted = input.protective_terminal_evidence.lane_records
    .flatMap((record) => record.preempted_upstream_terminal_hash ? [record.preempted_upstream_terminal_hash] : []).sort()
  const excludedPostFunding = postTerminalFundingEvents(input).map((event) => event.event_hash).sort()
  const source = input.protective_terminal_evidence
  const fingerprintBody: Omit<ReplayPortfolioProtectiveTerminalAccountingFingerprint, "fingerprint_hash"> = {
    experiment_id: source.experiment_id,
    trial_group_id: source.trial_group_id,
    trial_group_hash: source.trial_group_hash,
    portfolio_id: source.portfolio_id,
    protective_terminal_evidence_hash: source.evidence_hash,
    protective_terminal_artifact_manifest_hash: input.protective_terminal_manifest.manifest_hash,
    risk_result_hash: input.risk_result.result_hash,
    ledger_hash: canonicalHash(ledger),
    journal_hash: canonicalHash(journal),
    trial_balance_hash: trialBalance.trial_balance_hash,
    excluded_preempted_source_hashes_hash: canonicalHash(excludedPreempted),
    excluded_post_terminal_funding_source_hashes_hash: canonicalHash(excludedPostFunding),
    limitations_hash: canonicalHash(REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ACCOUNTING_LIMITATIONS),
  }
  const fingerprint = {
    ...fingerprintBody,
    fingerprint_hash: replayPortfolioProtectiveTerminalAccountingFingerprintHash(fingerprintBody),
  }
  const body: Omit<ReplayPortfolioProtectiveTerminalAccountingEvidence, "evidence_hash"> = {
    schema_version: REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ACCOUNTING_EVIDENCE_SCHEMA_VERSION,
    accounting_policy_version: REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ACCOUNTING_POLICY_VERSION,
    experiment_id: source.experiment_id,
    trial_group_id: source.trial_group_id,
    trial_group_hash: source.trial_group_hash,
    portfolio_id: source.portfolio_id,
    settlement_asset: source.settlement_asset,
    shared_initial_cash: source.shared_initial_cash,
    protective_terminal_evidence_hash: source.evidence_hash,
    protective_terminal_artifact_manifest_hash: input.protective_terminal_manifest.manifest_hash,
    risk_result_hash: input.risk_result.result_hash,
    ledger,
    journal,
    trial_balance: trialBalance,
    excluded_preempted_source_hashes: excludedPreempted,
    excluded_post_terminal_funding_source_hashes: excludedPostFunding,
    limitations: REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ACCOUNTING_LIMITATIONS,
    fingerprint,
  }
  const evidence = {
    ...body,
    evidence_hash: replayPortfolioProtectiveTerminalAccountingEvidenceHash(body),
  }
  assertReplayPortfolioProtectiveTerminalAccountingEvidence(evidence, input)
  return evidence
}

function createAccountingEvents(input: ReplayPortfolioProtectiveTerminalAccountingInput): AccountingEvent[] {
  const risk = input.risk_result
  const events: AccountingEvent[] = []
  for (const record of input.protective_terminal_evidence.lane_records) {
    if (record.owner === "not_opened") continue
    const entry = risk.global_source_event_queue.find((event): event is ReplayRuntimeSharedWalletRiskEntryEvent =>
      event.event_role === "entry" && event.lane_id === record.lane_id && event.outcome === "filled")
    if (!entry || entry.fill_hash !== record.entry_fill_hash || entry.event_time !== record.entry_time) {
      throw new Error(`Protective terminal accounting ${record.lane_id} entry source drift`)
    }
    events.push({
      event_time: entry.event_time, boundary_phase: entry.boundary_phase, event_rank: 3,
      priority_rank: record.priority_rank, lane_id: record.lane_id, source_event_hash: entry.event_hash,
      record, kind: "entry", funding_cashflow: 0,
    })
    appendReplayPortfolioProtectiveTerminalPostEntryAccountingEvents({
      events,
      risk_result: risk,
      record,
      entry,
      error_prefix: "Protective terminal accounting",
    })
  }
  return events.sort(compareEvents)
}

function compareEvents(left: AccountingEvent, right: AccountingEvent): number {
  return Date.parse(left.event_time) - Date.parse(right.event_time)
    || left.boundary_phase - right.boundary_phase
    || left.event_rank - right.event_rank
    || left.priority_rank - right.priority_rank
    || left.lane_id.localeCompare(right.lane_id)
    || left.source_event_hash.localeCompare(right.source_event_hash)
}

function createLedger(
  sharedInitialCash: number,
  events: AccountingEvent[],
): ReplayPortfolioProtectiveTerminalAccountingLedgerEntry[] {
  const ledger: ReplayPortfolioProtectiveTerminalAccountingLedgerEntry[] = []
  let settled = sharedInitialCash
  const append = (
    event: AccountingEvent,
    cashflowKind: ReplayPortfolioProtectiveTerminalAccountingLedgerEntry["cashflow_kind"],
    amount: number,
    accountingOrdinal: number,
  ) => {
    if (amount === 0) return
    settled = addReplayDecimalValues(settled, amount)
    const body: Omit<ReplayPortfolioProtectiveTerminalAccountingLedgerEntry, "ledger_entry_hash"> = {
      ledger_sequence: ledger.length + 1,
      accounting_ordinal: accountingOrdinal,
      event_time: event.event_time,
      boundary_phase: event.boundary_phase,
      source_event_hash: event.source_event_hash,
      terminal_record_hash: event.record.record_hash,
      lane_id: event.lane_id,
      symbol: event.record.symbol,
      terminal_owner: event.record.owner,
      cashflow_kind: cashflowKind,
      amount,
      settled_cash_after: settled,
    }
    ledger.push({
      ...body,
      ledger_entry_hash: replayPortfolioProtectiveTerminalAccountingLedgerEntryHash(body),
    })
  }
  events.forEach((event, index) => {
    const ordinal = index + 1
    if (event.kind === "entry") append(event, "entry_fee", -event.record.entry_fee, ordinal)
    if (event.kind === "funding") append(event, "funding", event.funding_cashflow, ordinal)
    if (event.kind === "terminal") {
      append(event, "realized_pnl", event.record.realized_pnl, ordinal)
      append(event, "terminal_trading_fee", -event.record.exit_trading_fee, ordinal)
      append(event, "liquidation_fee", -event.record.liquidation_fee, ordinal)
    }
  })
  return ledger
}

function createJournal(
  input: ReplayPortfolioProtectiveTerminalAccountingInput,
  events: AccountingEvent[],
): ReplayPortfolioProtectiveTerminalAccountingJournalEntry[] {
  const journal: ReplayPortfolioProtectiveTerminalAccountingJournalEntry[] = []
  const post = (
    event: AccountingEvent | null,
    kind: ReplayPortfolioProtectiveTerminalAccountingJournalEntry["posting_kind"],
    debit: ReplayPortfolioProtectiveTerminalAccountingJournalAccount,
    credit: ReplayPortfolioProtectiveTerminalAccountingJournalAccount,
    amount: number,
    accountingOrdinal: number | null,
  ) => {
    if (amount === 0) return
    if (!Number.isFinite(amount) || amount < 0) throw new Error("Protective terminal Journal amount must be positive")
    const body: Omit<ReplayPortfolioProtectiveTerminalAccountingJournalEntry, "journal_entry_hash"> = {
      journal_sequence: journal.length + 1,
      accounting_ordinal: accountingOrdinal,
      event_time: event?.event_time ?? input.protective_terminal_manifest.authority_frozen_at,
      boundary_phase: event?.boundary_phase ?? null,
      source_event_hash: event?.source_event_hash ?? null,
      terminal_record_hash: event?.record.record_hash ?? null,
      lane_id: event?.lane_id ?? null,
      terminal_owner: event?.record.owner ?? null,
      posting_kind: kind,
      legs: [leg(debit, amount, 0), leg(credit, 0, amount)],
    }
    journal.push({
      ...body,
      journal_entry_hash: replayPortfolioProtectiveTerminalAccountingJournalEntryHash(body),
    })
  }
  post(null, "opening_cash", "wallet_cash", "opening_equity",
    input.protective_terminal_evidence.shared_initial_cash, null)
  events.forEach((event, index) => {
    const ordinal = index + 1
    if (event.kind === "entry") {
      post(event, "collateral_reserve", "isolated_margin_collateral", "wallet_cash",
        event.record.isolated_collateral, ordinal)
      post(event, "entry_fee", "fee_expense", "wallet_cash", event.record.entry_fee, ordinal)
    } else if (event.kind === "funding") {
      postSigned(event, "funding", event.funding_cashflow, "funding_income", "funding_expense", ordinal, post)
    } else if (event.kind === "terminal") {
      postSigned(event, "realized_pnl", event.record.realized_pnl,
        "realized_pnl_income", "realized_pnl_loss", ordinal, post)
      post(event, "terminal_trading_fee", "fee_expense", "wallet_cash",
        event.record.exit_trading_fee, ordinal)
      post(event, "liquidation_fee", "liquidation_fee_expense", "wallet_cash",
        event.record.liquidation_fee, ordinal)
      post(event, "collateral_release", "wallet_cash", "isolated_margin_collateral",
        event.record.released_collateral, ordinal)
    } else if (event.record.ending_unrealized_pnl > 0) {
      post(event, "terminal_mark_to_market", "position_valuation", "unrealized_pnl_income",
        event.record.ending_unrealized_pnl, ordinal)
    } else if (event.record.ending_unrealized_pnl < 0) {
      post(event, "terminal_mark_to_market", "unrealized_pnl_loss", "position_valuation",
        -event.record.ending_unrealized_pnl, ordinal)
    }
  })
  return journal
}

type Post = (
  event: AccountingEvent | null,
  kind: ReplayPortfolioProtectiveTerminalAccountingJournalEntry["posting_kind"],
  debit: ReplayPortfolioProtectiveTerminalAccountingJournalAccount,
  credit: ReplayPortfolioProtectiveTerminalAccountingJournalAccount,
  amount: number,
  accountingOrdinal: number | null,
) => void

function postSigned(
  event: AccountingEvent,
  kind: "funding" | "realized_pnl",
  amount: number,
  income: "funding_income" | "realized_pnl_income",
  expense: "funding_expense" | "realized_pnl_loss",
  accountingOrdinal: number,
  post: Post,
): void {
  if (amount > 0) post(event, kind, "wallet_cash", income, amount, accountingOrdinal)
  if (amount < 0) post(event, kind, expense, "wallet_cash", -amount, accountingOrdinal)
}

function createTrialBalance(
  source: ReplayPortfolioProtectiveTerminalEvidence,
  journal: ReplayPortfolioProtectiveTerminalAccountingJournalEntry[],
): ReplayPortfolioProtectiveTerminalAccountingTrialBalance {
  const raw = Object.fromEntries(ACCOUNTS.map((account) => [account, 0])) as
    Record<ReplayPortfolioProtectiveTerminalAccountingJournalAccount, number>
  let totalDebits = 0
  let totalCredits = 0
  for (const entry of journal) for (const item of entry.legs) {
    totalDebits = addReplayDecimalValues(totalDebits, item.debit)
    totalCredits = addReplayDecimalValues(totalCredits, item.credit)
    raw[item.account] = addReplayDecimalValues(raw[item.account], item.debit, -item.credit)
  }
  const balances = Object.fromEntries(ACCOUNTS.map((account) => [
    account, CREDIT_NORMAL.has(account) ? -raw[account] : raw[account],
  ])) as Record<ReplayPortfolioProtectiveTerminalAccountingJournalAccount, number>
  const body: Omit<ReplayPortfolioProtectiveTerminalAccountingTrialBalance, "trial_balance_hash"> = {
    settlement_asset: source.settlement_asset,
    accounting_policy_version: REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ACCOUNTING_POLICY_VERSION,
    total_debits: totalDebits,
    total_credits: totalCredits,
    balances,
    ending_available_cash: source.ending_available_cash,
    ending_reserved_isolated_collateral: source.ending_reserved_isolated_collateral,
    ending_settled_cash: source.ending_settled_cash,
    ending_unrealized_pnl: source.ending_unrealized_pnl,
    ending_portfolio_nav: source.ending_portfolio_nav,
    balanced: true,
  }
  const trialBalance = {
    ...body,
    trial_balance_hash: replayPortfolioProtectiveTerminalAccountingTrialBalanceHash(body),
  }
  if (balances.wallet_cash !== source.ending_available_cash
      || balances.isolated_margin_collateral !== source.ending_reserved_isolated_collateral
      || balances.position_valuation !== source.ending_unrealized_pnl
      || totalDebits !== totalCredits) {
    throw new Error("Protective terminal Trial Balance does not reconcile P15 economics")
  }
  return trialBalance
}

function postTerminalFundingEvents(
  input: ReplayPortfolioProtectiveTerminalAccountingInput,
): ReplayRuntimeSharedWalletFundingEvent[] {
  const records = new Map(input.protective_terminal_evidence.lane_records.map((record) => [record.lane_id, record]))
  return input.risk_result.global_source_event_queue.filter((event): event is ReplayRuntimeSharedWalletFundingEvent => {
    if (event.event_role !== "funding" || event.outcome !== "applied") return false
    const record = records.get(event.lane_id)
    return Boolean(record?.terminal_time && (event.event_time > record.terminal_time
      || event.event_time === record.terminal_time && event.boundary_phase >= (record.terminal_phase ?? 20)))
  })
}

function validateInput(input: ReplayPortfolioProtectiveTerminalAccountingInput): void {
  assertReplayPortfolioProtectiveTerminalEvidence(input.protective_terminal_evidence)
  assertReplayPortfolioProtectiveTerminalArtifactManifest(input.protective_terminal_manifest)
  if (input.risk_result.result_hash !== replayRuntimeSharedWalletRiskResultHash(input.risk_result)
      || input.protective_terminal_manifest.protective_terminal_evidence_hash
        !== input.protective_terminal_evidence.evidence_hash
      || input.protective_terminal_evidence.risk_result_hash !== input.risk_result.result_hash
      || input.protective_terminal_evidence.portfolio_id !== input.risk_result.portfolio_id
      || input.protective_terminal_evidence.shared_initial_cash !== input.risk_result.shared_initial_cash
      || input.protective_terminal_evidence.settlement_asset !== input.risk_result.settlement_asset) {
    throw new Error("Protective terminal accounting source closure drift")
  }
}

function leg(
  account: ReplayPortfolioProtectiveTerminalAccountingJournalAccount,
  debit: number,
  credit: number,
): ReplayPortfolioProtectiveTerminalAccountingJournalLeg {
  return { account, debit, credit }
}
