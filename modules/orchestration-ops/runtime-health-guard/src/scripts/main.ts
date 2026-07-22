#!/usr/bin/env bun

import { Database } from "bun:sqlite"
import { runRuntimeHealthGuard } from "../lib/runtime-health-guard"
import type { JSONRecord } from "../../../../contracts/runtime-core/src/json"
import { readDbJsonArgs, type DbJsonArgs } from "../../../../contracts/runtime-core/src/script-json"

type Args = DbJsonArgs

export function parseArgs(argv: string[]): Args {
  return readDbJsonArgs(argv, "data/ops_runtime.db", printHelp)
}

export function run(args: Args): JSONRecord {
  const db = new Database(args.dbPath)
  try {
    return runRuntimeHealthGuard(db, args.json) as unknown as JSONRecord
  } finally {
    db.close()
  }
}

function printHelp(): void {
  console.log("usage: bun src/scripts/main.ts --db data/ops_runtime.db --json '{\"cycle_id\":\"cycle-1\"}'")
}

if (import.meta.main) {
  try {
    console.log(JSON.stringify(run(parseArgs(Bun.argv.slice(2))), null, 2))
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }))
    process.exit(1)
  }
}
