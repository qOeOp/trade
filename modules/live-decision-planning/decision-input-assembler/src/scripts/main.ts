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
    const decisionInputRef = stringField(input.decision_input_ref)
    const sourceRefs = stringArray(input.source_refs)
    const assembledAt = stringField(input.assembled_at)
    if (!decisionInputRef) throw new Error("decision_input_ref is required")
    if (sourceRefs.length === 0) throw new Error("source_refs must be non-empty")
    if (!assembledAt) throw new Error("assembled_at is required")
    return {
      ok: true,
      schema_version: "decision-input-assembler.result.v1",
      data: removeUndefined({
        schema_version: "decision-input-bundle.v1",
        decision_input_ref: decisionInputRef,
        source_refs: sourceRefs,
        policy_refs: stringArray(input.policy_refs),
        market_refs: stringArray(input.market_refs),
        flow_refs: stringArray(input.flow_refs),
        account_refs: stringArray(input.account_refs),
        evidence_refs: stringArray(input.evidence_refs),
        symbol_scope: stringArray(input.symbol_scope),
        assembled_at: assembledAt,
        content_hash: stringField(input.content_hash) || stableHash([decisionInputRef, ...sourceRefs, assembledAt].join("|")),
      }),
    }
  } catch (error) {
    return { ok: false, schema_version: "decision-input-assembler.result.v1", error: error instanceof Error ? error.message : String(error) }
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
  console.log("Usage: bun src/scripts/main.ts --json '<decision input payload>'")
}

if (import.meta.main) main(process.argv.slice(2))
