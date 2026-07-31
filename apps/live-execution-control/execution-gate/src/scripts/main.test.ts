import assert from "node:assert/strict"
import test from "node:test"
import { run } from "./main"

test("execution gate CLI returns ready status", () => {
  const result = run(["--json", JSON.stringify({})]) as { ok: boolean; data: { status: string } }

  assert.equal(result.ok, true)
  assert.equal(result.data.status, "ready")
})

test("execution gate CLI returns skipped status", () => {
  const result = run(["--json", JSON.stringify({
    now: "2026-07-12T00:00:00Z",
    trigger_condition: { valid_until_at: "2026-07-11T00:00:00Z" },
  })]) as { ok: boolean; data: { status: string; reason: string } }

  assert.equal(result.ok, true)
  assert.equal(result.data.status, "skipped")
  assert.equal(result.data.reason, "trigger_condition_expired")
})
