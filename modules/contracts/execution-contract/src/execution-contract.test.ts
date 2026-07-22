import { expect, test } from "bun:test"
import { compileQuantity, validateExecutionContract } from "./execution-contract"

test("quantity compilation floors to exchange step size", () => {
  expect(compileQuantity({ notionalUsdt: 100, leverage: 1, referencePrice: 30, quantityStepSize: "0.1" }))
    .toBe(3.3)
})

test("execution contracts fail closed when required fields are absent", () => {
  const result = validateExecutionContract({})
  expect(result.ok).toBe(false)
  expect(result.errors).toContain("entries must contain at least one entry")
})
