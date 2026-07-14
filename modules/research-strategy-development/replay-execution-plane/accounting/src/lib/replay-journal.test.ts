import { expect, test } from "bun:test"
import type { ReplayEventKey, ReplayLedgerEntry } from "../../../contracts/src/lib/replay-contracts"
import { buildReplayJournal } from "./replay-journal"

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
    { entry_id: "l5", event_key: ending, timestamp: ending.event_time, kind: "ending_equity", amount: 0, balance_after: 1008, ref: "run" },
  ]
}

test("journal projects balanced legs and reconciles wallet cash to ending equity", () => {
  const projection = buildReplayJournal({ run_id: "run", settlement_asset: "USDT", settlement_increment: "0.01", ledger: ledger() })
  expect(projection.journal.map((entry) => entry.kind)).toEqual(["opening_balance", "fee", "realized_pnl", "fee"])
  expect(projection.journal.every((entry) => entry.legs[0].amount === entry.legs[1].amount)).toBe(true)
  expect(projection.trial_balance.debit_total).toBe(projection.trial_balance.credit_total)
  expect(projection.trial_balance.wallet_cash_balance).toBe(1008)
  expect(projection.trial_balance.ending_equity).toBe(1008)
  expect(projection.trial_balance.balanced).toBe(true)
})

test("journal rejects a cash checkpoint that does not reconcile", () => {
  const broken = ledger()
  broken[2].balance_after = 9999
  expect(() => buildReplayJournal({ run_id: "run", settlement_asset: "USDT", settlement_increment: "0.01", ledger: broken }))
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
  const projection = buildReplayJournal({ run_id: "run", settlement_asset: "USDT", settlement_increment: "0.01", ledger: facts })
  expect(projection.journal.find((entry) => entry.ref === "funding-1")?.legs.map((item) => item.account))
    .toEqual(["funding_expense", "wallet_cash"])
  expect(projection.journal.find((entry) => entry.ref === "fill-zero")?.legs.map((item) => item.amount)).toEqual([0, 0])
  expect(projection.trial_balance.wallet_cash_balance).toBe(1006)
})
