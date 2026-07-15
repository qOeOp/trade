import { describe, expect, test } from "bun:test"
import { REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION, type ReplayBoundaryPhase, type ReplayEventKey, type ReplayFill, type ReplayInstrumentAccountingSpec } from "../../../contracts/src/lib/replay-contracts"
import {
  applyAdverseSlippage,
  applyAdverseSlippageV2,
  applyAdverseSlippageV3,
  buildReplayCashLedger,
  buildSinglePositionLedger,
  calculateFundingCashflow,
  calculateFundingCashflowV2,
  calculateFundingCashflowV3,
  calculateNotionalCharge,
  calculateNotionalChargeV2,
  calculateNotionalChargeV3,
  calculateRoundTripLinearCost,
} from "./replay-accounting"
import { buildAverageCostPositionProjection, buildCertifiedSinglePositionProjection } from "./replay-position-accounting"

const ACCOUNTING_SPEC: ReplayInstrumentAccountingSpec = {
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

function eventKey(eventTime: string, phase: ReplayBoundaryPhase, id: string): ReplayEventKey {
  return { event_time: eventTime, boundary_phase: phase, source_sequence: 1, event_subphase: 0, stable_event_id: id }
}

function fill(input: {
  id: string
  timestamp: string
  side: "buy" | "sell"
  quantity: number
  price: number
  fee: number
  reduce_only?: boolean
}): ReplayFill {
  return {
    fill_id: input.id,
    order_id: `order-${input.id}`,
    order_role: input.reduce_only ? "target" : "entry",
    event_key: eventKey(input.timestamp, 20, input.id),
    timestamp: input.timestamp,
    side: input.side,
    quantity: input.quantity,
    price: input.price,
    fee: input.fee,
    reduce_only: input.reduce_only ?? false,
  }
}

describe("Replay accounting", () => {
  test("cost primitives are adverse and funding signs follow position side", () => {
    expect(applyAdverseSlippage(100, "buy", 10)).toBe(100.1)
    expect(applyAdverseSlippage(100, "sell", 10)).toBe(99.9)
    expect(calculateNotionalCharge(100, 2, 10)).toBe(0.2)
    expect(calculateRoundTripLinearCost(100, 110, 2, 10)).toBeCloseTo(0.42)
    expect(calculateFundingCashflow(100, 2, 0.001, "long")).toBe(-0.2)
    expect(calculateFundingCashflow(100, 2, 0.001, "short")).toBe(0.2)
    expect(applyAdverseSlippageV2(100, "buy", 5, ACCOUNTING_SPEC.price_increment)).toBe(100.05)
    expect(applyAdverseSlippageV2(110, "sell", 5, ACCOUNTING_SPEC.price_increment)).toBe(109.94)
    expect(calculateNotionalChargeV2(100.05, 1, 10, ACCOUNTING_SPEC.settlement_increment)).toBe(0.10005)
    expect(calculateFundingCashflowV2(105, 1, 0.001, "long", ACCOUNTING_SPEC.settlement_increment)).toBe(-0.105)
    expect(applyAdverseSlippageV3(109.99, "sell", 7.5, ACCOUNTING_SPEC.price_increment)).toBe(109.9)
    expect(calculateNotionalChargeV3(100.05, 1.234, 7.5, ACCOUNTING_SPEC.settlement_increment)).toBe(0.09259628)
    expect(calculateFundingCashflowV3(105.01, 1.234, 0.000123, "long", ACCOUNTING_SPEC.settlement_increment)).toBe(-0.01593863)
  })

  test("single-position ledger conserves cash across fee funding and realized pnl", () => {
    const fills: [ReplayFill, ReplayFill] = [
      { fill_id: "f1", order_id: "o1", order_role: "entry", event_key: eventKey("2026-07-14T00:00:00Z", 20, "entry-fill"), timestamp: "2026-07-14T00:00:00Z", side: "buy", quantity: 1, price: 100, fee: 1, reduce_only: false },
      { fill_id: "f2", order_id: "o2", order_role: "target", event_key: eventKey("2026-07-14T08:00:00Z", 20, "exit-fill"), timestamp: "2026-07-14T08:00:00Z", side: "sell", quantity: 1, price: 110, fee: 1, reduce_only: true },
    ]
    const initialEventKey = eventKey("2026-07-13T23:59:59Z", 70, "initial")
    const fundingEventKey = eventKey("2026-07-14T04:00:00Z", 10, "funding")
    const endingEventKey = eventKey("2026-07-14T08:00:00Z", 100, "ending")
    const positions = buildCertifiedSinglePositionProjection({ run_id: "run-1", symbol: "BTCUSDT", accounting_spec: ACCOUNTING_SPEC, fills })
    const ledger = buildSinglePositionLedger({
      run_id: "run-1",
      initial_cash: 1000,
      initial_event_key: initialEventKey,
      ending_event_key: endingEventKey,
      fills,
      positions,
      funding_events: [{ timestamp: "2026-07-14T04:00:00Z", rate: 0.001, mark_price: 100 }],
      funding_cashflows: [-0.1],
      funding_refs: ["source:funding:1"],
      funding_event_keys: [fundingEventKey],
      settlement_increment: ACCOUNTING_SPEC.settlement_increment,
    })
    expect(ledger.at(-1)?.balance_after).toBe(1007.9)
    expect(ledger.map((entry) => entry.event_key)).toEqual([
      initialEventKey, fills[0].event_key, fundingEventKey,
      fills[1].event_key, fills[1].event_key, endingEventKey,
    ])
  })

  test("cash ledger merges multi-Fill fees realized pnl and funding by EventKey", () => {
    const fills = [
      fill({ id: "f1", timestamp: "2026-07-14T04:00:00Z", side: "buy", quantity: 1, price: 100, fee: 1 }),
      fill({ id: "f2", timestamp: "2026-07-14T05:00:00Z", side: "buy", quantity: 1, price: 110, fee: 2 }),
      fill({ id: "f3", timestamp: "2026-07-14T06:00:00Z", side: "sell", quantity: 0.5, price: 120, fee: 3, reduce_only: true }),
      fill({ id: "f4", timestamp: "2026-07-14T07:00:00Z", side: "sell", quantity: 1.5, price: 130, fee: 4, reduce_only: true }),
    ]
    const positions = buildAverageCostPositionProjection({ run_id: "multi-ledger", symbol: "BTCUSDT", accounting_spec: ACCOUNTING_SPEC, fills })
    const ledger = buildReplayCashLedger({
      run_id: "multi-ledger",
      initial_cash: 1000,
      initial_event_key: eventKey("2026-07-14T00:00:00Z", 70, "initial"),
      ending_event_key: eventKey("2026-07-14T08:00:00Z", 100, "ending"),
      fills,
      positions,
      funding_facts: [{ event_key: eventKey("2026-07-14T04:30:00Z", 10, "funding"), amount: -0.25, ref: "source:funding:1" }],
      settlement_increment: ACCOUNTING_SPEC.settlement_increment,
    })
    expect(ledger.map((entry) => entry.kind)).toEqual([
      "initial_cash", "fee", "funding", "fee", "realized_pnl", "fee", "realized_pnl", "fee", "ending_cash",
    ])
    expect(ledger.map((entry) => entry.amount)).toEqual([1000, -1, -0.25, -2, 7.5, -3, 37.5, -4, 0])
    expect(ledger.at(-1)?.balance_after).toBe(1034.75)
  })

  test("cash ledger rejects broken causality but permits an open terminal Position", () => {
    const fills = [
      fill({ id: "f1", timestamp: "2026-07-14T04:00:00Z", side: "buy", quantity: 1, price: 100, fee: 0 }),
      fill({ id: "f2", timestamp: "2026-07-14T06:00:00Z", side: "sell", quantity: 1, price: 110, fee: 0, reduce_only: true }),
    ]
    const positions = buildAverageCostPositionProjection({ run_id: "invalid-ledger", symbol: "BTCUSDT", accounting_spec: ACCOUNTING_SPEC, fills })
    const base = {
      run_id: "invalid-ledger",
      initial_cash: 1000,
      initial_event_key: eventKey("2026-07-14T00:00:00Z", 70, "initial"),
      ending_event_key: eventKey("2026-07-14T07:00:00Z", 100, "ending"),
      fills,
      settlement_increment: ACCOUNTING_SPEC.settlement_increment,
    }
    const brokenPositions = structuredClone(positions)
    brokenPositions[1].cause_fill_id = "wrong-fill"
    expect(() => buildReplayCashLedger({ ...base, positions: brokenPositions, funding_facts: [] }))
      .toThrow("must bind its cause Fill")
    expect(() => buildReplayCashLedger({
      ...base,
      positions,
      funding_facts: [
        { event_key: eventKey("2026-07-14T05:30:00Z", 10, "funding-2"), amount: 0, ref: "funding-2" },
        { event_key: eventKey("2026-07-14T05:00:00Z", 10, "funding-1"), amount: 0, ref: "funding-1" },
      ],
    })).toThrow("must be strictly increasing")
    const openLedger = buildReplayCashLedger({
      ...base,
      fills: [fills[0]],
      positions: [positions[0]],
      funding_facts: [],
    })
    expect(openLedger.at(-1)).toMatchObject({ kind: "ending_cash", balance_after: 1000 })
  })
})
