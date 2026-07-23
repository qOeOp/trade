import { expect, test } from "bun:test"
import { run } from "./main"

test("Replay execution CLI returns a structured contract error", () => {
  const result = run([])
  expect(result.ok).toBe(false)
  expect(String(result.error)).toContain("requires --json")
})

test("Replay execution CLI rejects caller-supplied Request and Lease pairs", () => {
  const result = run(["--json", JSON.stringify({
    request: { schema_version: "caller-supplied" },
    attempt_lease: { schema_version: "caller-supplied" },
  })])
  expect(result.ok).toBe(false)
  expect(String(result.error)).toContain("dispatch_authority is required")
})
