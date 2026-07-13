#!/usr/bin/env bun

type JSONRecord = Record<string, unknown>

const WRITE_ACTIONS = ["place_entry", "cancel_order", "adjust_position", "sync_protection", "reduce_position", "close_position"] as const

function main(argv: string[]): void {
  const result = run(argv)
  console.log(JSON.stringify(result, null, 2))
  if (!result.ok) process.exit(1)
}

export function run(argv: string[]): JSONRecord {
  try {
    const input = parseArgs(argv)
    const issues = validateGate(input)
    return {
      ok: issues.length === 0,
      schema_version: "write-pre-adapter-gate.result.v1",
      data: {
        schema_version: "exchange-write-pre-adapter-gate.v1",
        status: issues.length === 0 ? "passed" : "blocked",
        issues,
        action: stringField(input.action),
        mode: stringField(input.mode),
        idempotency_key: stringField(input.idempotency_key),
        source_intent_ref: stringField(input.source_intent_ref),
        client_order_id: stringField(input.client_order_id) || undefined,
      },
      ...(issues.length > 0 ? { error: issues.map((issue) => `${issue.field}:${issue.reason}`).join("; ") } : {}),
    }
  } catch (error) {
    return { ok: false, schema_version: "write-pre-adapter-gate.result.v1", error: error instanceof Error ? error.message : String(error) }
  }
}

function validateGate(input: JSONRecord): Array<{ field: string; reason: string }> {
  const issues: Array<{ field: string; reason: string }> = []
  const action = stringField(input.action)
  if (!WRITE_ACTIONS.includes(action as typeof WRITE_ACTIONS[number])) issues.push({ field: "action", reason: "unsupported write action" })
  if (!stringField(input.mode)) issues.push({ field: "mode", reason: "required" })
  if (!stringField(input.idempotency_key)) issues.push({ field: "idempotency_key", reason: "required" })
  if (!stringField(input.source_intent_ref)) issues.push({ field: "source_intent_ref", reason: "required" })
  if (input.authorized !== true) issues.push({ field: "authorized", reason: "must be true" })
  return issues
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
  console.log("Usage: bun src/scripts/main.ts --json '<exchange write gate payload>'")
}

if (import.meta.main) main(process.argv.slice(2))
