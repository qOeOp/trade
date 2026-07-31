import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import { mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"
import { repoRoot } from "../../../../../contracts/runtime-core/src/paths"
import { ensureResearchStateSchema } from "../../../state-store/src/lib/research-state-store"
import { run } from "./main"

test("Replay cancellation recovery CLI exposes the Control Plane-owned startup job", () => {
  const relativeRoot = "tmp/check/rd-replay-cancellation-recovery-cli"
  const absoluteRoot = join(repoRoot(), relativeRoot)
  const dbPath = `${relativeRoot}/rd.db`
  const artifactRoot = `${relativeRoot}/artifacts`
  rmSync(absoluteRoot, { recursive: true, force: true })
  mkdirSync(join(repoRoot(), artifactRoot), { recursive: true })
  const db = new Database(join(repoRoot(), dbPath))
  ensureResearchStateSchema(db)
  db.close()
  try {
    const response = run([
      "--db", dbPath,
      "--artifact-root", artifactRoot,
      "--registered-at", "2026-07-16T08:00:00Z",
    ])
    assert.equal(response.ok, true)
    const data = response.data as Record<string, unknown>
    assert.equal(data.schema_version, "trade.rd-replay-cancellation-recovery-job-result.v1")
    assert.equal(data.status, "no_outbox")
    assert.equal(JSON.stringify(response).includes(repoRoot()), false)
  } finally {
    rmSync(absoluteRoot, { recursive: true, force: true })
  }
})

test("Replay cancellation recovery CLI requires an explicit artifact root", () => {
  const response = run(["--db", "data/rd_state.db"])
  assert.equal(response.ok, false)
  assert.match(String(response.error), /artifact-root/)
})
