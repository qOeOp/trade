import { expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { resolveRepoPath } from "../../../../../contracts/runtime-core/src/paths"
import { run } from "./main"

test("Replay execution CLI returns a structured contract error", () => {
  const result = run([])
  expect(result.ok).toBe(false)
  expect(String(result.error)).toContain("requires --json or --input")
})

test("Replay execution CLI reads one file input without widening authority", () => {
  const root = `tmp/replay-execution-cli-${process.pid}-${Date.now()}`
  const absoluteRoot = resolveRepoPath(root)
  const input = `${root}/input.json`
  try {
    mkdirSync(absoluteRoot, { recursive: true })
    writeFileSync(resolveRepoPath(input), JSON.stringify({
      request: { schema_version: "caller-supplied" },
      attempt_lease: { schema_version: "caller-supplied" },
    }))
    const result = run(["--input", input])
    expect(result.ok).toBe(false)
    expect(String(result.error)).toContain("dispatch_authority is required")
    expect(run(["--input", input, "--json", "{}"]).ok).toBe(false)
  } finally {
    rmSync(absoluteRoot, { recursive: true, force: true })
  }
})

test("Replay execution CLI rejects caller-supplied Request and Lease pairs", () => {
  const result = run(["--json", JSON.stringify({
    request: { schema_version: "caller-supplied" },
    attempt_lease: { schema_version: "caller-supplied" },
  })])
  expect(result.ok).toBe(false)
  expect(String(result.error)).toContain("dispatch_authority is required")
})
