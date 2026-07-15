import type { ReplayEquityBridge, ReplayFill, ReplayLedgerEntry, ReplayMarginSnapshot, ReplayResult } from "../../../contracts/src/lib/replay-contracts"
import { addReplayDecimalValues, divideReplayDecimalValues } from "../../../contracts/src/lib/replay-decimal"

export function deriveReplayMetrics(input: {
  initial_cash: number
  fills: ReplayFill[]
  ledger: ReplayLedgerEntry[]
  equity_bridge: ReplayEquityBridge
  margin_snapshots: ReplayMarginSnapshot[]
}): ReplayResult["metrics"] {
  const ending = [...input.ledger].reverse().find((entry) => entry.kind === "ending_cash")
  if (!ending) throw new Error("Replay metrics require an ending_cash ledger entry")
  const sum = (kind: ReplayLedgerEntry["kind"]): number => input.ledger
    .filter((entry) => entry.kind === kind)
    .reduce((total, entry) => addReplayDecimalValues(total, entry.amount), 0)
  if (ending.balance_after !== input.equity_bridge.cash_balance) throw new Error("Replay metrics equity bridge does not match ending cash")
  const endingEquity = input.equity_bridge.ending_equity
  const observedRatios = input.margin_snapshots
    .map((snapshot) => snapshot.margin_ratio)
    .filter((ratio): ratio is number => ratio !== null)
  const postEntryMargin = input.margin_snapshots.filter((snapshot) => snapshot.stage === "post_entry")
  const terminalMargins = input.margin_snapshots.filter((snapshot) => snapshot.stage === "terminal")
  if (postEntryMargin.length !== 1 || terminalMargins.length !== 1
      || input.margin_snapshots[0]?.stage !== "post_entry"
      || input.margin_snapshots.at(-1)?.stage !== "terminal"
      || input.margin_snapshots.some((snapshot, index) => snapshot.snapshot_sequence !== index + 1)) {
    throw new Error("Replay metrics require one ordered post-entry/path/terminal margin sequence")
  }
  const terminalMargin = terminalMargins[0]
  const netPnl = addReplayDecimalValues(endingEquity, -input.initial_cash)
  return {
    initial_cash: input.initial_cash,
    ending_equity: endingEquity,
    net_pnl: netPnl,
    return_fraction: divideReplayDecimalValues(netPnl, input.initial_cash),
    realized_pnl: sum("realized_pnl"),
    unrealized_pnl: input.equity_bridge.position_valuation,
    total_fees: Math.abs(sum("fee")),
    total_liquidation_fees: Math.abs(sum("liquidation_fee")),
    total_funding: sum("funding"),
    trade_count: input.fills.filter((fill) => fill.order_role === "entry").length,
    margin_observation_count: input.margin_snapshots.length,
    peak_observed_margin_ratio: observedRatios.length > 0 ? Math.max(...observedRatios) : null,
    terminal_margin_ratio: terminalMargin.margin_ratio,
    observed_maintenance_breach_count: input.margin_snapshots.filter((snapshot) => !snapshot.maintenance_margin_sufficient).length,
  }
}
