import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { parseArgs, run } from "./main"

test("control effectiveness review CLI persists a review", () => {
  const dir = mkdtempSync(join(tmpdir(), "control-effectiveness-review-"))
  const dbPath = join(dir, "ops.db")
  try {
    const result = run(parseArgs([
      "--db",
      dbPath,
      "--json",
      JSON.stringify({
        cycle_id: "cycle-cli-review",
        now: "2026-07-11T00:02:00Z",
      }),
    ])) as { review: { review_id: string; status: string }; refs: string[] }
    assert.equal(result.review.status, "ok")
    assert.equal(result.refs[0], `ops_runtime_store:control_review/${result.review.review_id}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
