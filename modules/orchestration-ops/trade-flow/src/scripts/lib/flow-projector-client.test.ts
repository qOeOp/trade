import assert from "node:assert/strict"
import { Database } from "bun:sqlite"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"
import { buildDatabaseIdentity, ensureDatabaseIdentity } from "../../../../../contracts/runtime-core/src/database-identity"
import { repoRoot } from "../../../../../contracts/runtime-core/src/paths"
import { ensureSchema } from "../../../../../portfolio-execution-state/event-store/src/lib/event-store"
import { activeFlowsAsync, runBoundedOwnerCommand } from "./flow-projector-client"

test("active flow owner read has a hard subprocess timeout", async () => {
  await assert.rejects(
    () => runBoundedOwnerCommand({
      argv: ["/bin/sleep", "60"],
      cwd: process.cwd(),
    }, 100),
    /flow projector owner tool timed out after 100ms/,
  )
})

test("active flow owner read fails bounded while trade DB is exclusively locked", async () => {
  const checkRoot = join(repoRoot(), "tmp", "check")
  mkdirSync(checkRoot, { recursive: true })
  const directory = mkdtempSync(join(checkRoot, "flow-owner-locked-"))
  const dbPath = join(directory, "trade.db")
  const blocker = new Database(dbPath)
  try {
    ensureDatabaseIdentity(blocker, buildDatabaseIdentity("local:local", "trade_event_store"))
    ensureSchema(blocker)
    const initial = await activeFlowsAsync(dbPath, 2_000)
    assert.equal(initial.active_flow_count, 0)
    blocker.run("PRAGMA journal_mode = DELETE")
    blocker.run("BEGIN EXCLUSIVE")
    const startedAt = Date.now()
    await assert.rejects(
      () => activeFlowsAsync(dbPath, 100),
      /(database is locked|flow projector owner tool timed out after 100ms)/,
    )
    assert.equal(Date.now() - startedAt < 2_000, true)
  } finally {
    try { blocker.run("ROLLBACK") } catch { /* fixture cleanup is best-effort */ }
    blocker.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
