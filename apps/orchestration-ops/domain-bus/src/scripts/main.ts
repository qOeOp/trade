#!/usr/bin/env bun

import { Database } from "bun:sqlite"
import { readFileSync } from "node:fs"
import { ensureOpsRuntimeSchema } from "../../../ops-runtime-store/src/lib/ops-runtime-store"
import { listDomainMessages, publishDomainMessage } from "../lib/domain-bus"
import { type JSONRecord } from "../../../../contracts/runtime-core/src/json"

interface Args {
  action: string
  dbPath: string
  json: JSONRecord
}

export function parseArgs(argv: string[]): Args {
  let action = "publish"
  let dbPath = "data/ops_runtime.db"
  let json: JSONRecord = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--action") {
      action = argv[++index] ?? action
    } else if (arg === "--db") {
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
  return { action, dbPath, json }
}

export function run(args: Args): JSONRecord {
  const db = new Database(args.dbPath)
  try {
    ensureOpsRuntimeSchema(db)
    if (args.action === "publish") {
      return { ok: true, action: args.action, message: publishDomainMessage(db, args.json as { direction: "inbox" | "outbox" }) }
    }
    if (args.action === "list") {
      return { ok: true, action: args.action, messages: listDomainMessages(db, args.json) }
    }
    throw new Error(`unsupported action: ${args.action}`)
  } finally {
    db.close()
  }
}

function printHelp(): void {
  console.log([
    "usage: bun src/scripts/main.ts --db data/ops_runtime.db --action publish --json '{...}'",
    "actions: publish | list",
  ].join("\n"))
}

if (import.meta.main) {
  try {
    console.log(JSON.stringify(run(parseArgs(Bun.argv.slice(2))), null, 2))
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }))
    process.exit(1)
  }
}
