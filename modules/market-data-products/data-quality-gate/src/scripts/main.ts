#!/usr/bin/env bun

type JSONRecord = Record<string, unknown>

interface GateIssue {
  field: string
  reason: string
}

function main(argv: string[]): void {
  const result = run(argv)
  console.log(JSON.stringify(result, null, 2))
  if (!result.ok) process.exit(1)
}

export function run(argv: string[]): JSONRecord {
  try {
    const input = parseArgs(argv)
    const issues = validateMarketDataManifest(input)
    return {
      ok: issues.length === 0,
      schema_version: "market-data-quality-gate.result.v1",
      data: {
        status: issues.length === 0 ? "passed" : "blocked",
        issues,
        manifest_ref: stringField(input.manifest_ref),
      },
      ...(issues.length > 0 ? { error: issues.map((issue) => `${issue.field}:${issue.reason}`).join("; ") } : {}),
    }
  } catch (error) {
    return { ok: false, schema_version: "market-data-quality-gate.result.v1", error: error instanceof Error ? error.message : String(error) }
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

function validateMarketDataManifest(input: JSONRecord): GateIssue[] {
  const issues: GateIssue[] = []
  if (input.schema_version !== "trade.protocol.market-data-manifest.v1") issues.push({ field: "schema_version", reason: "unsupported schema" })
  if (!stringField(input.manifest_ref)) issues.push({ field: "manifest_ref", reason: "required" })
  if (!["raw_capture", "canonical_facts", "features", "dataset"].includes(stringField(input.layer))) issues.push({ field: "layer", reason: "unsupported layer" })
  if (!Array.isArray(input.symbol_scope) || input.symbol_scope.length === 0) issues.push({ field: "symbol_scope", reason: "must be non-empty" })
  if (!stringField(input.content_hash)) issues.push({ field: "content_hash", reason: "required" })
  const timeWindow = asRecord(input.time_window)
  if (!stringField(timeWindow.start_at) || !stringField(timeWindow.end_at)) issues.push({ field: "time_window", reason: "start_at and end_at required" })
  const freshness = asRecord(input.freshness)
  if (!stringField(freshness.as_of)) issues.push({ field: "freshness.as_of", reason: "required" })
  if (!Number.isFinite(Number(freshness.max_age_seconds)) || Number(freshness.max_age_seconds) < 0) issues.push({ field: "freshness.max_age_seconds", reason: "must be non-negative" })
  return issues
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

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function printHelp(): void {
  console.log("Usage: bun src/scripts/main.ts --json '<market-data-manifest>'")
}

if (import.meta.main) main(process.argv.slice(2))
