import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import { repoRoot } from "../../../../../contracts/runtime-core/src/paths"
import { parseServerRuntimeProfile } from "./server-runtime-profile"
import { runServerRuntimeRecoveryFixture } from "./server-runtime-recovery-fixture"

const root = repoRoot()
const profile = parseServerRuntimeProfile(JSON.parse(
  readFileSync(resolve(root, "profile/server-runtime.json"), "utf8"),
))

test("recovery fixture closes owner DB, raw, artifact, and profile hashes", () => {
  const result = runServerRuntimeRecoveryFixture(profile, root)
  assert.equal(result.status, "passed")
  assert.deepEqual(result.closure, {
    owner_db_count: 3,
    raw_count: 1,
    artifact_count: 1,
    profile_count: 1,
    durable_ref_count: 3,
  })
  assert.equal(Object.values(result.assertions).every(Boolean), true)
  assert.equal(result.limitations.includes("real_server_volume_recovery_remains_an_adoption_gate"), true)
})
