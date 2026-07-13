#!/usr/bin/env bun

type JSONRecord = Record<string, unknown>

function main(argv: string[]): void {
  const result = run(argv)
  console.log(JSON.stringify(result, null, 2))
  if (!result.ok) process.exit(1)
}

export function run(argv: string[]): JSONRecord {
  try {
    const input = parseArgs(argv)
    const planRef = stringField(input.plan_ref)
    const decisionInputRef = stringField(input.decision_input_ref)
    const symbol = stringField(input.symbol)
    const side = stringField(input.side)
    const sourceRefs = stringArray(input.source_refs)
    if (!planRef) throw new Error("plan_ref is required")
    if (!decisionInputRef) throw new Error("decision_input_ref is required")
    if (!symbol) throw new Error("symbol is required")
    if (!["long", "short"].includes(side)) throw new Error("side must be long or short")
    if (sourceRefs.length === 0) throw new Error("source_refs must be non-empty")
    return {
      ok: true,
      schema_version: "trade-plan-builder.result.v1",
      data: removeUndefined({
        schema_version: "trade-plan-draft.v1",
        plan_ref: planRef,
        decision_input_ref: decisionInputRef,
        symbol,
        side,
        entry: optionalNumber(input.entry),
        stop: optionalNumber(input.stop),
        invalidation_ref: stringField(input.invalidation_ref) || undefined,
        trigger_ref: stringField(input.trigger_ref) || undefined,
        risk_budget_ref: stringField(input.risk_budget_ref) || undefined,
        expires_at: stringField(input.expires_at) || undefined,
        source_refs: sourceRefs,
        content_hash: stringField(input.content_hash) || stableHash([planRef, decisionInputRef, symbol, side, ...sourceRefs].join("|")),
      }),
    }
  } catch (error) {
    return { ok: false, schema_version: "trade-plan-builder.result.v1", error: error instanceof Error ? error.message : String(error) }
  }
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

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(stringField).filter(Boolean) : []
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error("numeric plan fields must be finite")
  return parsed
}

function removeUndefined(record: JSONRecord): JSONRecord {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined))
}

function stableHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `fnv1a:${(hash >>> 0).toString(16)}`
}

function printHelp(): void {
  console.log("Usage: bun src/scripts/main.ts --json '<trade plan payload>'")
}

if (import.meta.main) main(process.argv.slice(2))
