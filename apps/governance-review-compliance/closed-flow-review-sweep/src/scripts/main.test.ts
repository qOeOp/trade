import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"
import { repoRoot } from "../../../../contracts/runtime-core/src/paths"
import { buildDatabaseIdentity, ensureDatabaseIdentity } from "../../../../contracts/runtime-core/src/database-identity"
import { appendPlanEvent, ensureSchema } from "../../../../portfolio-execution-state/event-store/src/lib/event-store"
import { parseArgs, run } from "./main"

test("closed flow review sweep CLI records an empty batch", () => {
  const root = join(repoRoot(), "tmp")
  mkdirSync(root, { recursive: true })
  const dir = mkdtempSync(join(root, "closed-review-sweep-"))
  const tradeDbPath = join(dir, "trade.db")
  const governanceDbPath = join(dir, "governance.db")
  const tradeDb = new Database(tradeDbPath)
  try {
    ensureDatabaseIdentity(tradeDb, buildDatabaseIdentity("local:local", "trade_event_store"))
    ensureSchema(tradeDb)
    appendPlanEvent(tradeDb, {
      event_key: "obs-open",
      chain_id: "flow-open",
      kind: "observe",
      created_at: "2026-07-10T00:00:00Z",
      body_json: { symbol: "BTCUSDT" },
    })
    tradeDb.close()
    const result = run(parseArgs([
      "--trade-db",
      tradeDbPath,
      "--governance-db",
      governanceDbPath,
      "--json",
      JSON.stringify({ batch_id: "batch-empty", candidate_chain_ids: ["flow-open"] }),
    ])) as { candidates: unknown[]; batch_ref: string; runtime_result: { schema_id: string; writes: Record<string, boolean> } }
    assert.equal(result.candidates.length, 0)
    assert.equal(result.batch_ref, "governance_ledger:review_batch/batch-empty")
    assert.equal(result.runtime_result.schema_id, "trade.domain-runtime.domain-job-result.v1")
    assert.deepEqual(result.runtime_result.writes, { governance_ledger: true })
  } finally {
    tradeDb.close(false)
    rmSync(dir, { recursive: true, force: true })
  }
})
