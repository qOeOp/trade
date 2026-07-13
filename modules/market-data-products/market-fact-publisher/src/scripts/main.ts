#!/usr/bin/env bun

import { asRecord, stringArray, stringField, withoutUndefined, type JSONRecord } from "../../../../contracts/runtime-core/src/json"
import { errorResponse, printScriptResult, readJsonObjectFlag, successResponse } from "../../../../contracts/runtime-core/src/script-json"

const SCHEMA_VERSION = "market-fact-publisher.result.v1"

function main(argv: string[]): void {
  printScriptResult(run(argv))
}

export function run(argv: string[]): JSONRecord {
  try {
    const input = readJsonObjectFlag(argv, printHelp)
    return successResponse(SCHEMA_VERSION, buildMarketDataManifest(input))
  } catch (error) {
    return errorResponse(SCHEMA_VERSION, error)
  }
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
  return withoutUndefined({
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

function printHelp(): void {
  console.log("Usage: bun src/scripts/main.ts --json '<market fact payload>'")
}

if (import.meta.main) main(process.argv.slice(2))
