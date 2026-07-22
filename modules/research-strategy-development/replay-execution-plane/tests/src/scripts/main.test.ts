import { expect, test } from "bun:test"
import { resolve } from "node:path"
import {
  REPLAY_CERTIFICATION_STEPS,
  runReplayCertification,
} from "./main"

test("single Replay certification owner runs the frozen checks in order", async () => {
  const calls: Array<{ id: string; cwd: string }> = []
  const completed = await runReplayCertification("/repo", async (step, cwd) => {
    calls.push({ id: step.id, cwd })
    return 0
  })

  expect(completed).toEqual(REPLAY_CERTIFICATION_STEPS.map((step) => step.id))
  expect(calls).toEqual(REPLAY_CERTIFICATION_STEPS.map((step) => ({
    id: step.id,
    cwd: resolve("/repo", step.cwd),
  })))
  expect(new Set(completed).size).toBe(completed.length)
})

test("single Replay certification owner fails closed at the first failed check", async () => {
  const calls: string[] = []
  await expect(runReplayCertification("/repo", async (step) => {
    calls.push(step.id)
    return step.id === "engine" ? 9 : 0
  })).rejects.toThrow("Replay certification failed at engine (exit 9)")
  expect(calls).toEqual(["contracts", "data-adapter", "engine"])
})
