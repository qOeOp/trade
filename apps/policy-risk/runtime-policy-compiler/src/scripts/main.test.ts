import assert from "node:assert/strict"
import test from "node:test"
import { run } from "./main"

test("runtime policy compiler CLI returns compiled policy envelope", () => {
  const result = run(["--now", "2026-07-09T00:00:00.000Z"])
  assert.equal(result.ok, true)
  const data = result.data as {
    runtime_policy: { schema_version: string; compiled_at: string; source_hash: string }
    policy_snapshot_ref: { schema_version: string; policy_ref: string; policy_hash: string; generated_at: string }
  }
  assert.equal(data.runtime_policy.schema_version, "runtime-policy.v1")
  assert.equal(data.runtime_policy.compiled_at, "2026-07-09T00:00:00.000Z")
  assert.equal(data.policy_snapshot_ref.schema_version, "trade.protocol.policy-snapshot.v1")
  assert.equal(data.policy_snapshot_ref.policy_hash, data.runtime_policy.source_hash)
  assert.equal(data.policy_snapshot_ref.generated_at, "2026-07-09T00:00:00.000Z")
  assert.match(data.policy_snapshot_ref.policy_ref, /^policy_registry:runtime_policy\/[^/]+\//)
})

test("runtime policy compiler CLI returns structured errors", () => {
  const result = run(["--unknown"])
  assert.equal(result.ok, false)
  assert.match(String(result.error), /unknown flag/)
})
