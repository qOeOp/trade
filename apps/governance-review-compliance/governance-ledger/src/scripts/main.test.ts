import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { parseArgs, run } from "./main"

test("governance ledger CLI records review batch", () => {
  const dir = mkdtempSync(join(tmpdir(), "governance-ledger-"))
  const dbPath = join(dir, "governance.db")
  try {
    run(parseArgs(["--db", dbPath, "--action", "init"]))
    const result = run(parseArgs([
      "--db",
      dbPath,
      "--action",
      "record_review_batch",
      "--json",
      JSON.stringify({ batch_id: "batch-cli", status: "planned", input_refs: ["plan_event/flow-1"] }),
    ])) as { batch: { batch_id: string } }
    assert.equal(result.batch.batch_id, "batch-cli")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
