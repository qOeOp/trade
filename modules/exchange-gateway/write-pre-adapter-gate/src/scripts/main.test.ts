import assert from "node:assert/strict"
import test from "node:test"
import { run } from "./main"

test("write pre-adapter gate passes authorized writes", () => {
  const result = run(["--json", JSON.stringify({
    action: "place_entry",
    mode: "live_small",
    idempotency_key: "idem-1",
    source_intent_ref: "artifact_catalog:artifact/action-intent-1",
    authorized: true,
  })]) as { ok: boolean; data: { status: string } }

  assert.equal(result.ok, true)
  assert.equal(result.data.status, "passed")
})

test("write pre-adapter gate blocks unauthorised writes", () => {
  const result = run(["--json", JSON.stringify({
    action: "place_entry",
    mode: "live_small",
    idempotency_key: "idem-1",
  })]) as { ok: boolean; data: { status: string; issues: unknown[] } }

  assert.equal(result.ok, false)
  assert.equal(result.data.status, "blocked")
  assert.ok(result.data.issues.length > 0)
})
