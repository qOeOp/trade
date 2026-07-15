import { expect, test } from "bun:test"
import {
  REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION,
  REPLAY_NUMERIC_POLICY_VERSION,
  type ReplayEventKey,
  type ReplayInstrumentAccountingSpec,
  type ReplayLedgerEntry,
  type ReplayPositionProjection,
} from "../../../contracts/src/lib/replay-contracts"
import { buildReplayEquityProjection } from "./replay-equity"

const SPEC: ReplayInstrumentAccountingSpec = {
  spec_version: REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION,
  product_type: "linear_derivative",
  base_asset: "BTC",
  quote_asset: "USDT",
  settlement_asset: "USDT",
  contract_multiplier: "1",
  price_increment: "0.01",
  quantity_increment: "0.001",
  settlement_increment: "0.00000001",
}

function key(time: string, phase: 20 | 70 | 100, id: string): ReplayEventKey {
  return { event_time: time, boundary_phase: phase, source_sequence: 1, event_subphase: 0, stable_event_id: id }
}

function position(side: "long" | "short" | "flat"): ReplayPositionProjection {
  const flat = side === "flat"
  return {
    position_event_id: "position:1:event:1",
    position_id: "position:1",
    sequence: 1,
    event_key: key("2026-07-14T04:00:00Z", 20, "fill"),
    timestamp: "2026-07-14T04:00:00Z",
    cause_fill_id: "fill-1",
    symbol: "BTCUSDT",
    accounting_method: "average_cost",
    numeric_policy_version: REPLAY_NUMERIC_POLICY_VERSION,
    state: flat ? "flat" : "open",
    side: flat ? null : side,
    signed_quantity: flat ? 0 : side === "long" ? 2 : -2,
    average_entry_price: flat ? null : 100,
    valuation_price: 100,
    valuation_source: "fill_price",
    realized_pnl_delta: 0,
    realized_pnl_cumulative: 0,
    unrealized_pnl: 0,
  }
}

function ledger(cash = 999): ReplayLedgerEntry[] {
  const initial = key("2026-07-14T00:00:00Z", 70, "initial")
  const ending = key("2026-07-14T08:00:00Z", 100, "ending")
  return [
    { entry_id: "l1", event_key: initial, timestamp: initial.event_time, kind: "initial_cash", amount: 1000, balance_after: 1000, ref: "run" },
    { entry_id: "l2", event_key: key("2026-07-14T04:00:00Z", 20, "fee"), timestamp: "2026-07-14T04:00:00Z", kind: "fee", amount: -1, balance_after: cash, ref: "fill-1" },
    { entry_id: "l3", event_key: ending, timestamp: ending.event_time, kind: "ending_cash", amount: 0, balance_after: cash, ref: "run" },
  ]
}

test("equity projection marks open long and short positions without changing cash", () => {
  for (const side of ["long", "short"] as const) {
    const result = buildReplayEquityProjection({
      run_id: `run-${side}`,
      accounting_spec: SPEC,
      terminal_position: position(side),
      mark_event_key: ledger().at(-1)!.event_key,
      mark_source_ref: "source:bar_range:1",
      mark_source: "bar_close",
      mark_price: 110,
      ledger: ledger(),
    })
    expect(result.valuation_snapshot.unrealized_pnl).toBe(side === "long" ? 20 : -20)
    expect(result.equity_bridge.cash_balance).toBe(999)
    expect(result.equity_bridge.ending_equity).toBe(side === "long" ? 1019 : 979)
    expect(result.equity_bridge.terminal_position_state).toBe("open")
  }
})

test("flat terminal valuation is zero and requires a later checkpoint", () => {
  const terminal = position("flat")
  const result = buildReplayEquityProjection({
    run_id: "run-flat",
    accounting_spec: SPEC,
    terminal_position: terminal,
    mark_event_key: ledger().at(-1)!.event_key,
    mark_source_ref: "fill-2",
    mark_source: "fill_price",
    mark_price: 110,
    ledger: ledger(),
  })
  expect(result.equity_bridge).toMatchObject({ position_valuation: 0, ending_equity: 999, terminal_position_state: "flat" })
  expect(() => buildReplayEquityProjection({
    run_id: "run-flat",
    accounting_spec: SPEC,
    terminal_position: terminal,
    mark_event_key: terminal.event_key,
    mark_source_ref: "fill-2",
    mark_source: "fill_price",
    mark_price: 110,
    ledger: ledger(),
  })).toThrow("must follow")
})
