import assert from "node:assert/strict"
import test from "node:test"
import { run } from "./main"

test("account candidate arbiter CLI returns bounded errors", () => {
  const result = run(["--json", "{}"]) as { ok: boolean; error: string }
  assert.equal(result.ok, false)
  assert.match(result.error, /shape drifted/)
})
