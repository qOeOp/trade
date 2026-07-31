#!/usr/bin/env bun

import { Database } from "bun:sqlite"
import { errorResponse, printScriptResult, readFlagValue, readJsonObject, successResponse } from "../../../../../contracts/runtime-core/src/script-json"
import type { JSONRecord } from "../../../../../contracts/runtime-core/src/json"
import type { DraftStrategyAuthorization } from "../../../contracts/src/lib/control-plane-contracts"
import type { StrategyPolicySource } from "../../../strategy-policy-writer/src/lib/strategy-policy-writer"
import { materializeDraftStrategy } from "../lib/strategy-registry"

const SCHEMA_VERSION = "rd-strategy-registry.script-response.v1"

export function run(argv: string[]): JSONRecord {
  let db: Database | undefined
  try {
    const config = parse(argv)
    const input = config.input
    db = new Database(config.dbPath)
    const result = materializeDraftStrategy(db, {
      draft_id: required(input.draft_id, "draft_id"),
      strategy_version: required(input.strategy_version, "strategy_version"),
      idempotency_key: required(input.idempotency_key, "idempotency_key"),
      strategy_root: config.strategyRoot,
      created_at: required(input.created_at, "created_at"),
      authorization: record(input.authorization) as unknown as DraftStrategyAuthorization,
      policy_source: record(input.policy_source) as unknown as StrategyPolicySource,
    })
    return successResponse(SCHEMA_VERSION, result)
  } catch (error) {
    return errorResponse(SCHEMA_VERSION, error)
  } finally {
    db?.close()
  }
}

function parse(argv: string[]): { dbPath: string; strategyRoot: string; input: JSONRecord } {
  let dbPath = ""
  let strategyRoot = "strategies"
  let input: JSONRecord = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--db") dbPath = readFlagValue(argv, ++index, arg)
    else if (arg === "--strategy-root") strategyRoot = readFlagValue(argv, ++index, arg)
    else if (arg === "--json") input = readJsonObject(readFlagValue(argv, ++index, arg))
    else throw new Error(`unknown flag: ${arg}`)
  }
  if (!dbPath) throw new Error("Strategy Registry requires --db")
  return { dbPath, strategyRoot, input }
}

function record(value: unknown): JSONRecord { return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {} }
function required(value: unknown, field: string): string { if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`); return value.trim() }

if (import.meta.main) printScriptResult(run(process.argv.slice(2)))
