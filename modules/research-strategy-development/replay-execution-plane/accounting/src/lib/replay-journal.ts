import {
  REPLAY_JOURNAL_POLICY_VERSION,
  REPLAY_EQUITY_POLICY_VERSION,
  REPLAY_MARGIN_POLICY_VERSION,
  assertReplayEventKey,
  compareReplayEventKeys,
  type ReplayJournalAccount,
  type ReplayJournalEntry,
  type ReplayJournalLeg,
  type ReplayLedgerEntry,
  type ReplayEquityBridge,
  type ReplayMarginSnapshot,
  type ReplayTrialBalance,
  type ReplayValuationSnapshot,
} from "../../../contracts/src/lib/replay-contracts"
import { addReplayDecimalValues, isReplayIncrementAligned } from "../../../contracts/src/lib/replay-decimal"

export interface ReplayJournalInput {
  run_id: string
  settlement_asset: string
  settlement_increment: string
  ledger: ReplayLedgerEntry[]
  valuation_snapshot: ReplayValuationSnapshot
  equity_bridge: ReplayEquityBridge
  margin_snapshots: ReplayMarginSnapshot[]
}

export interface ReplayJournalProjection {
  journal: ReplayJournalEntry[]
  trial_balance: ReplayTrialBalance
}

const ACCOUNT_ORDER: ReplayJournalAccount[] = [
  "wallet_cash",
  "isolated_margin_collateral",
  "opening_equity",
  "realized_pnl_income",
  "realized_pnl_loss",
  "fee_expense",
  "liquidation_fee_expense",
  "funding_income",
  "funding_expense",
  "position_valuation",
  "unrealized_pnl_income",
  "unrealized_pnl_loss",
]

export function buildReplayJournal(input: ReplayJournalInput): ReplayJournalProjection {
  validateJournalInput(input)
  const journal: ReplayJournalEntry[] = []
  const opening = input.ledger[0]
  appendJournalEntry(input, journal, {
    event_key: opening.event_key,
    timestamp: opening.timestamp,
    kind: "opening_balance",
    ref: opening.ref,
    amount: opening.amount,
    debit: "wallet_cash",
    credit: "opening_equity",
  })

  const neverOpened = input.equity_bridge.terminal_position_state === "never_opened"
  if (!neverOpened) {
    const postEntryMargin = input.margin_snapshots[0]
    appendJournalEntry(input, journal, {
      event_key: postEntryMargin.event_key,
      timestamp: postEntryMargin.timestamp,
      kind: "collateral_reserve",
      ref: postEntryMargin.snapshot_id,
      amount: postEntryMargin.isolated_collateral,
      debit: "isolated_margin_collateral",
      credit: "wallet_cash",
    })
  }

  for (const ledgerEntry of input.ledger.slice(1, -1)) {
    if (ledgerEntry.kind === "trade_cash") throw new Error("trade_cash is unsupported by journal policy v5")
    if (ledgerEntry.kind === "initial_cash" || ledgerEntry.kind === "ending_cash") {
      throw new Error("Replay cash checkpoints cannot appear inside the journal fact stream")
    }
    const accounts = journalAccounts(ledgerEntry)
    appendJournalEntry(input, journal, {
      event_key: ledgerEntry.event_key,
      timestamp: ledgerEntry.timestamp,
      kind: ledgerEntry.kind,
      ref: ledgerEntry.ref,
      amount: Math.abs(ledgerEntry.amount),
      ...accounts,
    })
  }

  if (input.equity_bridge.terminal_position_state === "flat") {
    const terminalMargin = input.margin_snapshots.at(-1)!
    appendJournalEntry(input, journal, {
      event_key: terminalMargin.event_key,
      timestamp: terminalMargin.timestamp,
      kind: "collateral_release",
      ref: terminalMargin.snapshot_id,
      amount: endingCollateralBalance(input),
      debit: "wallet_cash",
      credit: "isolated_margin_collateral",
    })
  }

  const valuationAmount = Math.abs(input.valuation_snapshot.unrealized_pnl)
  const valuationAccounts = input.valuation_snapshot.unrealized_pnl >= 0
    ? { debit: "position_valuation" as const, credit: "unrealized_pnl_income" as const }
    : { debit: "unrealized_pnl_loss" as const, credit: "position_valuation" as const }
  appendJournalEntry(input, journal, {
    event_key: input.valuation_snapshot.event_key,
    timestamp: input.valuation_snapshot.timestamp,
    kind: "mark_to_market",
    ref: input.valuation_snapshot.valuation_id,
    amount: valuationAmount,
    ...valuationAccounts,
  })

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
  const walletCashBalance = accountBalances.find((item) => item.account === "wallet_cash")!.net_debit
  const isolatedMarginCollateralBalance = accountBalances.find((item) => item.account === "isolated_margin_collateral")!.net_debit
  const settledCashBalance = addReplayDecimalValues(walletCashBalance, isolatedMarginCollateralBalance)
  const positionValuationBalance = accountBalances.find((item) => item.account === "position_valuation")!.net_debit
  const endingEquity = addReplayDecimalValues(settledCashBalance, positionValuationBalance)
  if (settledCashBalance !== input.equity_bridge.cash_balance
      || isolatedMarginCollateralBalance !== (input.equity_bridge.terminal_position_state === "open" ? endingCollateralBalance(input) : 0)
      || positionValuationBalance !== input.equity_bridge.position_valuation
      || endingEquity !== input.equity_bridge.ending_equity) {
    throw new Error("Replay journal does not reconcile to the equity bridge")
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
      isolated_margin_collateral_balance: isolatedMarginCollateralBalance,
      settled_cash_balance: settledCashBalance,
      position_valuation_balance: positionValuationBalance,
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
      || input.ledger.at(-1)?.kind !== "ending_cash") {
    throw new Error("Replay journal requires initial_cash and ending_cash checkpoints")
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
    } else if (entry.kind === "ending_cash") {
      if (index !== input.ledger.length - 1 || entry.amount !== 0 || entry.balance_after !== balance) {
        throw new Error("Replay ending cash checkpoint does not reconcile")
      }
      continue
    } else {
      if (entry.kind === "trade_cash") throw new Error("trade_cash is unsupported by journal policy v5")
      if ((entry.kind === "fee" || entry.kind === "liquidation_fee") && entry.amount > 0) throw new Error("Replay fee ledger facts must be non-positive")
      balance = addReplayDecimalValues(balance, entry.amount)
    }
    if (entry.balance_after !== balance) throw new Error("Replay ledger running balance does not reconcile")
  }
  const valuation = input.valuation_snapshot
  const endingCash = input.ledger.at(-1)!.balance_after
  const terminalState = valuation.position_event_id === null
    ? "never_opened" as const
    : valuation.signed_quantity === 0 ? "flat" as const : "open" as const
  if (input.equity_bridge.policy_version !== REPLAY_EQUITY_POLICY_VERSION
      || input.equity_bridge.reconciled !== true
      || valuation.valuation_id !== input.equity_bridge.valuation_id
      || valuation.settlement_asset !== input.settlement_asset
      || input.equity_bridge.settlement_asset !== input.settlement_asset
      || valuation.timestamp !== valuation.event_key.event_time
      || compareReplayEventKeys(input.ledger.at(-1)!.event_key, valuation.event_key) !== 0
      || input.equity_bridge.terminal_position_state !== terminalState
      || valuation.unrealized_pnl !== input.equity_bridge.position_valuation
      || endingCash !== input.equity_bridge.cash_balance
      || addReplayDecimalValues(endingCash, valuation.unrealized_pnl) !== input.equity_bridge.ending_equity
      || (terminalState === "never_opened" && (
        valuation.signed_quantity !== 0 || valuation.average_entry_price !== null || valuation.unrealized_pnl !== 0
      ))
      || (terminalState === "flat" && (valuation.average_entry_price !== null || valuation.unrealized_pnl !== 0))
      || (terminalState === "open" && valuation.average_entry_price === null)) {
    throw new Error("Replay valuation and equity bridge binding is invalid")
  }
  if (!isReplayIncrementAligned(valuation.unrealized_pnl, input.settlement_increment)
      || !isReplayIncrementAligned(input.equity_bridge.cash_balance, input.settlement_increment)
      || !isReplayIncrementAligned(input.equity_bridge.position_valuation, input.settlement_increment)
      || !isReplayIncrementAligned(input.equity_bridge.ending_equity, input.settlement_increment)) {
    throw new Error("Replay valuation and equity bridge must align to settlement increment")
  }
  validateMarginBinding(input, terminalState)
}

function journalAccounts(entry: ReplayLedgerEntry): { debit: ReplayJournalAccount; credit: ReplayJournalAccount } {
  if (entry.kind === "fee") return { debit: "fee_expense", credit: "isolated_margin_collateral" }
  if (entry.kind === "liquidation_fee") return { debit: "liquidation_fee_expense", credit: "isolated_margin_collateral" }
  if (entry.kind === "funding") return entry.amount >= 0
    ? { debit: "isolated_margin_collateral", credit: "funding_income" }
    : { debit: "funding_expense", credit: "isolated_margin_collateral" }
  if (entry.kind === "realized_pnl") return entry.amount >= 0
    ? { debit: "isolated_margin_collateral", credit: "realized_pnl_income" }
    : { debit: "realized_pnl_loss", credit: "isolated_margin_collateral" }
  throw new Error(`unsupported Replay journal fact: ${entry.kind}`)
}

function validateMarginBinding(input: ReplayJournalInput, terminalState: "open" | "flat" | "never_opened"): void {
  const snapshots = input.margin_snapshots
  if (terminalState === "never_opened") {
    if (snapshots.length !== 0) throw new Error("Replay never-opened journal cannot carry Margin facts")
    return
  }
  if (snapshots.length < 2 || snapshots[0].stage !== "post_entry" || snapshots.at(-1)?.stage !== "terminal") {
    throw new Error("Replay journal requires post-entry and terminal margin snapshots")
  }
  for (const [index, snapshot] of snapshots.entries()) {
    if (snapshot.policy_version !== REPLAY_MARGIN_POLICY_VERSION
        || snapshot.snapshot_sequence !== index + 1
        || snapshot.timestamp !== snapshot.event_key.event_time
        || snapshot.collateral_asset !== input.settlement_asset
        || (index > 0 && compareReplayEventKeys(snapshots[index - 1].event_key, snapshot.event_key) > 0)) {
      throw new Error("Replay margin snapshots are not a valid ordered journal source")
    }
  }
  const postEntry = snapshots[0]
  const terminal = snapshots.at(-1)!
  if (postEntry.isolated_collateral <= 0
      || compareReplayEventKeys(input.ledger[0].event_key, postEntry.event_key) >= 0
      || compareReplayEventKeys(terminal.event_key, input.valuation_snapshot.event_key) !== 0
      || (terminalState === "flat" && (terminal.state !== "flat" || terminal.isolated_collateral !== 0))
      || (terminalState === "open" && (terminal.state === "flat" || terminal.isolated_collateral !== postEntry.isolated_collateral))) {
    throw new Error("Replay margin reserve/release binding is invalid")
  }
  const entryCashflow = attributedSettledCashflow(input.ledger, postEntry.event_key)
  const terminalCashflow = attributedSettledCashflow(input.ledger)
  const collateralBalance = addReplayDecimalValues(postEntry.isolated_collateral, terminalCashflow)
  if (postEntry.attributed_settled_cashflow !== entryCashflow
      || collateralBalance < 0
      || !isReplayIncrementAligned(collateralBalance, input.settlement_increment)
      || (terminalState === "open" && (
        terminal.attributed_settled_cashflow !== terminalCashflow
        || terminal.margin_balance !== addReplayDecimalValues(collateralBalance, terminal.unrealized_pnl)
      ))) {
    throw new Error("Replay isolated collateral does not reconcile to margin snapshots")
  }
}

function endingCollateralBalance(input: ReplayJournalInput): number {
  return addReplayDecimalValues(
    input.margin_snapshots[0].isolated_collateral,
    attributedSettledCashflow(input.ledger),
  )
}

function attributedSettledCashflow(ledger: ReplayLedgerEntry[], through?: ReplayJournalEntry["event_key"]): number {
  return ledger
    .filter((entry) => (entry.kind === "fee" || entry.kind === "liquidation_fee" || entry.kind === "funding" || entry.kind === "realized_pnl")
      && (!through || compareReplayEventKeys(entry.event_key, through) <= 0))
    .reduce((total, entry) => addReplayDecimalValues(total, entry.amount), 0)
}

function appendJournalEntry(
  input: ReplayJournalInput,
  journal: ReplayJournalEntry[],
  fact: {
    event_key: ReplayJournalEntry["event_key"]
    timestamp: string
    kind: ReplayJournalEntry["kind"]
    ref: string
    amount: number
    debit: ReplayJournalAccount
    credit: ReplayJournalAccount
  },
): void {
  if (!Number.isFinite(fact.amount) || fact.amount < 0 || !isReplayIncrementAligned(fact.amount, input.settlement_increment)) {
    throw new Error("Replay journal entry amount must be non-negative and settlement-increment aligned")
  }
  const journalEntryId = `${input.run_id}:journal:${journal.length + 1}`
  journal.push({
    journal_entry_id: journalEntryId,
    event_key: fact.event_key,
    timestamp: fact.timestamp,
    kind: fact.kind,
    ref: fact.ref,
    policy_version: REPLAY_JOURNAL_POLICY_VERSION,
    legs: [
      leg(journalEntryId, 1, fact.debit, "debit", input.settlement_asset, fact.amount),
      leg(journalEntryId, 2, fact.credit, "credit", input.settlement_asset, fact.amount),
    ],
  })
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
