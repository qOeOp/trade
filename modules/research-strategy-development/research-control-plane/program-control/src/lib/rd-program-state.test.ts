import { expect, test } from "bun:test"
import { buildRdSupervisorNextPlan } from "./rd-program-planner"
import { createRdProgramState, updateRdProgramState } from "./rd-program-state"

test("program budget exhaustion is terminal for planning", () => {
  const state = createRdProgramState({
    objective: "find a robust strategy",
    now: "2026-01-01T00:00:00Z",
    budget: { max_hypotheses: 1, max_trials_total: 1, max_locked_holdout_uses: 1 },
  })
  const exhausted = updateRdProgramState(state, {
    now: "2026-01-02T00:00:00Z",
    usageDelta: { hypotheses_run: 1, trials_used: 1 },
  })
  const plan = buildRdSupervisorNextPlan(exhausted, "data/rd_state.db", { now: "2026-01-02T00:00:00Z" })
  expect(exhausted.status).toBe("budget_exhausted")
  expect(plan.status).toBe("stopped")
  expect(plan.command).toBeNull()
})
