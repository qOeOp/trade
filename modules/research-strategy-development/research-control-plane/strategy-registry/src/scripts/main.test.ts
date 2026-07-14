import { expect, test } from "bun:test"
import { run } from "./main"

test("Strategy Registry CLI requires the Research Control Plane DB", () => {
  const result = run([])
  expect(result.ok).toBe(false)
  expect(String(result.error)).toContain("requires --db")
})
