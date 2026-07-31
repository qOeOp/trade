import {
  REPLAY_PORTFOLIO_EVIDENCE_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_FINGERPRINT_POLICY_VERSION,
  REPLAY_PORTFOLIO_JOURNAL_POLICY_VERSION,
  assertReplayRuntimeSharedWalletPortfolioEvidence,
  replayPortfolioEvidenceHash,
  replayPortfolioFingerprintHash,
  replayPortfolioJournalEntryHash,
  replayPortfolioLedgerEntryHash,
  replayPortfolioTrialBalanceHash,
  type ReplayPortfolioEvidenceFingerprint,
  type ReplayPortfolioEvidenceAuthorityBinding,
  type ReplayPortfolioJournalAccount,
  type ReplayPortfolioJournalEntry,
  type ReplayPortfolioJournalLeg,
  type ReplayPortfolioLedgerEntry,
  type ReplayPortfolioTrialBalance,
  type ReplayRuntimeSharedWalletPortfolioEvidence,
} from "../../../contracts/src/lib/replay-runtime-shared-wallet-artifact-contracts"
import {
  assertReplayRuntimeSharedWalletRiskPlan,
  assertReplayRuntimeSharedWalletRiskResult,
  type ReplayRuntimeSharedWalletRiskPlan,
  type ReplayRuntimeSharedWalletRiskQueueEvent,
  type ReplayRuntimeSharedWalletRiskResult,
} from "../../../contracts/src/lib/replay-runtime-shared-wallet-risk-contracts"
import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import type { ReplayPortfolioAllocationResult } from "../../../contracts/src/lib/replay-portfolio-allocation-contracts"

const ACCOUNTS: ReplayPortfolioJournalAccount[] = [
  "wallet_cash", "isolated_margin_collateral", "position_valuation", "opening_equity",
  "realized_pnl_income", "realized_pnl_loss", "funding_income", "funding_expense",
  "fee_expense", "liquidation_fee_expense", "unrealized_pnl_income", "unrealized_pnl_loss",
]

const CREDIT_NORMAL = new Set<ReplayPortfolioJournalAccount>([
  "opening_equity", "realized_pnl_income", "funding_income", "unrealized_pnl_income",
])

export interface ReplayRuntimeSharedWalletPortfolioAccountingInput {
  plan: ReplayRuntimeSharedWalletRiskPlan
  risk_reservation: ReplayPortfolioEvidenceAuthorityBinding
  risk_result: ReplayRuntimeSharedWalletRiskResult
  allocation_result?: ReplayPortfolioAllocationResult
}

export function createReplayRuntimeSharedWalletPortfolioEvidence(
  input: ReplayRuntimeSharedWalletPortfolioAccountingInput,
): ReplayRuntimeSharedWalletPortfolioEvidence {
  assertReplayRuntimeSharedWalletRiskPlan(input.plan)
  assertPortfolioAuthority(input.risk_reservation)
  assertReplayRuntimeSharedWalletRiskResult(
    input.risk_result, input.plan, input.risk_reservation, input.allocation_result,
  )

  const ledger = createLedger(input.risk_result)
  const journal = createJournal(input.risk_reservation, input.risk_result)
  const trialBalance = createTrialBalance(input.risk_result, journal)
  const fingerprint = createFingerprint(input, ledger, journal, trialBalance)
  const body: Omit<ReplayRuntimeSharedWalletPortfolioEvidence, "evidence_hash"> = {
    schema_version: REPLAY_PORTFOLIO_EVIDENCE_SCHEMA_VERSION,
    portfolio_id: input.plan.portfolio_id,
    portfolio_plan_hash: input.plan.plan_hash,
    risk_reservation_hash: input.risk_reservation.reservation_hash,
    risk_result_hash: input.risk_result.result_hash,
    portfolio_ledger: ledger,
    portfolio_journal: journal,
    trial_balance: trialBalance,
    fingerprint,
  }
  const evidence = { ...body, evidence_hash: replayPortfolioEvidenceHash(body as ReplayRuntimeSharedWalletPortfolioEvidence) }
  assertReplayRuntimeSharedWalletPortfolioEvidence(evidence)
  return evidence
}

function createLedger(result: ReplayRuntimeSharedWalletRiskResult): ReplayPortfolioLedgerEntry[] {
  const entries: ReplayPortfolioLedgerEntry[] = []
  let settledCash = result.shared_initial_cash
  const append = (
    event: ReplayRuntimeSharedWalletRiskQueueEvent,
    cashflowKind: ReplayPortfolioLedgerEntry["cashflow_kind"],
    amount: number,
  ) => {
    if (amount === 0) return
    settledCash = add(settledCash, amount)
    const body: Omit<ReplayPortfolioLedgerEntry, "ledger_entry_hash"> = {
      ledger_sequence: entries.length + 1,
      queue_ordinal: event.queue_ordinal,
      source_event_hash: event.event_hash,
      event_time: event.event_time,
      lane_id: event.lane_id,
      symbol: event.symbol,
      cashflow_kind: cashflowKind,
      amount,
      settled_cash_after: settledCash,
    }
    entries.push({ ...body, ledger_entry_hash: replayPortfolioLedgerEntryHash(body as ReplayPortfolioLedgerEntry) })
  }
  for (const event of result.global_source_event_queue) {
    if (event.event_role === "entry" && event.outcome === "filled") append(event, "entry_fee", -event.fee)
    if (event.event_role === "funding" && event.outcome === "applied") append(event, "funding", event.funding_cashflow)
    if (event.event_role === "exit" && event.outcome === "filled") {
      append(event, "realized_pnl", event.realized_pnl)
      append(event, "strategy_exit_fee", -event.fee)
    }
    if (event.event_role === "liquidation") {
      append(event, "realized_pnl", event.realized_pnl)
      append(event, "liquidation_trading_fee", -event.trading_fee)
      append(event, "liquidation_fee", -event.liquidation_fee)
    }
  }
  if (settledCash !== result.ending_settled_cash) {
    throw new Error("runtime shared wallet Portfolio Ledger does not reconcile ending settled cash")
  }
  return entries
}

function createJournal(
  authority: ReplayPortfolioEvidenceAuthorityBinding,
  result: ReplayRuntimeSharedWalletRiskResult,
): ReplayPortfolioJournalEntry[] {
  const entries: ReplayPortfolioJournalEntry[] = []
  const post = (
    source: ReplayRuntimeSharedWalletRiskQueueEvent | null,
    kind: ReplayPortfolioJournalEntry["posting_kind"],
    debit: ReplayPortfolioJournalAccount,
    credit: ReplayPortfolioJournalAccount,
    amount: number,
    laneId = source?.lane_id ?? null,
  ) => {
    if (amount === 0) return
    if (!Number.isFinite(amount) || amount < 0) throw new Error("Portfolio journal posting amount must be positive")
    const body: Omit<ReplayPortfolioJournalEntry, "journal_entry_hash"> = {
      journal_sequence: entries.length + 1,
      event_time: source?.event_time ?? authority.issued_at,
      queue_ordinal: source?.queue_ordinal ?? null,
      source_event_hash: source?.event_hash ?? null,
      lane_id: laneId,
      posting_kind: kind,
      legs: [leg(debit, amount, 0), leg(credit, 0, amount)],
    }
    entries.push({ ...body, journal_entry_hash: replayPortfolioJournalEntryHash(body as ReplayPortfolioJournalEntry) })
  }
  post(null, "opening_cash", "wallet_cash", "opening_equity", result.shared_initial_cash)
  for (const event of result.global_source_event_queue) {
    if (event.event_role === "entry" && event.outcome === "filled") {
      post(event, "collateral_reserve", "isolated_margin_collateral", "wallet_cash", event.isolated_collateral)
      post(event, "entry_fee", "fee_expense", "wallet_cash", event.fee)
    } else if (event.event_role === "funding" && event.outcome === "applied") {
      postSignedIncome(event, "funding", event.funding_cashflow, "funding_income", "funding_expense", post)
    } else if (event.event_role === "exit" && event.outcome === "filled") {
      postSignedIncome(event, "realized_pnl", event.realized_pnl, "realized_pnl_income", "realized_pnl_loss", post)
      post(event, "strategy_exit_fee", "fee_expense", "wallet_cash", event.fee)
      post(event, "collateral_release", "wallet_cash", "isolated_margin_collateral", event.released_collateral)
    } else if (event.event_role === "liquidation") {
      postSignedIncome(event, "realized_pnl", event.realized_pnl, "realized_pnl_income", "realized_pnl_loss", post)
      post(event, "liquidation_trading_fee", "fee_expense", "wallet_cash", event.trading_fee)
      post(event, "liquidation_fee", "liquidation_fee_expense", "wallet_cash", event.liquidation_fee)
      post(event, "collateral_release", "wallet_cash", "isolated_margin_collateral", event.released_collateral)
    }
  }
  const eventByHash = new Map(result.global_source_event_queue.map((event) => [event.event_hash, event]))
  for (const position of result.open_positions) {
    const source = [...result.global_source_event_queue].reverse().find(
      (event) => event.lane_id === position.lane_id && event.event_role === "risk_observation",
    ) ?? eventByHash.get(position.entry_fill_hash) ?? null
    if (position.unrealized_pnl > 0) {
      post(source, "terminal_mark_to_market", "position_valuation", "unrealized_pnl_income", position.unrealized_pnl,
        position.lane_id)
    } else if (position.unrealized_pnl < 0) {
      post(source, "terminal_mark_to_market", "unrealized_pnl_loss", "position_valuation", -position.unrealized_pnl,
        position.lane_id)
    }
  }
  return entries
}

type Post = (
  source: ReplayRuntimeSharedWalletRiskQueueEvent | null,
  kind: ReplayPortfolioJournalEntry["posting_kind"],
  debit: ReplayPortfolioJournalAccount,
  credit: ReplayPortfolioJournalAccount,
  amount: number,
  laneId?: string | null,
) => void

function postSignedIncome(
  event: ReplayRuntimeSharedWalletRiskQueueEvent,
  kind: "funding" | "realized_pnl",
  amount: number,
  income: "funding_income" | "realized_pnl_income",
  loss: "funding_expense" | "realized_pnl_loss",
  post: Post,
): void {
  if (amount > 0) post(event, kind, "wallet_cash", income, amount)
  if (amount < 0) post(event, kind, loss, "wallet_cash", -amount)
}

function createTrialBalance(
  result: ReplayRuntimeSharedWalletRiskResult,
  journal: ReplayPortfolioJournalEntry[],
): ReplayPortfolioTrialBalance {
  const raw = Object.fromEntries(ACCOUNTS.map((account) => [account, 0])) as Record<ReplayPortfolioJournalAccount, number>
  let totalDebits = 0
  let totalCredits = 0
  for (const entry of journal) {
    for (const item of entry.legs) {
      totalDebits = add(totalDebits, item.debit)
      totalCredits = add(totalCredits, item.credit)
      raw[item.account] = add(raw[item.account], item.debit, -item.credit)
    }
  }
  const balances = Object.fromEntries(ACCOUNTS.map((account) => [
    account, CREDIT_NORMAL.has(account) ? -raw[account] : raw[account],
  ])) as Record<ReplayPortfolioJournalAccount, number>
  const body: Omit<ReplayPortfolioTrialBalance, "trial_balance_hash"> = {
    settlement_asset: result.settlement_asset,
    journal_policy_version: REPLAY_PORTFOLIO_JOURNAL_POLICY_VERSION,
    total_debits: totalDebits,
    total_credits: totalCredits,
    balances,
    ending_available_cash: result.ending_available_cash,
    ending_reserved_isolated_collateral: result.ending_reserved_isolated_collateral,
    ending_settled_cash: result.ending_settled_cash,
    ending_unrealized_pnl: result.ending_unrealized_pnl,
    ending_portfolio_nav: result.ending_portfolio_nav,
    balanced: true,
  }
  const value = { ...body, trial_balance_hash: replayPortfolioTrialBalanceHash(body as ReplayPortfolioTrialBalance) }
  if (balances.wallet_cash !== result.ending_available_cash
      || balances.isolated_margin_collateral !== result.ending_reserved_isolated_collateral
      || balances.position_valuation !== result.ending_unrealized_pnl
      || totalDebits !== totalCredits) {
    throw new Error("runtime shared wallet Portfolio Trial Balance does not reconcile Result")
  }
  return value
}

function createFingerprint(
  input: ReplayRuntimeSharedWalletPortfolioAccountingInput,
  ledger: ReplayPortfolioLedgerEntry[],
  journal: ReplayPortfolioJournalEntry[],
  trialBalance: ReplayPortfolioTrialBalance,
): ReplayPortfolioEvidenceFingerprint {
  const plan = input.plan
  const authority = input.risk_reservation
  const result = input.risk_result
  const body: Omit<ReplayPortfolioEvidenceFingerprint, "fingerprint_hash"> = {
    fingerprint_policy_version: REPLAY_PORTFOLIO_FINGERPRINT_POLICY_VERSION,
    experiment_id: authority.experiment_id,
    trial_group_id: authority.trial_group_id,
    trial_group_hash: authority.trial_group_hash,
    portfolio_id: plan.portfolio_id,
    portfolio_plan_hash: plan.plan_hash,
    risk_reservation_hash: authority.reservation_hash,
    risk_result_hash: result.result_hash,
    lane_authority_hash: canonicalHash(authority.lanes),
    request_set_hash: canonicalHash(plan.lanes.map((lane) => ({ lane_id: lane.lane_id, request_hash: lane.request_hash }))),
    trial_reservation_set_hash: canonicalHash(plan.lanes.map((lane) => ({
      lane_id: lane.lane_id, trial_reservation_hash: lane.trial_reservation_hash,
    }))),
    attempt_lease_set_hash: canonicalHash(plan.lanes.map((lane) => ({
      lane_id: lane.lane_id, attempt_lease_hash: lane.attempt_lease_hash,
    }))),
    dataset_source_set_hash: canonicalHash(plan.lanes.map((lane) => ({
      lane_id: lane.lane_id,
      funding_events_hash: lane.funding_events_hash,
      mark_events_hash: lane.mark_events_hash,
      venue_risk_policy_epochs_hash: lane.venue_risk_policy_epochs_hash,
      instrument_status_epochs_hash: lane.instrument_status_epochs_hash,
      price_increment: lane.price_increment,
      settlement_increment: lane.settlement_increment,
    }))),
    cost_policy_set_hash: canonicalHash(plan.lanes.map((lane) => ({
      lane_id: lane.lane_id, fee_bps: lane.fee_bps, slippage_bps: lane.slippage_bps,
    }))),
    simulator_policy_version: "runtime_shared_wallet_exact_risk_full_liquidation_v1",
    event_ordering_policy: "funding_then_exact_risk_then_liquidation_then_exit_then_entry_then_control_plane_priority",
    event_queue_hash: canonicalHash(result.global_source_event_queue),
    open_positions_hash: canonicalHash(result.open_positions),
    closed_positions_hash: canonicalHash(result.closed_positions),
    portfolio_ledger_hash: canonicalHash(ledger),
    portfolio_journal_hash: canonicalHash(journal),
    trial_balance_hash: trialBalance.trial_balance_hash,
    limitations_hash: canonicalHash(result.limitations),
  }
  return { ...body, fingerprint_hash: replayPortfolioFingerprintHash(body as ReplayPortfolioEvidenceFingerprint) }
}

function leg(account: ReplayPortfolioJournalAccount, debit: number, credit: number): ReplayPortfolioJournalLeg {
  return { account, debit, credit }
}

function add(...values: number[]): number {
  return Number(values.reduce((sum, value) => sum + value, 0).toFixed(12))
}

function assertPortfolioAuthority(value: ReplayPortfolioEvidenceAuthorityBinding): void {
  if (value.experiment_id.trim() === "" || value.trial_group_id.trim() === ""
      || !/^[a-f0-9]{64}$/.test(value.trial_group_hash)
      || !value.issued_at.endsWith("Z") || !Number.isFinite(Date.parse(value.issued_at))) {
    throw new Error("runtime shared wallet Portfolio authority evidence is invalid")
  }
}
