#!/usr/bin/env bun

import { Database } from "bun:sqlite"
import {
  buildApprovedStrategyRef,
  buildPolicySnapshot,
  ensurePolicyRegistrySchema,
  listApprovedStrategyRefs,
  readPolicySnapshot,
  recordPolicySnapshot,
  upsertApprovedStrategyRef,
} from "../lib/policy-registry"
import { stringField, type JSONRecord } from "../../../../contracts/runtime-core/src/json"
import { readDbActionJsonArgs, type DbActionJsonArgs } from "../../../../contracts/runtime-core/src/script-json"

type Args = DbActionJsonArgs

export function parseArgs(argv: string[]): Args {
  return readDbActionJsonArgs(argv, { dbPath: "data/policy_registry.db" }, printHelp)
}

export function run(args: Args): JSONRecord {
  const db = new Database(args.dbPath)
  try {
    ensurePolicyRegistrySchema(db)
    if (args.action === "init") {
      return { ok: true, action: "init", db: args.dbPath }
    }
    if (args.action === "record_policy_snapshot") {
      const snapshot = buildPolicySnapshot(args.json)
      recordPolicySnapshot(db, snapshot)
      return { ok: true, action: args.action, snapshot }
    }
    if (args.action === "upsert_approved_strategy_ref") {
      const strategy_ref = buildApprovedStrategyRef(args.json)
      upsertApprovedStrategyRef(db, strategy_ref)
      return { ok: true, action: args.action, strategy_ref }
    }
    if (args.action === "read_policy_snapshot") {
      return {
        ok: true,
        action: args.action,
        snapshot: readPolicySnapshot(db, stringField(args.json.policy_hash)),
      }
    }
    if (args.action === "list_approved_strategy_refs") {
      return {
        ok: true,
        action: args.action,
        strategy_refs: listApprovedStrategyRefs(db, stringField(args.json.status) || "live-small"),
      }
    }
    throw new Error(`unsupported action: ${args.action}`)
  } finally {
    db.close()
  }
}

function printHelp(): void {
  console.log([
    "usage: bun src/scripts/main.ts --db data/policy_registry.db --action init",
    "actions: init | record_policy_snapshot | upsert_approved_strategy_ref | read_policy_snapshot | list_approved_strategy_refs",
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
