import {
  REPLAY_JOURNAL_POLICY_VERSION,
  assertReplayEventKey,
  compareReplayEventKeys,
  type ReplayJournalAccount,
  type ReplayJournalEntry,
  type ReplayJournalLeg,
  type ReplayLedgerEntry,
  type ReplayTrialBalance,
} from "../../../contracts/src/lib/replay-contracts"
import { addReplayDecimalValues, isReplayIncrementAligned } from "../../../contracts/src/lib/replay-decimal"

export interface ReplayJournalInput {
  run_id: string
  settlement_asset: string
  settlement_increment: string
  ledger: ReplayLedgerEntry[]
}

export interface ReplayJournalProjection {
  journal: ReplayJournalEntry[]
  trial_balance: ReplayTrialBalance
}

const ACCOUNT_ORDER: ReplayJournalAccount[] = [
  "wallet_cash",
  "opening_equity",
  "realized_pnl_income",
  "realized_pnl_loss",
  "fee_expense",
  "funding_income",
  "funding_expense",
]

export function buildReplayJournal(input: ReplayJournalInput): ReplayJournalProjection {
  validateJournalInput(input)
  const journal: ReplayJournalEntry[] = []
  let walletCashBalance = 0

  for (const ledgerEntry of input.ledger) {
    if (ledgerEntry.kind === "ending_equity") continue
    if (ledgerEntry.kind === "trade_cash") throw new Error("trade_cash is unsupported by journal policy v1")
    const accounts = journalAccounts(ledgerEntry)
    const amount = Math.abs(ledgerEntry.amount)
    const journalEntryId = `${input.run_id}:journal:${journal.length + 1}`
    const legs: [ReplayJournalLeg, ReplayJournalLeg] = [
      leg(journalEntryId, 1, accounts.debit, "debit", input.settlement_asset, amount),
      leg(journalEntryId, 2, accounts.credit, "credit", input.settlement_asset, amount),
    ]
    journal.push({
      journal_entry_id: journalEntryId,
      event_key: ledgerEntry.event_key,
      timestamp: ledgerEntry.timestamp,
      kind: ledgerEntry.kind === "initial_cash" ? "opening_balance" : ledgerEntry.kind,
      ref: ledgerEntry.ref,
      policy_version: REPLAY_JOURNAL_POLICY_VERSION,
      legs,
    })
    for (const item of legs) {
      if (item.account !== "wallet_cash") continue
      walletCashBalance = addReplayDecimalValues(walletCashBalance, item.side === "debit" ? item.amount : -item.amount)
    }
  }

  const debitTotal = journal.reduce((total, entry) => addReplayDecimalValues(
    total, entry.legs.filter((item) => item.side === "debit").reduce((sum, item) => addReplayDecimalValues(sum, item.amount), 0),
  ), 0)
  const creditTotal = journal.reduce((total, entry) => addReplayDecimalValues(
    total, entry.legs.filter((item) => item.side === "credit").reduce((sum, item) => addReplayDecimalValues(sum, item.amount), 0),
  ), 0)
  if (debitTotal !== creditTotal) throw new Error("Replay journal trial balance is not balanced")

  const accountBalances = ACCOUNT_ORDER.map((account) => {
    let debit = 0
    let credit = 0
    for (const entry of journal) {
      for (const item of entry.legs) {
        if (item.account !== account) continue
        if (item.side === "debit") debit = addReplayDecimalValues(debit, item.amount)
        else credit = addReplayDecimalValues(credit, item.amount)
      }
    }
    return {
      account,
      debit_total: debit,
      credit_total: credit,
      net_debit: addReplayDecimalValues(debit, -credit),
    }
  })
  const endingEquity = input.ledger.at(-1)!.balance_after
  if (walletCashBalance !== endingEquity) {
    throw new Error("Replay journal wallet cash does not reconcile to ending equity")
  }
  return {
    journal,
    trial_balance: {
      policy_version: REPLAY_JOURNAL_POLICY_VERSION,
      settlement_asset: input.settlement_asset,
      debit_total: debitTotal,
      credit_total: creditTotal,
      account_balances: accountBalances,
      wallet_cash_balance: walletCashBalance,
      ending_equity: endingEquity,
      balanced: true,
    },
  }
}

function validateJournalInput(input: ReplayJournalInput): void {
  if (input.run_id.trim() === "") throw new Error("Replay journal run_id is required")
  if (!/^[A-Z0-9]{2,16}$/.test(input.settlement_asset)) throw new Error("Replay journal settlement asset is invalid")
  if (input.ledger.length < 2
      || input.ledger[0].kind !== "initial_cash"
      || input.ledger.at(-1)?.kind !== "ending_equity") {
    throw new Error("Replay journal requires initial_cash and ending_equity checkpoints")
  }
  const entryIds = new Set<string>()
  let balance = 0
  for (const [index, entry] of input.ledger.entries()) {
    assertReplayEventKey(entry.event_key)
    if (entry.timestamp !== entry.event_key.event_time) throw new Error("Replay ledger timestamp must equal EventKey time")
    if (entry.entry_id.trim() === "" || entry.ref.trim() === "") throw new Error("Replay ledger entry id and ref are required")
    if (entryIds.has(entry.entry_id)) throw new Error("Replay ledger entry ids must be unique")
    entryIds.add(entry.entry_id)
    if (!Number.isFinite(entry.amount) || !Number.isFinite(entry.balance_after)) throw new Error("Replay ledger amounts must be finite")
    if (!isReplayIncrementAligned(entry.amount, input.settlement_increment)
        || !isReplayIncrementAligned(entry.balance_after, input.settlement_increment)) {
      throw new Error("Replay ledger amounts must align to settlement increment")
    }
    if (index > 0 && compareReplayEventKeys(input.ledger[index - 1].event_key, entry.event_key) > 0) {
      throw new Error("Replay ledger EventKeys must be nondecreasing")
    }
    if (entry.kind === "initial_cash") {
      if (index !== 0 || entry.amount <= 0) throw new Error("Replay initial cash must be the positive first ledger fact")
      balance = entry.amount
    } else if (entry.kind === "ending_equity") {
      if (index !== input.ledger.length - 1 || entry.amount !== 0 || entry.balance_after !== balance) {
        throw new Error("Replay ending equity checkpoint does not reconcile")
      }
      continue
    } else {
      if (entry.kind === "trade_cash") throw new Error("trade_cash is unsupported by journal policy v1")
      if (entry.kind === "fee" && entry.amount > 0) throw new Error("Replay fee ledger facts must be non-positive")
      balance = addReplayDecimalValues(balance, entry.amount)
    }
    if (entry.balance_after !== balance) throw new Error("Replay ledger running balance does not reconcile")
  }
}

function journalAccounts(entry: ReplayLedgerEntry): { debit: ReplayJournalAccount; credit: ReplayJournalAccount } {
  if (entry.kind === "initial_cash") return { debit: "wallet_cash", credit: "opening_equity" }
  if (entry.kind === "fee") return { debit: "fee_expense", credit: "wallet_cash" }
  if (entry.kind === "funding") return entry.amount >= 0
    ? { debit: "wallet_cash", credit: "funding_income" }
    : { debit: "funding_expense", credit: "wallet_cash" }
  if (entry.kind === "realized_pnl") return entry.amount >= 0
    ? { debit: "wallet_cash", credit: "realized_pnl_income" }
    : { debit: "realized_pnl_loss", credit: "wallet_cash" }
  throw new Error(`unsupported Replay journal fact: ${entry.kind}`)
}

function leg(
  journalEntryId: string,
  index: number,
  account: ReplayJournalAccount,
  side: ReplayJournalLeg["side"],
  asset: string,
  amount: number,
): ReplayJournalLeg {
  return { leg_id: `${journalEntryId}:leg:${index}`, account, side, asset, amount }
}
