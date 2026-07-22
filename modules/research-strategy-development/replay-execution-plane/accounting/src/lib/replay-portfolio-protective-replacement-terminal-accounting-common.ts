import type { ReplayRuntimeSharedWalletFundingEvent } from
  "../../../contracts/src/lib/replay-runtime-shared-wallet-funding-contracts"
import {
  replayRuntimeSharedWalletRiskResultHash,
  type ReplayRuntimeSharedWalletRiskEntryEvent,
  type ReplayRuntimeSharedWalletRiskResult,
} from "../../../contracts/src/lib/replay-runtime-shared-wallet-risk-contracts"
import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import { addReplayDecimalValues } from "../../../contracts/src/lib/replay-decimal"
import { appendReplayPortfolioProtectiveTerminalPostEntryAccountingEvents } from
  "./replay-portfolio-protective-terminal-accounting-event-materialization"
import {
  appendReplayPortfolioTerminalJournal,
  type ReplayPortfolioTerminalJournalAccount,
  type ReplayPortfolioTerminalJournalPost,
  type ReplayPortfolioTerminalPostingKind,
} from "./replay-portfolio-terminal-journal"

type JournalAccount = ReplayPortfolioTerminalJournalAccount
type PostingKind = ReplayPortfolioTerminalPostingKind
type CashflowKind = "entry_fee" | "funding" | "realized_pnl" | "terminal_trading_fee"
  | "liquidation_fee"

const ACCOUNTS: JournalAccount[] = [
  "wallet_cash", "isolated_margin_collateral", "position_valuation", "opening_equity",
  "realized_pnl_income", "realized_pnl_loss", "funding_income", "funding_expense",
  "fee_expense", "liquidation_fee_expense", "unrealized_pnl_income", "unrealized_pnl_loss",
]
const CREDIT_NORMAL = new Set<JournalAccount>([
  "opening_equity", "realized_pnl_income", "funding_income", "unrealized_pnl_income",
])

interface ReplacementTerminalRecord {
  lane_id: string
  symbol: string
  priority_rank: number
  owner: string
  record_hash: string
  preempted_upstream_terminal_hash: string | null
  entry_fill_hash: string | null
  entry_time: string | null
  entry_fee: number
  isolated_collateral: number
  funding_cashflow_before_terminal: number
  terminal_time: string | null
  terminal_phase: 10 | 15 | 20 | null
  terminal_source_hash: string | null
  realized_pnl: number
  exit_trading_fee: number
  liquidation_fee: number
  released_collateral: number
  ending_open: boolean
  ending_unrealized_pnl: number
}

interface ReplacementTerminalEvidence {
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  portfolio_id: string
  settlement_asset: string
  shared_initial_cash: number
  risk_result_hash: string
  evidence_hash: string
  lane_records: ReplacementTerminalRecord[]
  ending_available_cash: number
  ending_reserved_isolated_collateral: number
  ending_settled_cash: number
  ending_unrealized_pnl: number
  ending_portfolio_nav: number
}

interface ReplacementTerminalManifest {
  replacement_terminal_evidence_hash: string
  authority_frozen_at: string
  manifest_hash: string
}

export interface ReplayPortfolioProtectiveReplacementTerminalAccountingCommonInput {
  replacement_terminal_evidence: ReplacementTerminalEvidence
  replacement_terminal_manifest: ReplacementTerminalManifest
  risk_result: ReplayRuntimeSharedWalletRiskResult
}

export interface ReplayPortfolioProtectiveReplacementTerminalAccountingCommonConfig {
  source_kind?: "replacement" | "cancel"
  evidence_schema_version: string
  accounting_policy_version: string
  limitations: readonly string[]
  trial_balance_error: string
  assert_terminal_evidence: (value: ReplacementTerminalEvidence) => void
  assert_terminal_manifest: (value: ReplacementTerminalManifest) => void
  assert_accounting_evidence: (
    value: unknown,
    input: ReplayPortfolioProtectiveReplacementTerminalAccountingCommonInput,
  ) => void
}

interface AccountingEvent {
  event_time: string
  boundary_phase: 10 | 15 | 20
  event_rank: number
  priority_rank: number
  lane_id: string
  source_event_hash: string
  record: ReplacementTerminalRecord
  kind: "entry" | "funding" | "terminal" | "terminal_mark"
  funding_cashflow: number
}

interface LedgerEntry {
  ledger_sequence: number
  accounting_ordinal: number
  event_time: string
  boundary_phase: 10 | 15 | 20
  source_event_hash: string
  terminal_record_hash: string
  lane_id: string
  symbol: string
  terminal_owner: string
  cashflow_kind: CashflowKind
  amount: number
  settled_cash_after: number
  ledger_entry_hash: string
}

interface JournalLeg { account: JournalAccount; debit: number; credit: number }
interface JournalEntry {
  journal_sequence: number
  accounting_ordinal: number | null
  event_time: string
  boundary_phase: 10 | 15 | 20 | null
  source_event_hash: string | null
  terminal_record_hash: string | null
  lane_id: string | null
  terminal_owner: string | null
  posting_kind: PostingKind
  legs: JournalLeg[]
  journal_entry_hash: string
}

export function createReplayPortfolioProtectiveReplacementTerminalAccountingEvidence<T>(
  config: ReplayPortfolioProtectiveReplacementTerminalAccountingCommonConfig,
  input: ReplayPortfolioProtectiveReplacementTerminalAccountingCommonInput,
): T {
  validateInput(config, input)
  const events = createAccountingEvents(input)
  const ledger = createLedger(input.replacement_terminal_evidence.shared_initial_cash, events)
  const journal = createJournal(input, events)
  const trialBalance = createTrialBalance(config, input.replacement_terminal_evidence, journal)
  const excludedPreempted = input.replacement_terminal_evidence.lane_records.flatMap((record) =>
    record.preempted_upstream_terminal_hash ? [record.preempted_upstream_terminal_hash] : []).sort()
  const excludedPostFunding = postTerminalFundingEvents(input).map((event) => event.event_hash).sort()
  const source = input.replacement_terminal_evidence
  const sourceHashes = config.source_kind === "cancel" ? {
    cancel_terminal_evidence_hash: source.evidence_hash,
    cancel_terminal_artifact_manifest_hash: input.replacement_terminal_manifest.manifest_hash,
  } : {
    replacement_terminal_evidence_hash: source.evidence_hash,
    replacement_terminal_artifact_manifest_hash: input.replacement_terminal_manifest.manifest_hash,
  }
  const fingerprintBody = {
    experiment_id: source.experiment_id,
    trial_group_id: source.trial_group_id,
    trial_group_hash: source.trial_group_hash,
    portfolio_id: source.portfolio_id,
    ...sourceHashes,
    risk_result_hash: input.risk_result.result_hash,
    ledger_hash: canonicalHash(ledger),
    journal_hash: canonicalHash(journal),
    trial_balance_hash: trialBalance.trial_balance_hash,
    excluded_preempted_source_hashes_hash: canonicalHash(excludedPreempted),
    excluded_post_terminal_funding_source_hashes_hash: canonicalHash(excludedPostFunding),
    limitations_hash: canonicalHash(config.limitations),
  }
  const fingerprint = { ...fingerprintBody, fingerprint_hash: canonicalHash(fingerprintBody) }
  const body = {
    schema_version: config.evidence_schema_version,
    accounting_policy_version: config.accounting_policy_version,
    experiment_id: source.experiment_id,
    trial_group_id: source.trial_group_id,
    trial_group_hash: source.trial_group_hash,
    portfolio_id: source.portfolio_id,
    settlement_asset: source.settlement_asset,
    shared_initial_cash: source.shared_initial_cash,
    ...sourceHashes,
    risk_result_hash: input.risk_result.result_hash,
    ledger,
    journal,
    trial_balance: trialBalance,
    excluded_preempted_source_hashes: excludedPreempted,
    excluded_post_terminal_funding_source_hashes: excludedPostFunding,
    limitations: config.limitations,
    fingerprint,
  }
  const evidence = { ...body, evidence_hash: canonicalHash(body) }
  config.assert_accounting_evidence(evidence, input)
  return evidence as T
}

function createAccountingEvents(input: ReplayPortfolioProtectiveReplacementTerminalAccountingCommonInput): AccountingEvent[] {
  const events: AccountingEvent[] = []
  for (const record of input.replacement_terminal_evidence.lane_records) {
    if (record.owner === "not_opened") continue
    const entry = input.risk_result.global_source_event_queue.find(
      (event): event is ReplayRuntimeSharedWalletRiskEntryEvent =>
        event.event_role === "entry" && event.lane_id === record.lane_id && event.outcome === "filled",
    )
    if (!entry || entry.fill_hash !== record.entry_fill_hash || entry.event_time !== record.entry_time) {
      throw new Error(`Replacement terminal accounting ${record.lane_id} entry source drift`)
    }
    events.push({
      event_time: entry.event_time,
      boundary_phase: entry.boundary_phase,
      event_rank: 3,
      priority_rank: record.priority_rank,
      lane_id: record.lane_id,
      source_event_hash: entry.event_hash,
      record,
      kind: "entry",
      funding_cashflow: 0,
    })
    appendReplayPortfolioProtectiveTerminalPostEntryAccountingEvents({
      events,
      risk_result: input.risk_result,
      record,
      entry,
      error_prefix: "Replacement terminal accounting",
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

function createLedger(sharedInitialCash: number, events: AccountingEvent[]): LedgerEntry[] {
  const ledger: LedgerEntry[] = []
  let settled = sharedInitialCash
  const append = (event: AccountingEvent, cashflowKind: CashflowKind, amount: number, ordinal: number) => {
    if (amount === 0) return
    settled = addReplayDecimalValues(settled, amount)
    const body = {
      ledger_sequence: ledger.length + 1,
      accounting_ordinal: ordinal,
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
    ledger.push({ ...body, ledger_entry_hash: canonicalHash(body) })
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
  input: ReplayPortfolioProtectiveReplacementTerminalAccountingCommonInput,
  events: AccountingEvent[],
): JournalEntry[] {
  const journal: JournalEntry[] = []
  const post: Post = (event, kind, debit, credit, amount, ordinal) => {
    if (amount === 0) return
    if (!Number.isFinite(amount) || amount < 0) throw new Error("Replacement terminal Journal amount must be positive")
    const body = {
      journal_sequence: journal.length + 1,
      accounting_ordinal: ordinal,
      event_time: event?.event_time ?? input.replacement_terminal_manifest.authority_frozen_at,
      boundary_phase: event?.boundary_phase ?? null,
      source_event_hash: event?.source_event_hash ?? null,
      terminal_record_hash: event?.record.record_hash ?? null,
      lane_id: event?.lane_id ?? null,
      terminal_owner: event?.record.owner ?? null,
      posting_kind: kind,
      legs: [leg(debit, amount, 0), leg(credit, 0, amount)],
    }
    journal.push({ ...body, journal_entry_hash: canonicalHash(body) })
  }
  appendReplayPortfolioTerminalJournal(
    input.replacement_terminal_evidence.shared_initial_cash,
    events,
    post,
  )
  return journal
}

type Post = ReplayPortfolioTerminalJournalPost<AccountingEvent>

function createTrialBalance(config: ReplayPortfolioProtectiveReplacementTerminalAccountingCommonConfig,
  source: ReplacementTerminalEvidence, journal: JournalEntry[]) {
  const raw = Object.fromEntries(ACCOUNTS.map((account) => [account, 0])) as Record<JournalAccount, number>
  let totalDebits = 0
  let totalCredits = 0
  for (const entry of journal) for (const item of entry.legs) {
    totalDebits = addReplayDecimalValues(totalDebits, item.debit)
    totalCredits = addReplayDecimalValues(totalCredits, item.credit)
    raw[item.account] = addReplayDecimalValues(raw[item.account], item.debit, -item.credit)
  }
  const balances = Object.fromEntries(ACCOUNTS.map((account) => [
    account, CREDIT_NORMAL.has(account) ? -raw[account] : raw[account],
  ])) as Record<JournalAccount, number>
  const body = {
    settlement_asset: source.settlement_asset,
    accounting_policy_version: config.accounting_policy_version,
    total_debits: totalDebits,
    total_credits: totalCredits,
    balances,
    ending_available_cash: source.ending_available_cash,
    ending_reserved_isolated_collateral: source.ending_reserved_isolated_collateral,
    ending_settled_cash: source.ending_settled_cash,
    ending_unrealized_pnl: source.ending_unrealized_pnl,
    ending_portfolio_nav: source.ending_portfolio_nav,
    balanced: true as const,
  }
  const result = { ...body, trial_balance_hash: canonicalHash(body) }
  if (balances.wallet_cash !== source.ending_available_cash
      || balances.isolated_margin_collateral !== source.ending_reserved_isolated_collateral
      || balances.position_valuation !== source.ending_unrealized_pnl
      || totalDebits !== totalCredits) throw new Error(config.trial_balance_error)
  return result
}

function postTerminalFundingEvents(input: ReplayPortfolioProtectiveReplacementTerminalAccountingCommonInput):
ReplayRuntimeSharedWalletFundingEvent[] {
  const records = new Map(input.replacement_terminal_evidence.lane_records.map((record) => [record.lane_id, record]))
  return input.risk_result.global_source_event_queue.filter((event): event is ReplayRuntimeSharedWalletFundingEvent => {
    if (event.event_role !== "funding" || event.outcome !== "applied") return false
    const record = records.get(event.lane_id)
    return Boolean(record?.terminal_time && (event.event_time > record.terminal_time
      || event.event_time === record.terminal_time && event.boundary_phase >= (record.terminal_phase ?? 20)))
  })
}

function validateInput(config: ReplayPortfolioProtectiveReplacementTerminalAccountingCommonConfig,
  input: ReplayPortfolioProtectiveReplacementTerminalAccountingCommonInput): void {
  config.assert_terminal_evidence(input.replacement_terminal_evidence)
  config.assert_terminal_manifest(input.replacement_terminal_manifest)
  if (input.risk_result.result_hash !== replayRuntimeSharedWalletRiskResultHash(input.risk_result)
      || input.replacement_terminal_manifest.replacement_terminal_evidence_hash
        !== input.replacement_terminal_evidence.evidence_hash
      || input.replacement_terminal_evidence.risk_result_hash !== input.risk_result.result_hash
      || input.replacement_terminal_evidence.portfolio_id !== input.risk_result.portfolio_id
      || input.replacement_terminal_evidence.shared_initial_cash !== input.risk_result.shared_initial_cash
      || input.replacement_terminal_evidence.settlement_asset !== input.risk_result.settlement_asset) {
    throw new Error("Replacement terminal accounting source closure drift")
  }
}

function leg(account: JournalAccount, debit: number, credit: number): JournalLeg {
  return { account, debit, credit }
}
