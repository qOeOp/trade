import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { parseArgs, run } from "./main"

test("research state store CLI upserts and reads program", () => {
  const dir = mkdtempSync(join(tmpdir(), "research-state-store-"))
  const dbPath = join(dir, "rd.db")
  try {
    run(parseArgs(["--db", dbPath, "--action", "init"]))
    run(parseArgs([
      "--db",
      dbPath,
      "--action",
      "upsert_program",
      "--json",
      JSON.stringify({
        program_id: "rd-cli",
        objective: "find edge",
        state: { usage: { trials_run: 0 } },
      }),
    ]))
    const result = run(parseArgs([
      "--db",
      dbPath,
      "--action",
      "read_program",
      "--json",
      JSON.stringify({ program_id: "rd-cli" }),
    ])) as { program: { objective: string } }
    assert.equal(result.program.objective, "find edge")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

