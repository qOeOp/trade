import type { ReplayFill, ReplayLedgerEntry, ReplayResult } from "../../../contracts/src/lib/replay-contracts"

export function deriveReplayMetrics(input: {
  initial_cash: number
  fills: ReplayFill[]
  ledger: ReplayLedgerEntry[]
}): ReplayResult["metrics"] {
  const ending = [...input.ledger].reverse().find((entry) => entry.kind === "ending_equity")
  if (!ending) throw new Error("Replay metrics require an ending_equity ledger entry")
  const sum = (kind: ReplayLedgerEntry["kind"]): number => input.ledger
    .filter((entry) => entry.kind === kind)
    .reduce((total, entry) => total + entry.amount, 0)
  const endingEquity = ending.balance_after
  const netPnl = roundMetric(endingEquity - input.initial_cash)
  return {
    initial_cash: input.initial_cash,
    ending_equity: endingEquity,
    net_pnl: netPnl,
    return_fraction: roundMetric(netPnl / input.initial_cash),
    realized_pnl: roundMetric(sum("realized_pnl")),
    total_fees: roundMetric(-sum("fee")),
    total_funding: roundMetric(sum("funding")),
    trade_count: input.fills.filter((fill) => fill.order_role === "entry").length,
  }
}

function roundMetric(value: number): number {
  if (!Number.isFinite(value)) throw new Error("Replay metric must be finite")
  return Number(value.toFixed(12))
}
