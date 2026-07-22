import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import test from "node:test"
import { repoRoot } from "../../../../contracts/runtime-core/src/paths"
import { parseArgs, runServerRuntimeOperation } from "./server-runtime"

test("server runtime validate is read-only and closed-world", () => {
  const args = parseArgs(["--action", "validate", "--profile", "profile/server-runtime.json"])
  const result = runServerRuntimeOperation(args)
  assert.equal(result.ok, true)
  assert.equal(result.process_authority, "systemd")
  assert.deepEqual(result.safety, {
    domain_jobs_enabled: false,
    live_writes_allowed: false,
    notify_dry_run: true,
  })
  assert.throws(() => parseArgs(["--action", "validate", "--environment", "secret"]), /unknown argument/)
})

test("server runtime render writes deterministic units without installing them", () => {
  const root = repoRoot()
  const token = `tmp/server-runtime-test-${process.pid}-${Date.now()}`
  const output = resolve(root, token)
  try {
    const args = parseArgs([
      "--action", "render-systemd",
      "--release-root", "/opt/trade",
      "--bun-path", "/usr/bin/bun",
      "--output-dir", token,
    ])
    const first = runServerRuntimeOperation(args)
    const firstOwner = readFileSync(resolve(output, "trade-l2-owner.service"), "utf8")
    const second = runServerRuntimeOperation(args)
    assert.deepEqual(first, second)
    assert.equal(first.installed, false)
    assert.equal(first.started, false)
    assert.equal(existsSync(resolve(output, "trade-server-shadow.target")), true)
    assert.equal(readFileSync(resolve(output, "trade-l2-owner.service"), "utf8"), firstOwner)
  } finally {
    rmSync(output, { recursive: true, force: true })
  }
})

test("server runtime renders deterministic macOS launch agents without installing them", () => {
  const root = repoRoot()
  const token = `tmp/server-runtime-launchd-test-${process.pid}-${Date.now()}`
  const output = resolve(root, token)
  try {
    const args = parseArgs([
      "--action", "render-launchd",
      "--profile", "profile/server-runtime-macos.json",
      "--release-root", "/opt/trade",
      "--bun-path", "/usr/local/bin/bun",
      "--output-dir", token,
    ])
    const first = runServerRuntimeOperation(args)
    const second = runServerRuntimeOperation(args)
    assert.deepEqual(first, second)
    assert.equal(first.process_authority, "launchd")
    assert.equal(first.installed, false)
    assert.equal((first.unit_refs as string[]).length, 3)
  } finally {
    rmSync(output, { recursive: true, force: true })
  }
})

test("server runtime operation rejects escaped profile and output refs", () => {
  assert.throws(() => parseArgs(["--action", "render-systemd", "--output-dir", "../units"]), /runtime output/)
  const directory = mkdtempSync(resolve(tmpdir(), "trade-profile-"))
  try {
    assert.throws(() => runServerRuntimeOperation({
      action: "validate",
      profile: resolve(directory, "profile.json"),
      releaseRoot: "/opt/trade",
      bunPath: "/usr/bin/bun",
      outputDir: "tmp/units",
    }), /escaped repository/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
