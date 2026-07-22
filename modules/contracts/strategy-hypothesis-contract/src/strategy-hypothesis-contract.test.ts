import { expect, test } from "bun:test"
import { lintStrategyHypothesisContract, strategyHypothesisToQueueItem } from "./strategy-hypothesis-contract"

test("incomplete hypotheses cannot enter the R&D queue", () => {
  expect(lintStrategyHypothesisContract({}).valid).toBe(false)
  expect(() => strategyHypothesisToQueueItem({})).toThrow("failed lint")
})
