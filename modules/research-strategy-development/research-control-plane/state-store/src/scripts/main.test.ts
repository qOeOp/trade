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

test("research state store CLI seeds and reads the authoritative planning context", () => {
  const dir = mkdtempSync(join(tmpdir(), "research-control-plane-"))
  const dbPath = join(dir, "rd.db")
  try {
    const seeded = run(parseArgs([
      "--db", dbPath, "--action", "seed_default_control_plane",
      "--json", JSON.stringify({ now: "2026-07-14T06:00:00Z" }),
    ])) as { nodes: number; data_surfaces: number }
    assert.equal(seeded.nodes > 80, true)
    assert.equal(seeded.data_surfaces, 11)
    const read = run(parseArgs([
      "--db", dbPath, "--action", "read_planning_context", "--json", "{}",
    ])) as { context: { active_canonicals: unknown[]; capabilities: unknown[] } }
    assert.equal(read.context.active_canonicals.length, 7)
    assert.equal(read.context.capabilities.length, 7)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
