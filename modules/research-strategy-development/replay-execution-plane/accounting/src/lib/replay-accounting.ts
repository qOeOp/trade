import type {
  ReplayEventKey,
  ReplayFill,
  ReplayFundingEvent,
  ReplayLedgerEntry,
  ReplayPositionProjection,
} from "../../../contracts/src/lib/replay-contracts"
import { compareReplayEventKeys } from "../../../contracts/src/lib/replay-contracts"
import {
  addReplayDecimalValues,
  isReplayIncrementAligned,
  quantizeReplayBasisPointPrice,
  quantizeReplayExecutionPrice,
  quantizeReplayExpense,
  quantizeReplayProduct,
  quantizeReplaySignedCashflow,
} from "../../../contracts/src/lib/replay-decimal"

export interface SinglePositionLedgerInput {
  run_id: string
  initial_cash: number
  initial_event_key: ReplayEventKey
  ending_event_key: ReplayEventKey
  fills: [ReplayFill, ReplayFill]
  positions: ReplayPositionProjection[]
  funding_events: ReplayFundingEvent[]
  funding_cashflows: number[]
  funding_refs: string[]
  funding_event_keys: ReplayEventKey[]
  settlement_increment: string
}

export interface ReplayFundingLedgerFact {
  event_key: ReplayEventKey
  amount: number
  ref: string
}

export interface ReplayCashLedgerInput {
  run_id: string
  initial_cash: number
  initial_event_key: ReplayEventKey
  ending_event_key: ReplayEventKey
  fills: ReplayFill[]
  positions: ReplayPositionProjection[]
  funding_facts: ReplayFundingLedgerFact[]
  settlement_increment: string
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

export function applyAdverseSlippageV2(
  price: number,
  side: "buy" | "sell",
  bps: number,
  priceIncrement: string,
): number {
  requirePositive(price, "price")
  requireNonNegative(bps, "slippage bps")
  const multiplier = side === "buy" ? 1 + bps / 10_000 : 1 - bps / 10_000
  return quantizeReplayExecutionPrice(price * multiplier, side, priceIncrement)
}

export function calculateNotionalChargeV2(
  price: number,
  quantity: number,
  bps: number,
  settlementIncrement: string,
): number {
  requirePositive(price, "price")
  requirePositive(quantity, "quantity")
  requireNonNegative(bps, "charge bps")
  return quantizeReplayExpense(price * quantity * bps / 10_000, settlementIncrement)
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

export function calculateFundingCashflowV2(
  markPrice: number,
  quantity: number,
  rate: number,
  positionSide: "long" | "short",
  settlementIncrement: string,
): number {
  requirePositive(markPrice, "funding mark price")
  requirePositive(quantity, "funding quantity")
  if (!Number.isFinite(rate)) throw new Error("funding rate must be finite")
  return quantizeReplaySignedCashflow(
    markPrice * quantity * rate * (positionSide === "long" ? -1 : 1),
    settlementIncrement,
  )
}

export function applyAdverseSlippageV3(
  price: number,
  side: "buy" | "sell",
  bps: number,
  priceIncrement: string,
): number {
  requirePositive(price, "price")
  requireNonNegative(bps, "slippage bps")
  return quantizeReplayBasisPointPrice(price, side, bps, priceIncrement)
}

export function calculateNotionalChargeV3(
  price: number,
  quantity: number,
  bps: number,
  settlementIncrement: string,
): number {
  requirePositive(price, "price")
  requirePositive(quantity, "quantity")
  requireNonNegative(bps, "charge bps")
  return quantizeReplayProduct([price, quantity, bps], 10_000, settlementIncrement, "ceil")
}

export function calculateFundingCashflowV3(
  markPrice: number,
  quantity: number,
  rate: number,
  positionSide: "long" | "short",
  settlementIncrement: string,
): number {
  requirePositive(markPrice, "funding mark price")
  requirePositive(quantity, "funding quantity")
  if (!Number.isFinite(rate)) throw new Error("funding rate must be finite")
  return quantizeReplayProduct(
    [markPrice, quantity, rate, positionSide === "long" ? -1 : 1],
    1,
    settlementIncrement,
    "floor",
  )
}

export function buildSinglePositionLedger(input: SinglePositionLedgerInput): ReplayLedgerEntry[] {
  if (input.funding_events.length !== input.funding_cashflows.length
      || input.funding_events.length !== input.funding_refs.length
      || input.funding_events.length !== input.funding_event_keys.length) {
    throw new Error("funding events, cashflows, refs and event keys must have equal length")
  }
  for (const [index, event] of input.funding_events.entries()) {
    if (event.timestamp !== input.funding_event_keys[index].event_time) {
      throw new Error("funding event timestamp must equal EventKey time")
    }
  }
  return buildReplayCashLedger({
    run_id: input.run_id,
    initial_cash: input.initial_cash,
    initial_event_key: input.initial_event_key,
    ending_event_key: input.ending_event_key,
    fills: input.fills,
    positions: input.positions,
    funding_facts: input.funding_events.map((_, index) => ({
      event_key: input.funding_event_keys[index],
      amount: input.funding_cashflows[index],
      ref: input.funding_refs[index],
    })),
    settlement_increment: input.settlement_increment,
  })
}

export function buildReplayCashLedger(input: ReplayCashLedgerInput): ReplayLedgerEntry[] {
  validateCashLedgerInput(input)
  const initialCash = input.initial_cash
  let balance = initialCash
  const entries: ReplayLedgerEntry[] = [{
    entry_id: `${input.run_id}:ledger:1`,
    event_key: input.initial_event_key,
    timestamp: input.initial_event_key.event_time,
    kind: "initial_cash",
    amount: initialCash,
    balance_after: balance,
    ref: input.run_id,
  }]
  const append = (eventKey: ReplayEventKey, kind: ReplayLedgerEntry["kind"], amount: number, ref: string): void => {
    balance = addReplayDecimalValues(balance, amount)
    entries.push({
      entry_id: `${input.run_id}:ledger:${entries.length + 1}`,
      event_key: eventKey,
      timestamp: eventKey.event_time,
      kind,
      amount,
      balance_after: balance,
      ref,
    })
  }

  const facts: Array<{
    eventKey: ReplayEventKey
    kind: "fee" | "liquidation_fee" | "funding" | "realized_pnl"
    amount: number
    ref: string
    priority: number
  }> = []
  for (const [index, fill] of input.fills.entries()) {
    const position = input.positions[index]
    const previous = input.positions[index - 1]
    if (positionClosesQuantity(previous, position)) {
      facts.push({
        eventKey: position.event_key,
        kind: "realized_pnl",
        amount: position.realized_pnl_delta,
        ref: fill.fill_id,
        priority: 0,
      })
    }
    facts.push({ eventKey: fill.event_key, kind: "fee", amount: -fill.fee, ref: fill.fill_id, priority: 1 })
    if (fill.liquidation_fee) {
      facts.push({ eventKey: fill.event_key, kind: "liquidation_fee", amount: -fill.liquidation_fee, ref: fill.fill_id, priority: 2 })
    }
  }
  for (const funding of input.funding_facts) {
    facts.push({ eventKey: funding.event_key, kind: "funding", amount: funding.amount, ref: funding.ref, priority: 3 })
  }
  facts.sort((left, right) => compareReplayEventKeys(left.eventKey, right.eventKey)
    || left.priority - right.priority
    || left.ref.localeCompare(right.ref))
  for (const fact of facts) append(fact.eventKey, fact.kind, fact.amount, fact.ref)
  entries.push({
    entry_id: `${input.run_id}:ledger:${entries.length + 1}`,
    event_key: input.ending_event_key,
    timestamp: input.ending_event_key.event_time,
    kind: "ending_cash",
    amount: 0,
    balance_after: balance,
    ref: input.run_id,
  })
  return entries
}

function validateCashLedgerInput(input: ReplayCashLedgerInput): void {
  requirePositive(input.initial_cash, "initial_cash")
  if (!isReplayIncrementAligned(input.initial_cash, input.settlement_increment)) {
    throw new Error("initial_cash must align to settlement increment")
  }
  if (input.fills.length !== input.positions.length) {
    throw new Error("cash ledger requires one Position Projection per Fill")
  }
  if (input.fills.length === 0 && input.funding_facts.length !== 0) {
    throw new Error("cash ledger cannot attribute funding before a Position opens")
  }
  const fillIds = new Set<string>()
  for (const [index, fill] of input.fills.entries()) {
    const position = input.positions[index]
    if (fillIds.has(fill.fill_id)) throw new Error("cash ledger Fill ids must be unique")
    fillIds.add(fill.fill_id)
    if (position.cause_fill_id !== fill.fill_id
        || compareReplayEventKeys(position.event_key, fill.event_key) !== 0) {
      throw new Error("cash ledger Position Projection must bind its cause Fill")
    }
    if (position.sequence !== index + 1) throw new Error("cash ledger Position Projection sequence is invalid")
    if (index > 0 && compareReplayEventKeys(input.fills[index - 1].event_key, fill.event_key) >= 0) {
      throw new Error("cash ledger Fill EventKeys must be strictly increasing")
    }
    requireNonNegative(fill.fee, "Fill fee")
    if (!isReplayIncrementAligned(fill.fee, input.settlement_increment)) throw new Error("Fill fee must align to settlement increment")
    const liquidationFee = fill.liquidation_fee ?? 0
    requireNonNegative(liquidationFee, "Fill liquidation fee")
    if (!isReplayIncrementAligned(liquidationFee, input.settlement_increment)
        || (fill.order_role === "liquidation" && fill.liquidation_fee === undefined)
        || (fill.order_role !== "liquidation" && liquidationFee !== 0)) {
      throw new Error("Fill liquidation fee must be aligned and exclusive to a liquidation Fill")
    }
    if (!Number.isFinite(position.realized_pnl_delta)) throw new Error("position realized PnL must be finite")
    if (!isReplayIncrementAligned(position.realized_pnl_delta, input.settlement_increment)) {
      throw new Error("position realized PnL must align to settlement increment")
    }
  }
  const fundingRefs = new Set<string>()
  for (const [index, funding] of input.funding_facts.entries()) {
    if (fundingRefs.has(funding.ref) || funding.ref.trim() === "") throw new Error("funding ledger refs must be unique and non-empty")
    fundingRefs.add(funding.ref)
    if (!Number.isFinite(funding.amount)) throw new Error("funding ledger amount must be finite")
    if (!isReplayIncrementAligned(funding.amount, input.settlement_increment)) {
      throw new Error("funding amount must align to settlement increment")
    }
    if (index > 0 && compareReplayEventKeys(input.funding_facts[index - 1].event_key, funding.event_key) >= 0) {
      throw new Error("funding ledger EventKeys must be strictly increasing")
    }
  }
  const causalKeys = [...input.fills.map((fill) => fill.event_key), ...input.funding_facts.map((fact) => fact.event_key)]
    .sort(compareReplayEventKeys)
  if (causalKeys.length === 0) {
    if (compareReplayEventKeys(input.initial_event_key, input.ending_event_key) >= 0) {
      throw new Error("ending equity checkpoint must follow initial cash")
    }
    return
  }
  if (compareReplayEventKeys(input.initial_event_key, causalKeys[0]) >= 0) {
    throw new Error("initial cash checkpoint must precede monetary facts")
  }
  if (compareReplayEventKeys(causalKeys.at(-1)!, input.ending_event_key) >= 0) {
    throw new Error("ending equity checkpoint must follow monetary facts")
  }
}

function positionClosesQuantity(
  previous: ReplayPositionProjection | undefined,
  current: ReplayPositionProjection,
): boolean {
  if (!previous || previous.signed_quantity === 0) return false
  if (current.signed_quantity === 0) return true
  if (Math.sign(previous.signed_quantity) !== Math.sign(current.signed_quantity)) return true
  return Math.abs(current.signed_quantity) < Math.abs(previous.signed_quantity)
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
