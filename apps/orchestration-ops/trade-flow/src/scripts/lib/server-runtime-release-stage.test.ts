import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import test from "node:test"
import { assertServerRuntimeReleaseTarget, isArchivedRuntimeStateRef } from "./server-runtime-release-stage"

test("release target must be absolute, non-existing, unprotected, and outside the repository", () => {
  const root = mkdtempSync(resolve(tmpdir(), "trade-release-target-"))
  const repository = resolve(root, "source")
  mkdirSync(repository)
  try {
    assert.equal(assertServerRuntimeReleaseTarget(repository, resolve(root, "release")), resolve(root, "release"))
    assert.throws(() => assertServerRuntimeReleaseTarget(repository, "relative/release"), /absolute/)
    assert.throws(() => assertServerRuntimeReleaseTarget(repository, resolve(repository, "release")), /contain/)
    const existing = resolve(root, "existing")
    mkdirSync(existing)
    assert.throws(() => assertServerRuntimeReleaseTarget(repository, existing), /already exists/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("release target rejects broad roots", () => {
  assert.throws(() => assertServerRuntimeReleaseTarget("/opt/trade-source", "/"), /too broad/)
})

test("release staging identifies owner SQLite state anywhere under a data directory", () => {
  assert.equal(isArchivedRuntimeStateRef("data/trade.db-wal"), true)
  assert.equal(isArchivedRuntimeStateRef("apps/example/data/state.db"), true)
  assert.equal(isArchivedRuntimeStateRef("apps/example/data/state.db-shm"), true)
  assert.equal(isArchivedRuntimeStateRef("apps/example/fixtures/state.db"), false)
  assert.equal(isArchivedRuntimeStateRef("docs/data/readme.md"), false)
})
