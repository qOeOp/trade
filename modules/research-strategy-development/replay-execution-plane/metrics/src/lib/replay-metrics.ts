import type { ReplayFill, ReplayLedgerEntry, ReplayResult } from "../../../contracts/src/lib/replay-contracts"
import { addReplayDecimalValues, divideReplayDecimalValues } from "../../../contracts/src/lib/replay-decimal"

export function deriveReplayMetrics(input: {
  initial_cash: number
  fills: ReplayFill[]
  ledger: ReplayLedgerEntry[]
}): ReplayResult["metrics"] {
  const ending = [...input.ledger].reverse().find((entry) => entry.kind === "ending_equity")
  if (!ending) throw new Error("Replay metrics require an ending_equity ledger entry")
  const sum = (kind: ReplayLedgerEntry["kind"]): number => input.ledger
    .filter((entry) => entry.kind === kind)
    .reduce((total, entry) => addReplayDecimalValues(total, entry.amount), 0)
  const endingEquity = ending.balance_after
  const netPnl = addReplayDecimalValues(endingEquity, -input.initial_cash)
  return {
    initial_cash: input.initial_cash,
    ending_equity: endingEquity,
    net_pnl: netPnl,
    return_fraction: divideReplayDecimalValues(netPnl, input.initial_cash),
    realized_pnl: sum("realized_pnl"),
    total_fees: -sum("fee"),
    total_funding: sum("funding"),
    trade_count: input.fills.filter((fill) => fill.order_role === "entry").length,
  }
}
