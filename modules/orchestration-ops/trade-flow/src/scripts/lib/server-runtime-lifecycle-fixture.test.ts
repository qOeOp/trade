import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import { repoRoot } from "../../../../../contracts/runtime-core/src/paths"
import { runServerRuntimeLifecycleFixture } from "./server-runtime-lifecycle-fixture"
import { parseServerRuntimeProfile } from "./server-runtime-profile"

const profile = parseServerRuntimeProfile(JSON.parse(
  readFileSync(resolve(repoRoot(), "profile/server-runtime.json"), "utf8"),
))

test("lifecycle fixture proves dependency order, restart isolation, reverse drain, and no orphan", async () => {
  const result = await runServerRuntimeLifecycleFixture(profile, process.execPath)
  assert.equal(result.status, "passed")
  assert.deepEqual(result.assertions, {
    dependency_start_order: true,
    consumer_restart_isolated: true,
    reverse_stop_order: true,
    no_managed_child_alive: true,
  })
  assert.deepEqual(result.events.map(({ component, attempt, action }) => [component, attempt, action]), [
    ["l2_owner", 1, "start"],
    ["l2_owner", 1, "ready"],
    ["l2_consumer", 1, "start"],
    ["l2_consumer", 1, "ready"],
    ["control_runtime", 1, "start"],
    ["control_runtime", 1, "ready"],
    ["l2_consumer", 1, "fail"],
    ["l2_consumer", 1, "exit"],
    ["l2_consumer", 2, "start"],
    ["l2_consumer", 2, "ready"],
    ["control_runtime", 1, "stop"],
    ["control_runtime", 1, "stopped"],
    ["l2_consumer", 2, "stop"],
    ["l2_consumer", 2, "stopped"],
    ["l2_owner", 1, "stop"],
    ["l2_owner", 1, "stopped"],
  ])
})

test("lifecycle fixture rejects an unbounded or relative process runner", async () => {
  await assert.rejects(runServerRuntimeLifecycleFixture(profile, "bun"), /bun_path/)
  await assert.rejects(runServerRuntimeLifecycleFixture(profile, process.execPath, 31_000), /timeout_ms/)
})
