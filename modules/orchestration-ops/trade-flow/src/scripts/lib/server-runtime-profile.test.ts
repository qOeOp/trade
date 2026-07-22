import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import { repoRoot } from "../../../../../contracts/runtime-core/src/paths"
import { parseServerRuntimeProfile, serverRuntimeProfileHash } from "./server-runtime-profile"

function fixture(): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(repoRoot(), "profile/server-runtime.json"), "utf8")) as Record<string, unknown>
}

test("server runtime profile freezes a no-live three-unit shadow deployment", () => {
  const profile = parseServerRuntimeProfile(fixture())
  assert.equal(profile.profile_id, "server-shadow")
  assert.equal(profile.process_manager.target, "systemd")
  assert.equal(profile.safety.live_writes_allowed, false)
  assert.equal(profile.safety.domain_jobs_enabled, false)
  assert.match(serverRuntimeProfileHash(profile), /^[a-f0-9]{64}$/)
})

test("server runtime profile rejects authority, path, identity, and unknown-field widening", () => {
  const live = fixture()
  ;(live.safety as Record<string, unknown>).live_writes_allowed = true
  assert.throws(() => parseServerRuntimeProfile(live), /safety/)
  const escaped = fixture()
  ;(escaped.control_runtime as Record<string, unknown>).trade_db = "../trade.db"
  assert.throws(() => parseServerRuntimeProfile(escaped), /runtime ref/)
  const unknown = fixture()
  ;(unknown.process_manager as Record<string, unknown>).environment = { API_KEY: "secret" }
  assert.throws(() => parseServerRuntimeProfile(unknown), /does not allow/)
  const collision = fixture()
  ;(collision.control_runtime as Record<string, unknown>).ops_runtime_db = "data/trade.db"
  assert.throws(() => parseServerRuntimeProfile(collision), /distinct paths/)
})
