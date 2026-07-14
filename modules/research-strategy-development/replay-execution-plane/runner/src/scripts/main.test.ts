import { expect, test } from "bun:test"
import { run } from "./main"

test("Replay execution CLI returns a structured contract error", () => {
  const result = run([])
  expect(result.ok).toBe(false)
  expect(String(result.error)).toContain("requires --json")
})
