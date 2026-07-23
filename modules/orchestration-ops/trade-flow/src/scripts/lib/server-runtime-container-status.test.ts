import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import { repoRoot } from "../../../../../contracts/runtime-core/src/paths"
import { readServerRuntimeContainerStatus, type ContainerStatusExecutor } from "./server-runtime-container-status"
import { parseServerRuntimeProfile } from "./server-runtime-profile"

const profile = parseServerRuntimeProfile(JSON.parse(
  readFileSync(resolve(repoRoot(), "profile/server-runtime.json"), "utf8"),
))

test("container status requires all three owner-level readiness contracts", async () => {
  const ready = await readServerRuntimeContainerStatus(profile, "/opt/trade", "/usr/bin/bun", fixture())
  assert.equal(ready.status, "ready")
  assert.equal(ready.overall_ready, true)
  assert.equal(ready.live_writes_allowed, false)

  const blocked = await readServerRuntimeContainerStatus(profile, "/opt/trade", "/usr/bin/bun", fixture("consumer"))
  assert.equal(blocked.status, "not_ready")
  assert.equal(blocked.components["l2-consumer"].ready, false)
  assert.equal(blocked.overall_ready, false)
})

test("container status fails closed on malformed or failed owner output", async () => {
  const malformed = await readServerRuntimeContainerStatus(profile, "/opt/trade", "/usr/bin/bun", async () => ({
    exit_code: 0, stdout: "not-json",
  }))
  assert.equal(malformed.status, "not_ready")
  const failed = await readServerRuntimeContainerStatus(profile, "/opt/trade", "/usr/bin/bun", async () => ({
    exit_code: 1, stdout: "{}",
  }))
  assert.equal(failed.status, "not_ready")
})

function fixture(blocked?: "owner" | "consumer" | "control"): ContainerStatusExecutor {
  return async (command) => {
    const script = command[1] ?? ""
    if (script.endsWith("owner-health.ts")) {
      return json({ health: { status: blocked === "owner" ? "degraded" : "healthy", readiness: { overall_ready: true } } })
    }
    if (script.endsWith("consumer-read.ts")) {
      return json({ consumer: { status: blocked === "consumer" ? "degraded" : "healthy", readiness: { overall_ready: true } } })
    }
    return json({ parity_status: { supervisor_lease: { active: blocked !== "control" } } })
  }
}

function json(value: unknown) {
  return { exit_code: 0, stdout: JSON.stringify(value) }
}
