import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import {
  addReplayDecimalValues,
  divideReplayDecimalValues,
  isReplayIncrementAligned,
  quantizeReplayExecutionPrice,
  quantizeReplayExpense,
  quantizeReplayBasisPointPrice,
  quantizeReplayDifferenceProduct,
  quantizeReplayProduct,
  quantizeReplayQuantity,
  quantizeReplaySignedCashflow,
  quantizeReplayWeightedAverage,
  type ReplayDecimalRounding,
} from "./replay-decimal"

interface NumericVectorCase {
  id: string
  operation: "basis-point-price" | "product" | "difference-product" | "weighted-average" | "divide"
  expected: string
  price?: string
  side?: "buy" | "sell"
  bps?: string
  values?: string[]
  divisor?: string
  increment?: string
  rounding?: ReplayDecimalRounding
  minuend?: string
  subtrahend?: string
  multiplier?: string
  direction?: -1 | 1
  prior_quantity?: string
  prior_price?: string
  fill_quantity?: string
  fill_price?: string
  dividend?: string
}

test("execution price and quantity use deterministic directional increments", () => {
  expect(quantizeReplayExecutionPrice(100.001, "buy", "0.01")).toBe(100.01)
  expect(quantizeReplayExecutionPrice(100.009, "sell", "0.01")).toBe(100)
  expect(quantizeReplayQuantity(1.2349, "0.001")).toBe(1.234)
  expect(() => quantizeReplayQuantity(0.0009, "0.001")).toThrow("below the instrument increment")
})

test("rational multiplication and division avoid binary64 intermediates", () => {
  expect(quantizeReplayBasisPointPrice(109.99, "sell", 7.5, "0.01")).toBe(109.9)
  expect(quantizeReplayProduct([100.05, 1.234, 7.5], 10_000, "0.00000001", "ceil")).toBe(0.09259628)
  expect(quantizeReplayDifferenceProduct(110.01, 100.005, 1.234, 1, "0.00000001", "floor")).toBe(12.34617)
  expect(quantizeReplayWeightedAverage(1.001, 100.01, 2.003, 101.02)).toBe(100.683445406125)
  expect(divideReplayDecimalValues(1, 3)).toBe(0.333333333333)
  expect(divideReplayDecimalValues(-2, 3)).toBe(-0.666666666667)
})

test("settlement rounding never improves signed evidence cashflow", () => {
  expect(quantizeReplayExpense(0.010000001, "0.00000001")).toBe(0.01000001)
  expect(quantizeReplaySignedCashflow(0.010000009, "0.00000001")).toBe(0.01)
  expect(quantizeReplaySignedCashflow(-0.010000001, "0.00000001")).toBe(-0.01000001)
})

test("decimal alignment and addition do not depend on binary accumulation order", () => {
  expect(isReplayIncrementAligned(100.01, "0.01")).toBe(true)
  expect(isReplayIncrementAligned(100.001, "0.01")).toBe(false)
  expect(addReplayDecimalValues(1000, -0.1, -0.2, 0.3)).toBe(1000)
  expect(quantizeReplayQuantity(0.0000019, "0.000001")).toBe(0.000001)
})

test("Numeric Policy v3 matches language-neutral certification vectors", () => {
  const fixture = JSON.parse(readFileSync(
    new URL("../fixtures/numeric-policy-v3-vectors.json", import.meta.url),
    "utf8",
  )) as { policy_version: string; cases: NumericVectorCase[] }
  expect(fixture.policy_version).toBe("rd-replay-number-v3")
  for (const item of fixture.cases) {
    let actual: number
    if (item.operation === "basis-point-price") {
      if (!item.side || !item.increment) throw new Error(`invalid vector ${item.id}`)
      actual = quantizeReplayBasisPointPrice(decimal(item.price, item.id), item.side, decimal(item.bps, item.id), item.increment)
    } else if (item.operation === "product") {
      if (!item.values || !item.increment || !item.rounding) throw new Error(`invalid vector ${item.id}`)
      actual = quantizeReplayProduct(item.values.map((value) => decimal(value, item.id)), decimal(item.divisor, item.id), item.increment, item.rounding)
    } else if (item.operation === "difference-product") {
      if (!item.increment || !item.rounding || !item.direction) throw new Error(`invalid vector ${item.id}`)
      actual = quantizeReplayDifferenceProduct(
        decimal(item.minuend, item.id),
        decimal(item.subtrahend, item.id),
        decimal(item.multiplier, item.id),
        item.direction,
        item.increment,
        item.rounding,
      )
    } else if (item.operation === "weighted-average") {
      actual = quantizeReplayWeightedAverage(
        decimal(item.prior_quantity, item.id),
        decimal(item.prior_price, item.id),
        decimal(item.fill_quantity, item.id),
        decimal(item.fill_price, item.id),
      )
    } else {
      actual = divideReplayDecimalValues(decimal(item.dividend, item.id), decimal(item.divisor, item.id))
    }
    expect(actual.toString(), item.id).toBe(item.expected)
  }
})

function decimal(value: string | undefined, id: string): number {
  if (value === undefined) throw new Error(`invalid vector ${id}`)
  const result = Number(value)
  if (!Number.isFinite(result)) throw new Error(`invalid decimal in vector ${id}`)
  return result
}
