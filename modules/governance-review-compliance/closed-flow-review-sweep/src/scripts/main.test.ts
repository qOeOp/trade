import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { appendPlanEvent, ensureSchema } from "../../../../portfolio-execution-state/event-store/src/lib/event-store"
import { parseArgs, run } from "./main"

test("closed flow review sweep CLI records an empty batch", () => {
  const dir = mkdtempSync(join(tmpdir(), "closed-review-sweep-"))
  const tradeDbPath = join(dir, "trade.db")
  const governanceDbPath = join(dir, "governance.db")
  const tradeDb = new Database(tradeDbPath)
  try {
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
    ])) as { candidates: unknown[]; batch_ref: string }
    assert.equal(result.candidates.length, 0)
    assert.equal(result.batch_ref, "governance_ledger:review_batch/batch-empty")
  } finally {
    tradeDb.close(false)
    rmSync(dir, { recursive: true, force: true })
  }
})

