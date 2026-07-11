#!/usr/bin/env bun

import { Database } from "bun:sqlite"
import { readFileSync } from "node:fs"
import {
  buildExchangeCommand,
  buildExchangeResult,
  buildExchangeSnapshotRef,
  ensureExchangeRuntimeSchema,
  readExchangeCommandByIdempotencyKey,
  recordExchangeCommand,
  recordExchangeResult,
  recordExchangeSnapshotRef,
  updateExchangeCommandStatus,
} from "../lib/exchange-runtime-store"
import { stringField, type JSONRecord } from "../../../../contracts/runtime-core/src/json"

interface Args {
  dbPath: string
  action: string
  json: JSONRecord
}

export function parseArgs(argv: string[]): Args {
  let dbPath = "data/exchange_runtime.db"
  let action = "init"
  let json: JSONRecord = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--db") {
      dbPath = argv[++index] ?? dbPath
    } else if (arg === "--action") {
      action = argv[++index] ?? action
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
  return { dbPath, action, json }
}

export function run(args: Args): JSONRecord {
  const db = new Database(args.dbPath)
  try {
    ensureExchangeRuntimeSchema(db)
    if (args.action === "init") {
      return { ok: true, action: "init", db: args.dbPath }
    }
    if (args.action === "record_command") {
      const command = buildExchangeCommand(args.json)
      recordExchangeCommand(db, command)
      return { ok: true, action: args.action, command }
    }
    if (args.action === "update_command_status") {
      updateExchangeCommandStatus(db, stringField(args.json.command_id), stringField(args.json.status) as never)
      return { ok: true, action: args.action }
    }
    if (args.action === "record_result") {
      const result = buildExchangeResult(args.json)
      recordExchangeResult(db, result)
      return { ok: true, action: args.action, result }
    }
    if (args.action === "record_snapshot_ref") {
      const snapshot = buildExchangeSnapshotRef(args.json)
      recordExchangeSnapshotRef(db, snapshot)
      return { ok: true, action: args.action, snapshot }
    }
    if (args.action === "command_by_idempotency") {
      return {
        ok: true,
        action: args.action,
        command: readExchangeCommandByIdempotencyKey(db, stringField(args.json.idempotency_key)),
      }
    }
    throw new Error(`unsupported action: ${args.action}`)
  } finally {
    db.close()
  }
}

function printHelp(): void {
  console.log([
    "usage: bun src/scripts/main.ts --db data/exchange_runtime.db --action init",
    "actions: init | record_command | update_command_status | record_result | record_snapshot_ref | command_by_idempotency",
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
