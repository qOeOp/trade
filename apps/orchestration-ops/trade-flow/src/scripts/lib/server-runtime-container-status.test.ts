import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import { repoRoot } from "../../../../../contracts/runtime-core/src/paths"
import {
  readServerRuntimeContainerStatus,
  type ContainerStateReader,
  type ContainerStatusExecutor,
} from "./server-runtime-container-status"
import { parseServerRuntimeContainerProfile } from "./server-runtime-container-profile"

const NOW = Date.parse("2026-07-23T01:00:00.000Z")
const profile = parseServerRuntimeContainerProfile(JSON.parse(
  readFileSync(resolve(repoRoot(), "profile/server-runtime-container.json"), "utf8"),
))

test("container status requires control plus all resident market-data workers", async () => {
  const ready = await readServerRuntimeContainerStatus(
    profile, "/opt/trade", "/usr/bin/bun", control(), state(), () => NOW,
  )
  assert.equal(ready.status, "ready")
  assert.equal(ready.overall_ready, true)
  assert.equal(ready.live_writes_allowed, false)

  const blocked = await readServerRuntimeContainerStatus(
    profile, "/opt/trade", "/usr/bin/bun", control(), state("ohlcv-worker"), () => NOW,
  )
  assert.equal(blocked.status, "not_ready")
  assert.equal(blocked.components["ohlcv-worker"].ready, false)
  assert.equal(blocked.overall_ready, false)
})

test("container status fails closed on stale state and malformed control output", async () => {
  const stale = await readServerRuntimeContainerStatus(
    profile,
    "/opt/trade",
    "/usr/bin/bun",
    control(),
    () => ({ status: "running", observed_at: "2026-07-20T00:00:00.000Z" }),
    () => NOW,
  )
  assert.equal(stale.status, "not_ready")
  const malformed = await readServerRuntimeContainerStatus(
    profile,
    "/opt/trade",
    "/usr/bin/bun",
    async () => ({ exit_code: 0, stdout: "not-json" }),
    state(),
    () => NOW,
  )
  assert.equal(malformed.status, "not_ready")
})

function control(active = true): ContainerStatusExecutor {
  return async () => json({ parity_status: { supervisor_lease: { active } } })
}

function state(blocked?: Parameters<ContainerStateReader>[0]): ContainerStateReader {
  return (component) => ({
    status: component === blocked ? "degraded" : "running",
    observed_at: "2026-07-23T00:59:59.000Z",
  })
}

function json(value: unknown) {
  return { exit_code: 0, stdout: JSON.stringify(value) }
}
