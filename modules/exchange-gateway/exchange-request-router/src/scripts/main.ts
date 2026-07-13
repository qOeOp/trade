#!/usr/bin/env bun

type JSONRecord = Record<string, unknown>

const READ_ACTIONS = ["account_snapshot", "symbol_snapshot", "market_scan", "aggtrades_fetch"] as const
const WRITE_ACTIONS = ["place_entry", "cancel_order", "adjust_position", "sync_protection", "reduce_position", "close_position"] as const

function main(argv: string[]): void {
  const result = run(argv)
  console.log(JSON.stringify(result, null, 2))
  if (!result.ok) process.exit(1)
}

export function run(argv: string[]): JSONRecord {
  try {
    const input = parseArgs(argv)
    const action = stringField(input.action)
    const requestKind = stringField(input.request_kind) || inferRequestKind(action)
    if (!action) throw new Error("action is required")
    if (requestKind !== "read" && requestKind !== "write") throw new Error("request_kind must be read or write")
    if (requestKind === "read" && !READ_ACTIONS.includes(action as typeof READ_ACTIONS[number])) throw new Error("unsupported read action")
    if (requestKind === "write" && !WRITE_ACTIONS.includes(action as typeof WRITE_ACTIONS[number])) throw new Error("unsupported write action")
    return {
      ok: true,
      schema_version: "exchange-request-router.result.v1",
      data: {
        schema_version: "exchange-request-route.v1",
        request_kind: requestKind,
        action,
        route: requestKind === "read" ? "exchange-read-adapter" : "exchange-write-pre-adapter-gate",
        symbol: stringField(input.symbol) || undefined,
        mode: stringField(input.mode) || undefined,
        idempotency_key: stringField(input.idempotency_key) || undefined,
        source_intent_ref: stringField(input.source_intent_ref) || undefined,
      },
    }
  } catch (error) {
    return { ok: false, schema_version: "exchange-request-router.result.v1", error: error instanceof Error ? error.message : String(error) }
  }
}

function inferRequestKind(action: string): string {
  if (READ_ACTIONS.includes(action as typeof READ_ACTIONS[number])) return "read"
  if (WRITE_ACTIONS.includes(action as typeof WRITE_ACTIONS[number])) return "write"
  return ""
}

function parseArgs(argv: string[]): JSONRecord {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--json") return readJson(readValue(argv, ++index, arg))
    if (arg === "--help") {
      printHelp()
      process.exit(0)
    }
    throw new Error(`unknown flag: ${arg}`)
  }
  return {}
}

function readValue(argv: string[], index: number, name: string): string {
  const value = argv[index]
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`)
  return value
}

function readJson(raw: string): JSONRecord {
  const parsed = JSON.parse(raw)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("input JSON must be an object")
  return parsed as JSONRecord
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function printHelp(): void {
  console.log("Usage: bun src/scripts/main.ts --json '<exchange route payload>'")
}

if (import.meta.main) main(process.argv.slice(2))
