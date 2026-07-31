import {
  REPLAY_EQUITY_POLICY_VERSION,
  assertReplayEventKey,
  compareReplayEventKeys,
  type ReplayEquityBridge,
  type ReplayEventKey,
  type ReplayInstrumentAccountingSpec,
  type ReplayLedgerEntry,
  type ReplayPositionProjection,
  type ReplayValuationSnapshot,
} from "../../../contracts/src/lib/replay-contracts"
import {
  addReplayDecimalValues,
  isReplayIncrementAligned,
  quantizeReplayDifferenceProduct,
} from "../../../contracts/src/lib/replay-decimal"

export interface ReplayEquityProjectionInput {
  run_id: string
  accounting_spec: ReplayInstrumentAccountingSpec
  terminal_position: ReplayPositionProjection
  mark_event_key: ReplayEventKey
  mark_source_ref: string
  mark_source: ReplayValuationSnapshot["mark_source"]
  mark_price: number
  ledger: ReplayLedgerEntry[]
}

export interface ReplayNeverOpenedEquityProjectionInput {
  run_id: string
  symbol: string
  accounting_spec: ReplayInstrumentAccountingSpec
  mark_event_key: ReplayEventKey
  mark_source_ref: string
  mark_source: ReplayValuationSnapshot["mark_source"]
  mark_price: number
  ledger: ReplayLedgerEntry[]
}

export function buildReplayEquityProjection(input: ReplayEquityProjectionInput): {
  valuation_snapshot: ReplayValuationSnapshot
  equity_bridge: ReplayEquityBridge
} {
  validateInput(input)
  const { terminal_position: position, accounting_spec: spec } = input
  const unrealizedPnl = position.state === "flat"
    ? 0
    : quantizeReplayDifferenceProduct(
      input.mark_price,
      position.average_entry_price!,
      Math.abs(position.signed_quantity),
      Math.sign(position.signed_quantity) as -1 | 1,
      spec.settlement_increment,
      "floor",
    )
  const valuationId = `${input.run_id}:valuation:terminal`
  const cashBalance = input.ledger.at(-1)!.balance_after
  const endingEquity = addReplayDecimalValues(cashBalance, unrealizedPnl)
  const valuationSnapshot: ReplayValuationSnapshot = {
    valuation_id: valuationId,
    event_key: input.mark_event_key,
    timestamp: input.mark_event_key.event_time,
    position_event_id: position.position_event_id,
    mark_source_ref: input.mark_source_ref,
    mark_source: input.mark_source,
    symbol: position.symbol,
    settlement_asset: spec.settlement_asset,
    mark_price: input.mark_price,
    signed_quantity: position.signed_quantity,
    average_entry_price: position.average_entry_price,
    unrealized_pnl: unrealizedPnl,
  }
  return {
    valuation_snapshot: valuationSnapshot,
    equity_bridge: {
      policy_version: REPLAY_EQUITY_POLICY_VERSION,
      valuation_id: valuationId,
      settlement_asset: spec.settlement_asset,
      terminal_position_state: position.state,
      cash_balance: cashBalance,
      position_valuation: unrealizedPnl,
      ending_equity: endingEquity,
      reconciled: true,
    },
  }
}

export function buildReplayNeverOpenedEquityProjection(input: ReplayNeverOpenedEquityProjectionInput): {
  valuation_snapshot: ReplayValuationSnapshot
  equity_bridge: ReplayEquityBridge
} {
  validateTerminalMark(input)
  const valuationId = `${input.run_id}:valuation:terminal`
  const cashBalance = input.ledger.at(-1)!.balance_after
  return {
    valuation_snapshot: {
      valuation_id: valuationId,
      event_key: input.mark_event_key,
      timestamp: input.mark_event_key.event_time,
      position_event_id: null,
      mark_source_ref: input.mark_source_ref,
      mark_source: input.mark_source,
      symbol: input.symbol,
      settlement_asset: input.accounting_spec.settlement_asset,
      mark_price: input.mark_price,
      signed_quantity: 0,
      average_entry_price: null,
      unrealized_pnl: 0,
    },
    equity_bridge: {
      policy_version: REPLAY_EQUITY_POLICY_VERSION,
      valuation_id: valuationId,
      settlement_asset: input.accounting_spec.settlement_asset,
      terminal_position_state: "never_opened",
      cash_balance: cashBalance,
      position_valuation: 0,
      ending_equity: cashBalance,
      reconciled: true,
    },
  }
}

function validateInput(input: ReplayEquityProjectionInput): void {
  if (compareReplayEventKeys(input.terminal_position.event_key, input.mark_event_key) >= 0) {
    throw new Error("Replay terminal valuation must follow the terminal Position fact")
  }
  validateTerminalMark(input)
  const position = input.terminal_position
  if (position.state === "flat" && (position.signed_quantity !== 0 || position.average_entry_price !== null)) {
    throw new Error("Replay flat terminal Position is inconsistent")
  }
  if (position.state === "open" && (position.signed_quantity === 0 || position.average_entry_price === null)) {
    throw new Error("Replay open terminal Position is inconsistent")
  }
}

function validateTerminalMark(input: {
  run_id: string
  accounting_spec: ReplayInstrumentAccountingSpec
  mark_event_key: ReplayEventKey
  mark_source_ref: string
  mark_price: number
  ledger: ReplayLedgerEntry[]
}): void {
  if (input.run_id.trim() === "" || input.mark_source_ref.trim() === "") {
    throw new Error("Replay equity run_id and mark source ref are required")
  }
  assertReplayEventKey(input.mark_event_key)
  if (input.ledger.at(-1)?.kind !== "ending_cash") throw new Error("Replay equity requires an ending_cash checkpoint")
  if (compareReplayEventKeys(input.ledger.at(-1)!.event_key, input.mark_event_key) !== 0) {
    throw new Error("Replay equity mark and ending cash must share the terminal checkpoint")
  }
  if (!Number.isFinite(input.mark_price) || input.mark_price <= 0
      || !isReplayIncrementAligned(input.mark_price, input.accounting_spec.price_increment)) {
    throw new Error("Replay terminal mark must be a positive price-increment-aligned value")
  }
}
