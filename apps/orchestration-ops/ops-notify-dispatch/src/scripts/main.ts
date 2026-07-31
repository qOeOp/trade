#!/usr/bin/env bun

import { Database } from "bun:sqlite"
import { runOpsNotifyDispatch } from "../lib/ops-notify-dispatch"
import type { JSONRecord } from "../../../../contracts/runtime-core/src/json"
import { readDbJsonArgs, type DbJsonArgs } from "../../../../contracts/runtime-core/src/script-json"
import { buildDatabaseIdentity, ensureDatabaseIdentity } from "../../../../contracts/runtime-core/src/database-identity"

type Args = DbJsonArgs

export function parseArgs(argv: string[]): Args {
  return readDbJsonArgs(argv, "data/ops_runtime.db", printHelp)
}

export async function run(args: Args): Promise<JSONRecord> {
  const db = new Database(args.dbPath)
  try {
    ensureDatabaseIdentity(db, buildDatabaseIdentity(args.environmentId, "ops_runtime_store"))
    return await runOpsNotifyDispatch(db, args.json) as unknown as JSONRecord
  } finally {
    db.close()
  }
}

function printHelp(): void {
  console.log("usage: bun src/scripts/main.ts --db data/ops_runtime.db --json '{\"dry_run\":true,\"payload\":{\"message\":\"...\"}}'")
}

if (import.meta.main) {
  try {
    console.log(JSON.stringify(await run(parseArgs(Bun.argv.slice(2))), null, 2))
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }))
    process.exit(1)
  }
}
