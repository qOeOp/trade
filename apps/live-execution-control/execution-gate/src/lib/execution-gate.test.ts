import assert from "node:assert/strict"
import test from "node:test"

import { evaluateTriggerCondition } from "./execution-gate"

test("execution gate accepts empty trigger condition", () => {
  assert.deepEqual(evaluateTriggerCondition({}), { status: "ready" })
})

test("execution gate blocks expired trigger condition", () => {
  const result = evaluateTriggerCondition({
    now: "2026-07-11T12:00:00Z",
    trigger_condition: {
      valid_until_at: "2026-07-11T11:59:59Z",
    },
  })

  assert.equal(result.status, "skipped")
  assert.equal(result.status === "skipped" ? result.reason : "", "trigger_condition_expired")
})

test("execution gate checks current mark price range", () => {
  assert.deepEqual(evaluateTriggerCondition({
    current_mark: 100,
    trigger_condition: {
      price_in_range: [90, 110],
    },
  }), { status: "ready" })

  const result = evaluateTriggerCondition({
    current_mark: 120,
    trigger_condition: {
      price_in_range: [90, 110],
    },
  })
  assert.equal(result.status, "skipped")
  assert.equal(result.status === "skipped" ? result.reason : "", "current_mark_outside_trigger_range")
})
