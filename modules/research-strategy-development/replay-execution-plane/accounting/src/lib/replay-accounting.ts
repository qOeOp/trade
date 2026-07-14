import type { ReplayFill, ReplayFundingEvent, ReplayLedgerEntry } from "../../../contracts/src/lib/replay-contracts"

export interface SinglePositionLedgerInput {
  run_id: string
  initial_cash: number
  entry_time: string
  fills: [ReplayFill, ReplayFill]
  funding_events: ReplayFundingEvent[]
  funding_cashflows: number[]
  realized_pnl: number
  ending_equity: number
}

export function applyAdverseSlippage(price: number, side: "buy" | "sell", bps: number): number {
  requirePositive(price, "price")
  requireNonNegative(bps, "slippage bps")
  const multiplier = side === "buy" ? 1 + bps / 10_000 : 1 - bps / 10_000
  return roundReplayAmount(price * multiplier)
}

export function calculateNotionalCharge(price: number, quantity: number, bps: number): number {
  requirePositive(price, "price")
  requirePositive(quantity, "quantity")
  requireNonNegative(bps, "charge bps")
  return roundReplayAmount(price * quantity * bps / 10_000)
}

export function calculateRoundTripLinearCost(entry: number, exit: number, quantity: number, bps: number): number {
  requirePositive(entry, "entry")
  requirePositive(exit, "exit")
  requirePositive(quantity, "quantity")
  requireNonNegative(bps, "cost bps")
  return (Math.abs(entry) + Math.abs(exit)) * quantity * bps / 10_000
}

export function calculateFundingCashflow(
  markPrice: number,
  quantity: number,
  rate: number,
  positionSide: "long" | "short",
): number {
  requirePositive(markPrice, "funding mark price")
  requirePositive(quantity, "funding quantity")
  if (!Number.isFinite(rate)) throw new Error("funding rate must be finite")
  return roundReplayAmount(markPrice * quantity * rate * (positionSide === "long" ? -1 : 1))
}

export function buildSinglePositionLedger(input: SinglePositionLedgerInput): ReplayLedgerEntry[] {
  if (input.funding_events.length !== input.funding_cashflows.length) {
    throw new Error("funding events and cashflows must have equal length")
  }
  let balance = input.initial_cash
  const entries: ReplayLedgerEntry[] = [{
    entry_id: `${input.run_id}:ledger:1`,
    timestamp: input.entry_time,
    kind: "initial_cash",
    amount: input.initial_cash,
    balance_after: balance,
    ref: input.run_id,
  }]
  const append = (timestamp: string, kind: ReplayLedgerEntry["kind"], amount: number, ref: string): void => {
    balance = roundReplayAmount(balance + amount)
    entries.push({ entry_id: `${input.run_id}:ledger:${entries.length + 1}`, timestamp, kind, amount, balance_after: balance, ref })
  }

  append(input.fills[0].timestamp, "fee", -input.fills[0].fee, input.fills[0].fill_id)
  for (const [index, event] of input.funding_events.entries()) {
    append(event.timestamp, "funding", input.funding_cashflows[index], `funding:${event.timestamp}`)
  }
  append(input.fills[1].timestamp, "realized_pnl", input.realized_pnl, input.fills[1].fill_id)
  append(input.fills[1].timestamp, "fee", -input.fills[1].fee, input.fills[1].fill_id)
  entries.push({
    entry_id: `${input.run_id}:ledger:${entries.length + 1}`,
    timestamp: input.fills[1].timestamp,
    kind: "ending_equity",
    amount: 0,
    balance_after: input.ending_equity,
    ref: input.run_id,
  })
  if (Math.abs(balance - input.ending_equity) > 1e-9) throw new Error("ledger conservation failed")
  return entries
}

export function roundReplayAmount(value: number): number {
  if (!Number.isFinite(value)) throw new Error("Replay amount must be finite")
  return Number(value.toFixed(12))
}

function requirePositive(value: number, field: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${field} must be positive`)
}

function requireNonNegative(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${field} must be non-negative`)
}
