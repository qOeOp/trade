import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { parseArgs, run } from "./main"

test("policy registry CLI records snapshot and lists approved refs", () => {
  const dir = mkdtempSync(join(tmpdir(), "policy-registry-"))
  const dbPath = join(dir, "policy.db")
  try {
    run(parseArgs(["--db", dbPath, "--action", "init"]))
    run(parseArgs([
      "--db",
      dbPath,
      "--action",
      "record_policy_snapshot",
      "--json",
      JSON.stringify({ policy_hash: "p1", source_hash: "s1", snapshot: { profile: "small" } }),
    ]))
    run(parseArgs([
      "--db",
      dbPath,
      "--action",
      "upsert_approved_strategy_ref",
      "--json",
      JSON.stringify({
        strategy_ref: "strategy://one",
        strategy_id: "one",
        policy_hash: "p1",
        status: "live-small",
        source_path: "strategies/one.md",
        source_hash: "sha256:one",
      }),
    ]))
    const result = run(parseArgs([
      "--db",
      dbPath,
      "--action",
      "list_approved_strategy_refs",
      "--json",
      JSON.stringify({ status: "live-small" }),
    ])) as { strategy_refs: Array<{ strategy_id: string }> }
    assert.equal(result.strategy_refs[0].strategy_id, "one")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

