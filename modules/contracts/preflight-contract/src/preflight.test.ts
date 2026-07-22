import { expect, test } from "bun:test"
import { evaluatePreflight } from "./preflight"

test("no-action decisions abstain without manufacturing blockers", () => {
  const result = evaluatePreflight({ plan: {}, observe: {}, target_action: "no_action" })
  expect(result.verdict).toBe("abstain")
  expect(result.blocked_by).toEqual([])
})
