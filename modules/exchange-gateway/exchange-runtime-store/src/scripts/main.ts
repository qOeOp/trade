#!/usr/bin/env bun

import { Database } from "bun:sqlite"
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
import { readDbActionJsonArgs, type DbActionJsonArgs } from "../../../../contracts/runtime-core/src/script-json"

type Args = DbActionJsonArgs

export function parseArgs(argv: string[]): Args {
  return readDbActionJsonArgs(argv, { dbPath: "data/exchange_runtime.db" }, printHelp)
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
