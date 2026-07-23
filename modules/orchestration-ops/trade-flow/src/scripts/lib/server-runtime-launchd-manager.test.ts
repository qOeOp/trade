import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import test from "node:test"
import { repoRoot } from "../../../../../contracts/runtime-core/src/paths"
import { SERVER_RUNTIME_LAUNCHD_LABELS } from "./server-runtime-launchd"
import { inspectServerRuntimeLaunchd, installServerRuntimeLaunchd } from "./server-runtime-launchd-manager"

test("server launchd manager label set is closed and dependency ordered", () => {
  assert.deepEqual(Object.keys(SERVER_RUNTIME_LAUNCHD_LABELS), ["l2-owner", "l2-consumer", "control-runtime"])
  assert.deepEqual(Object.values(SERVER_RUNTIME_LAUNCHD_LABELS), [
    "com.trade.server-shadow.l2-owner",
    "com.trade.server-shadow.l2-consumer",
    "com.trade.server-shadow.control-runtime",
  ])
})

test("server launchd manager plan is path-redacted and install fails closed on blocked preflight", () => {
  const root = mkdtempSync(resolve(tmpdir(), "trade-launchd-manager-"))
  const agents = resolve(root, "agents")
  mkdirSync(resolve(root, "profile"), { recursive: true })
  writeFileSync(resolve(root, "profile/server-runtime-macos.json"), readFileSync(
    resolve(repoRoot(), "profile/server-runtime-macos.json"), "utf8",
  ))
  writeFileSync(resolve(root, "release-manifest.json"), JSON.stringify({
    schema_version: "trade.server-runtime-release-manifest.v1",
    release_id: "fixture-release",
    profile_ref: "profile/server-runtime-macos.json",
    data_seed: "empty_runtime_roots_only",
    safety: { domain_jobs_enabled: false, live_writes_allowed: false, notify_dry_run: true },
  }))
  try {
    const input = {
      release_root: root, bun_path: "/usr/bin/false", launch_agents_directory: agents, uid: 501,
      execute: () => ({ exit_code: 113, stdout: "", stderr: "not loaded" }),
    }
    const plan = inspectServerRuntimeLaunchd(input)
    assert.equal(plan.process_authority, "launchd")
    assert.equal((plan.units as JSON[]).length, 3)
    assert.equal(JSON.stringify(plan).includes(root), false)
    assert.throws(() => installServerRuntimeLaunchd(input), /preflight is blocked/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
