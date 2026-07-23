#!/usr/bin/env bun

import { stringField, type JSONRecord } from "../../../../contracts/runtime-core/src/json"
import { errorResponse, printScriptResult, readJsonObjectFlag, successResponse } from "../../../../contracts/runtime-core/src/script-json"

const SCHEMA_VERSION = "exchange-request-router.result.v1"

const READ_ACTIONS = ["account_snapshot", "symbol_snapshot", "market_scan", "aggtrades_fetch"] as const
const WRITE_ACTIONS = ["place_entry", "cancel_order", "adjust_position", "sync_protection", "reduce_position", "close_position"] as const

function main(argv: string[]): void {
  printScriptResult(run(argv))
}

export function run(argv: string[]): JSONRecord {
  try {
    const input = readJsonObjectFlag(argv, printHelp)
    const action = stringField(input.action)
    const requestKind = stringField(input.request_kind) || inferRequestKind(action)
    if (!action) throw new Error("action is required")
    if (requestKind !== "read" && requestKind !== "write") throw new Error("request_kind must be read or write")
    if (requestKind === "read" && !READ_ACTIONS.includes(action as typeof READ_ACTIONS[number])) throw new Error("unsupported read action")
    if (requestKind === "write" && !WRITE_ACTIONS.includes(action as typeof WRITE_ACTIONS[number])) throw new Error("unsupported write action")
    if (requestKind === "write" && !stringField(input.capability_ref)) throw new Error("write request requires capability_ref")
    return successResponse(SCHEMA_VERSION, {
        schema_version: "exchange-request-route.v1",
        request_kind: requestKind,
        action,
        route: requestKind === "read" ? "exchange-read-adapter" : "exchange-write-pre-adapter-gate",
        symbol: stringField(input.symbol) || undefined,
        mode: stringField(input.mode) || undefined,
        idempotency_key: stringField(input.idempotency_key) || undefined,
        source_intent_ref: stringField(input.source_intent_ref) || undefined,
        capability_ref: stringField(input.capability_ref) || undefined,
      })
  } catch (error) {
    return errorResponse(SCHEMA_VERSION, error)
  }
}

function inferRequestKind(action: string): string {
  if (READ_ACTIONS.includes(action as typeof READ_ACTIONS[number])) return "read"
  if (WRITE_ACTIONS.includes(action as typeof WRITE_ACTIONS[number])) return "write"
  return ""
}

function printHelp(): void {
  console.log("Usage: bun src/scripts/main.ts --json '<exchange route payload>'")
}

if (import.meta.main) main(process.argv.slice(2))
