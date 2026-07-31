import assert from "node:assert/strict"
import { mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { Database } from "bun:sqlite"
import test from "node:test"

import { appendPlanEvent, ensureSchema } from "../../../../portfolio-execution-state/event-store/src/lib/event-store"
import { buildDatabaseIdentity, ensureDatabaseIdentity } from "../../../../contracts/runtime-core/src/database-identity"
import { repoRoot } from "../../../../contracts/runtime-core/src/paths"
import { run } from "./main"

test("fast track guard CLI exposes native J02 domain runtime result", async () => {
  const dir = "tmp/check/fast-track-guard-cli"
  const absoluteDir = join(repoRoot(), dir)
  rmSync(absoluteDir, { recursive: true, force: true })
  mkdirSync(absoluteDir, { recursive: true })
  const dbPath = `${dir}/trade.db`
  const db = new Database(join(repoRoot(), dbPath))
  try {
    ensureDatabaseIdentity(db, buildDatabaseIdentity("local:local", "trade_event_store"))
    ensureSchema(db)
    appendPlanEvent(db, {
      event_key: "obs-fast-cli-slow-1",
      chain_id: "flow-fast-cli-1",
      kind: "observe",
      created_at: "2026-07-08T12:00:00Z",
      body_json: { source: "slow_track", symbol: "BTCUSDT", side: "long", action_intent: { target_action: "no_action" } },
    })
  } finally {
    db.close()
  }

  try {
    const result = await run([
      "--fast-guard-job",
      "--db",
      dbPath,
      "--json",
      JSON.stringify({ cycle_id: "cycle-j02-cli", run_id: "fast-cli" }),
    ])

    assert.equal(result.ok, true)
    const data = result.data as { runtime_result: Record<string, unknown> }
    assert.equal(data.runtime_result.schema_id, "trade.domain-runtime.domain-job-result.v1")
    assert.equal(data.runtime_result.domain, "live-execution-control")
    assert.equal(data.runtime_result.job_id, "fast_track_guard")
    assert.equal(data.runtime_result.status, "ok")
    assert.deepEqual(data.runtime_result.writes, { trade_event_store: true })
  } finally {
    rmSync(absoluteDir, { recursive: true, force: true })
  }
})
