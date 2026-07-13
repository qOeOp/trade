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
    return {
      ok: true,
      schema_version: "market-fact-publisher.result.v1",
      data: buildMarketDataManifest(input),
    }
  } catch (error) {
    return { ok: false, schema_version: "market-fact-publisher.result.v1", error: error instanceof Error ? error.message : String(error) }
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

function buildMarketDataManifest(input: JSONRecord): JSONRecord {
  const manifestRef = stringField(input.manifest_ref)
  const layer = stringField(input.layer)
  const symbolScope = stringArray(input.symbol_scope)
  const timeWindow = asRecord(input.time_window)
  const freshness = asRecord(input.freshness)
  const contentHash = stringField(input.content_hash)
  if (!manifestRef) throw new Error("manifest_ref is required")
  if (!["raw_capture", "canonical_facts", "features", "dataset"].includes(layer)) throw new Error("layer is unsupported")
  if (symbolScope.length === 0) throw new Error("symbol_scope is required")
  if (!stringField(timeWindow.start_at) || !stringField(timeWindow.end_at)) throw new Error("time_window.start_at and end_at are required")
  if (!contentHash) throw new Error("content_hash is required")
  if (!stringField(freshness.as_of)) throw new Error("freshness.as_of is required")
  const maxAge = Number(freshness.max_age_seconds)
  if (!Number.isFinite(maxAge) || maxAge < 0) throw new Error("freshness.max_age_seconds must be non-negative")
  return removeUndefined({
    schema_version: "trade.protocol.market-data-manifest.v1",
    manifest_ref: manifestRef,
    layer,
    symbol_scope: symbolScope,
    time_window: {
      start_at: stringField(timeWindow.start_at),
      end_at: stringField(timeWindow.end_at),
      availability_at: stringField(timeWindow.availability_at) || undefined,
      lookback_start: stringField(timeWindow.lookback_start) || undefined,
      label_end: stringField(timeWindow.label_end) || undefined,
    },
    content_hash: contentHash,
    freshness: {
      as_of: stringField(freshness.as_of),
      max_age_seconds: maxAge,
    },
    input_refs: stringArray(input.input_refs),
    feature_hash: stringField(input.feature_hash) || undefined,
    dataset_split: stringField(input.dataset_split) || undefined,
  })
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

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(stringField).filter(Boolean) : []
}

function removeUndefined(record: JSONRecord): JSONRecord {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined))
}

function printHelp(): void {
  console.log("Usage: bun src/scripts/main.ts --json '<market fact payload>'")
}

if (import.meta.main) main(process.argv.slice(2))
