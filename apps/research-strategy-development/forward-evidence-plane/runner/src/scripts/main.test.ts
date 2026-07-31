import { expect, test } from "bun:test"
import { run } from "./main"

test("Forward Evidence CLI requires a structured input", () => {
  const result = run([])
  expect(result.ok).toBe(false)
  expect(String(result.error)).toContain("requires --json")
})
