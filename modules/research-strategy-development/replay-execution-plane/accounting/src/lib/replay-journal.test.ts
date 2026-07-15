import { expect, test } from "bun:test"
import {
  REPLAY_EQUITY_POLICY_VERSION,
  REPLAY_MARGIN_POLICY_VERSION,
  type ReplayEventKey,
  type ReplayLedgerEntry,
  type ReplayMarginSnapshot,
} from "../../../contracts/src/lib/replay-contracts"
import { buildReplayJournal, type ReplayJournalInput } from "./replay-journal"

function key(time: string, phase: 20 | 70 | 100, id: string): ReplayEventKey {
  return { event_time: time, boundary_phase: phase, source_sequence: 1, event_subphase: 0, stable_event_id: id }
}

function ledger(): ReplayLedgerEntry[] {
  const initial = key("2026-07-14T00:00:00Z", 70, "initial")
  const entry = key("2026-07-14T04:00:00Z", 20, "entry")
  const exit = key("2026-07-14T08:00:00Z", 20, "exit")
  const ending = key("2026-07-14T08:00:00Z", 100, "ending")
  return [
    { entry_id: "l1", event_key: initial, timestamp: initial.event_time, kind: "initial_cash", amount: 1000, balance_after: 1000, ref: "run" },
    { entry_id: "l2", event_key: entry, timestamp: entry.event_time, kind: "fee", amount: -1, balance_after: 999, ref: "fill-1" },
    { entry_id: "l3", event_key: exit, timestamp: exit.event_time, kind: "realized_pnl", amount: 10, balance_after: 1009, ref: "fill-2" },
    { entry_id: "l4", event_key: exit, timestamp: exit.event_time, kind: "fee", amount: -1, balance_after: 1008, ref: "fill-2" },
    { entry_id: "l5", event_key: ending, timestamp: ending.event_time, kind: "ending_cash", amount: 0, balance_after: 1008, ref: "run" },
  ]
}

function openLedger(): ReplayLedgerEntry[] {
  const initial = key("2026-07-14T00:00:00Z", 70, "initial")
  const entry = key("2026-07-14T04:00:00Z", 20, "entry")
  const ending = key("2026-07-14T08:00:00Z", 100, "ending")
  return [
    { entry_id: "l1", event_key: initial, timestamp: initial.event_time, kind: "initial_cash", amount: 1000, balance_after: 1000, ref: "run" },
    { entry_id: "l2", event_key: entry, timestamp: entry.event_time, kind: "fee", amount: -1, balance_after: 999, ref: "fill-1" },
    { entry_id: "l3", event_key: ending, timestamp: ending.event_time, kind: "ending_cash", amount: 0, balance_after: 999, ref: "run" },
  ]
}

function journalInput(facts: ReplayLedgerEntry[], unrealizedPnl = 0): ReplayJournalInput {
  const ending = facts.at(-1)!
  const open = unrealizedPnl !== 0
  const entry = facts.find((fact) => fact.kind === "fee")!
  return {
    run_id: "run",
    settlement_asset: "USDT",
    settlement_increment: "0.01",
    ledger: facts,
    valuation_snapshot: {
      valuation_id: "valuation-1",
      event_key: ending.event_key,
      timestamp: ending.timestamp,
      position_event_id: "position-1",
      mark_source_ref: open ? "source:bar-range" : "fill-2",
      mark_source: open ? "bar_close" : "fill_price",
      symbol: "BTCUSDT",
      settlement_asset: "USDT",
      mark_price: 110,
      signed_quantity: open ? 1 : 0,
      average_entry_price: open ? 100 : null,
      unrealized_pnl: unrealizedPnl,
    },
    equity_bridge: {
      policy_version: REPLAY_EQUITY_POLICY_VERSION,
      valuation_id: "valuation-1",
      settlement_asset: "USDT",
      terminal_position_state: open ? "open" : "flat",
      cash_balance: ending.balance_after,
      position_valuation: unrealizedPnl,
      ending_equity: ending.balance_after + unrealizedPnl,
      reconciled: true,
    },
    margin_snapshots: marginSnapshots(entry.event_key, ending.event_key, open, unrealizedPnl),
  }
}

function marginSnapshots(entryKey: ReplayEventKey, endingKey: ReplayEventKey, open: boolean, unrealizedPnl: number): ReplayMarginSnapshot[] {
  return [
    {
      policy_version: REPLAY_MARGIN_POLICY_VERSION, snapshot_id: "margin-1", snapshot_sequence: 1, stage: "post_entry",
      event_key: entryKey, timestamp: entryKey.event_time, position_event_id: "position-1", mark_source_ref: "fill-1",
      mark_source: "fill_price", resolution: "exact", symbol: "BTCUSDT", collateral_asset: "USDT", signed_quantity: 1,
      mark_price: 100, notional: 100, isolated_collateral: 20, attributed_settled_cashflow: -1, unrealized_pnl: 0,
      margin_balance: 19, initial_margin_requirement: 10, maintenance_margin_requirement: 5, initial_margin_headroom: 9,
      maintenance_margin_headroom: 14, margin_ratio: 0.263157894737, initial_margin_sufficient: true,
      maintenance_margin_sufficient: true, maintenance_trigger: "margin_balance_below_maintenance_requirement",
      maintenance_breach_observed: false, breach_terminal_priority: "risk_before_strategy_exit",
      state: "healthy", liquidation_evaluated: false,
    },
    {
      policy_version: REPLAY_MARGIN_POLICY_VERSION, snapshot_id: "margin-2", snapshot_sequence: 2, stage: "terminal",
      event_key: endingKey, timestamp: endingKey.event_time, position_event_id: open ? "position-1" : "position-2",
      mark_source_ref: open ? "source:bar-range" : "fill-2", mark_source: open ? "bar_close" : "fill_price",
      resolution: open ? "exact" : "not_applicable_flat", symbol: "BTCUSDT", collateral_asset: "USDT",
      signed_quantity: open ? 1 : 0, mark_price: 110, notional: open ? 110 : 0, isolated_collateral: open ? 20 : 0,
      attributed_settled_cashflow: open ? -1 : 0, unrealized_pnl: open ? unrealizedPnl : 0,
      margin_balance: open ? 19 + unrealizedPnl : 0, initial_margin_requirement: open ? 11 : 0,
      maintenance_margin_requirement: open ? 5.5 : 0, initial_margin_headroom: open ? 8 + unrealizedPnl : 0,
      maintenance_margin_headroom: open ? 13.5 + unrealizedPnl : 0, margin_ratio: open ? 5.5 / (19 + unrealizedPnl) : null,
      initial_margin_sufficient: true, maintenance_margin_sufficient: true, state: open ? "healthy" : "flat",
      maintenance_trigger: "margin_balance_below_maintenance_requirement", maintenance_breach_observed: false,
      breach_terminal_priority: "risk_before_strategy_exit",
      liquidation_evaluated: false,
    },
  ]
}

test("journal projects balanced legs and reconciles wallet cash to ending equity", () => {
  const projection = buildReplayJournal(journalInput(ledger()))
  expect(projection.journal.map((entry) => entry.kind)).toEqual(["opening_balance", "collateral_reserve", "fee", "realized_pnl", "fee", "collateral_release", "mark_to_market"])
  expect(projection.journal.every((entry) => entry.legs[0].amount === entry.legs[1].amount)).toBe(true)
  expect(projection.trial_balance.debit_total).toBe(projection.trial_balance.credit_total)
  expect(projection.trial_balance.wallet_cash_balance).toBe(1008)
  expect(projection.trial_balance.isolated_margin_collateral_balance).toBe(0)
  expect(projection.trial_balance.settled_cash_balance).toBe(1008)
  expect(projection.trial_balance.position_valuation_balance).toBe(0)
  expect(projection.trial_balance.ending_equity).toBe(1008)
  expect(projection.trial_balance.balanced).toBe(true)
})

test("journal rejects a cash checkpoint that does not reconcile", () => {
  const broken = ledger()
  broken[2].balance_after = 9999
  expect(() => buildReplayJournal(journalInput(broken)))
    .toThrow("running balance does not reconcile")
})

test("journal maps signed funding and realized pnl without dropping zero evidence", () => {
  const facts = ledger()
  const eventKey = key("2026-07-14T06:00:00Z", 20, "funding-loss")
  facts.splice(2, 0,
    { entry_id: "funding-loss", event_key: eventKey, timestamp: eventKey.event_time, kind: "funding", amount: -2, balance_after: 997, ref: "funding-1" },
  )
  for (let index = 3; index < facts.length; index += 1) facts[index].balance_after -= 2
  const zeroKey = key("2026-07-14T08:00:00Z", 20, "zero-realized")
  facts.splice(facts.length - 1, 0,
    { entry_id: "zero-realized", event_key: zeroKey, timestamp: zeroKey.event_time, kind: "realized_pnl", amount: 0, balance_after: 1006, ref: "fill-zero" },
  )
  const projection = buildReplayJournal(journalInput(facts))
  expect(projection.journal.find((entry) => entry.ref === "funding-1")?.legs.map((item) => item.account))
    .toEqual(["funding_expense", "isolated_margin_collateral"])
  expect(projection.journal.find((entry) => entry.ref === "fill-zero")?.legs.map((item) => item.amount)).toEqual([0, 0])
  expect(projection.trial_balance.wallet_cash_balance).toBe(1006)
})

test("journal keeps open-position collateral reserved while marking unrealized value", () => {
  const projection = buildReplayJournal(journalInput(openLedger(), 12))
  expect(projection.journal.at(-1)?.legs.map((item) => [item.account, item.side, item.amount])).toEqual([
    ["position_valuation", "debit", 12],
    ["unrealized_pnl_income", "credit", 12],
  ])
  expect(projection.trial_balance.wallet_cash_balance).toBe(980)
  expect(projection.trial_balance.isolated_margin_collateral_balance).toBe(19)
  expect(projection.trial_balance.settled_cash_balance).toBe(999)
  expect(projection.trial_balance.position_valuation_balance).toBe(12)
  expect(projection.trial_balance.ending_equity).toBe(1011)
})

test("journal rejects a valuation that does not bind to the equity bridge", () => {
  const input = journalInput(openLedger(), 12)
  input.equity_bridge.position_valuation = 11
  expect(() => buildReplayJournal(input)).toThrow("valuation and equity bridge binding is invalid")
})
