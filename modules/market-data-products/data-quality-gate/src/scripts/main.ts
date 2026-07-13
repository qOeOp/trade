#!/usr/bin/env bun

import { asRecord, stringField, type JSONRecord } from "../../../../contracts/runtime-core/src/json"
import { errorResponse, printScriptResult, readJsonObjectFlag } from "../../../../contracts/runtime-core/src/script-json"

const SCHEMA_VERSION = "market-data-quality-gate.result.v1"

interface GateIssue {
  field: string
  reason: string
}

function main(argv: string[]): void {
  printScriptResult(run(argv))
}

export function run(argv: string[]): JSONRecord {
  try {
    const input = readJsonObjectFlag(argv, printHelp)
    const issues = validateMarketDataManifest(input)
    return {
      ok: issues.length === 0,
      schema_version: SCHEMA_VERSION,
      data: {
        status: issues.length === 0 ? "passed" : "blocked",
        issues,
        manifest_ref: stringField(input.manifest_ref),
      },
      ...(issues.length > 0 ? { error: issues.map((issue) => `${issue.field}:${issue.reason}`).join("; ") } : {}),
    }
  } catch (error) {
    return errorResponse(SCHEMA_VERSION, error)
  }
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

function printHelp(): void {
  console.log("Usage: bun src/scripts/main.ts --json '<market-data-manifest>'")
}

if (import.meta.main) main(process.argv.slice(2))
