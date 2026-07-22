import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import { repoRoot } from "../../../../../contracts/runtime-core/src/paths"
import { parseServerRuntimeProfile } from "./server-runtime-profile"
import { preflightServerRuntime, readServerRuntimeStatus, type ServerRuntimeCommandExecutor } from "./server-runtime-status"

const root = repoRoot()
const profile = parseServerRuntimeProfile(JSON.parse(readFileSync(resolve(root, "profile/server-runtime.json"), "utf8")))

test("server runtime preflight binds release, writable roots, and closed safety", () => {
  const result = preflightServerRuntime(profile, root, process.execPath, {
    path_check: (checkId) => ({ check_id: checkId, status: "ok", reason: "fixture" }),
    writable_directory_check: (checkId) => ({ check_id: checkId, status: "ok", reason: "fixture" }),
  })
  assert.equal(result.status, "ready")
  const checks = result.checks as Array<Record<string, unknown>>
  assert.equal(checks.every((check) => check.status === "ok"), true)
})

test("server runtime status requires owner readiness, same epoch, lease, and active units", () => {
  const execute = fixtureExecutor({ unitState: "active", consumerEpoch: "epoch-1", leaseActive: true })
  const result = readServerRuntimeStatus(profile, root, process.execPath, execute, "2026-07-23T00:00:00Z")
  assert.equal(result.status, "ready")
  assert.equal((result.readiness as Record<string, unknown>).overall_ready, true)
  assert.equal(JSON.stringify(result).includes("holder_id"), false)
  assert.equal(JSON.stringify(result).includes("command"), false)
})

test("server runtime status degrades without systemd and fails readiness on epoch drift", () => {
  const noManager = readServerRuntimeStatus(
    profile,
    root,
    process.execPath,
    fixtureExecutor({ unitState: "unavailable", consumerEpoch: "epoch-1", leaseActive: true }),
    "2026-07-23T00:00:00Z",
  )
  assert.equal(noManager.status, "degraded")
  assert.equal((noManager.readiness as Record<string, unknown>).overall_ready, false)
  const drift = readServerRuntimeStatus(
    profile,
    root,
    process.execPath,
    fixtureExecutor({ unitState: "active", consumerEpoch: "epoch-2", leaseActive: true }),
    "2026-07-23T00:00:00Z",
  )
  assert.equal(drift.status, "not_ready")
  assert.equal((drift.readiness as Record<string, unknown>).l2_epoch_matches_consumer, false)
})

function fixtureExecutor(input: {
  unitState: "active" | "unavailable"
  consumerEpoch: string
  leaseActive: boolean
}): ServerRuntimeCommandExecutor {
  return (command) => {
    if (command[0] === "systemctl") {
      return input.unitState === "active"
        ? { exit_code: 0, stdout: "active\n" }
        : { exit_code: 1, stdout: "" }
    }
    const script = command[1] ?? ""
    if (script.endsWith("owner-health.ts")) {
      return json({ ok: true, health: {
        readiness: { overall_ready: true },
        source: { stream_epoch: "epoch-1" },
      } })
    }
    if (script.endsWith("consumer-read.ts")) {
      return json({ ok: true, consumer: {
        readiness: { overall_ready: true },
        latest_baseline: { stream_epoch: input.consumerEpoch },
      } })
    }
    if (script.endsWith("main.ts") && command.includes("parity_status")) {
      return json({ ok: true, parity_status: { supervisor_lease: { active: input.leaseActive } } })
    }
    return { exit_code: 1, stdout: "" }
  }
}

function json(value: unknown) {
  return { exit_code: 0, stdout: JSON.stringify(value) }
}
