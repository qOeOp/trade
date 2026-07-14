import { describe, expect, test } from "bun:test"
import type { ReplayFill } from "../../../contracts/src/lib/replay-contracts"
import {
  applyAdverseSlippage,
  buildSinglePositionLedger,
  calculateFundingCashflow,
  calculateNotionalCharge,
  calculateRoundTripLinearCost,
} from "./replay-accounting"

describe("Replay accounting", () => {
  test("cost primitives are adverse and funding signs follow position side", () => {
    expect(applyAdverseSlippage(100, "buy", 10)).toBe(100.1)
    expect(applyAdverseSlippage(100, "sell", 10)).toBe(99.9)
    expect(calculateNotionalCharge(100, 2, 10)).toBe(0.2)
    expect(calculateRoundTripLinearCost(100, 110, 2, 10)).toBeCloseTo(0.42)
    expect(calculateFundingCashflow(100, 2, 0.001, "long")).toBe(-0.2)
    expect(calculateFundingCashflow(100, 2, 0.001, "short")).toBe(0.2)
  })

  test("single-position ledger conserves cash across fee funding and realized pnl", () => {
    const fills: [ReplayFill, ReplayFill] = [
      { fill_id: "f1", order_role: "entry", timestamp: "2026-07-14T00:00:00Z", side: "buy", quantity: 1, price: 100, fee: 1, reduce_only: false },
      { fill_id: "f2", order_role: "target", timestamp: "2026-07-14T08:00:00Z", side: "sell", quantity: 1, price: 110, fee: 1, reduce_only: true },
    ]
    const ledger = buildSinglePositionLedger({
      run_id: "run-1",
      initial_cash: 1000,
      entry_time: fills[0].timestamp,
      fills,
      funding_events: [{ timestamp: "2026-07-14T04:00:00Z", rate: 0.001, mark_price: 100 }],
      funding_cashflows: [-0.1],
      realized_pnl: 10,
      ending_equity: 1007.9,
    })
    expect(ledger.at(-1)?.balance_after).toBe(1007.9)
    expect(() => buildSinglePositionLedger({
      run_id: "bad", initial_cash: 1000, entry_time: fills[0].timestamp, fills,
      funding_events: [], funding_cashflows: [], realized_pnl: 10, ending_equity: 999,
    })).toThrow("ledger conservation failed")
  })
})
