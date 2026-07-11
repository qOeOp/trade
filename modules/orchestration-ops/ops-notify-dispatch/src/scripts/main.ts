#!/usr/bin/env bun

import { Database } from "bun:sqlite"
import { readFileSync } from "node:fs"
import { runOpsNotifyDispatch } from "../lib/ops-notify-dispatch"
import type { JSONRecord } from "../../../../contracts/runtime-core/src/json"

interface Args {
  dbPath: string
  json: JSONRecord
}

export function parseArgs(argv: string[]): Args {
  let dbPath = "data/ops_runtime.db"
  let json: JSONRecord = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--db") {
      dbPath = argv[++index] ?? dbPath
    } else if (arg === "--json") {
      json = JSON.parse(argv[++index] ?? "{}") as JSONRecord
    } else if (arg === "--json-file") {
      json = JSON.parse(readFileSync(argv[++index] ?? "", "utf8")) as JSONRecord
    } else if (arg === "--help") {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }
  return { dbPath, json }
}

export async function run(args: Args): Promise<JSONRecord> {
  const db = new Database(args.dbPath)
  try {
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

