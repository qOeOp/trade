import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { parseArgs, run } from "./main"

test("ops notify CLI records a dry-run notification", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ops-notify-cli-"))
  const dbPath = join(dir, "ops.db")
  try {
    const result = await run(parseArgs([
      "--db",
      dbPath,
      "--json",
      JSON.stringify({
        dry_run: true,
        channels: ["stdout"],
        payload: { message: "hello" },
      }),
    ])) as { attempts: Array<{ status: string }> }
    assert.equal(result.attempts[0].status, "skipped")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

