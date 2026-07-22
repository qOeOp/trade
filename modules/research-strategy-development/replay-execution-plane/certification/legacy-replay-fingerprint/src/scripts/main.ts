#!/usr/bin/env bun

import { errorResponse, printScriptResult, readFlagValue, readJsonObject, successResponse } from "../../../../../../contracts/runtime-core/src/script-json"
import type { JSONRecord } from "../../../../../../contracts/runtime-core/src/json"
import { repoRoot } from "../../../../../../contracts/runtime-core/src/paths"
import { hashCanonical, replayDataHash, replayHarnessHash } from "../../../../compatibility/legacy-research-kernel/src/lib/replay-core"

const SCHEMA_VERSION = "legacy-replay-fingerprint.script-response.v1"

export function run(argv: string[]): JSONRecord {
  const previousCwd = process.cwd()
  try {
    process.chdir(repoRoot())
    return successResponse(SCHEMA_VERSION, buildFingerprint(parseInput(argv)))
  } catch (error) {
    return errorResponse(SCHEMA_VERSION, error)
  } finally {
    process.chdir(previousCwd)
  }
}

function parseInput(argv: string[]): JSONRecord {
  let input: JSONRecord = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--json") {
      input = readJsonObject(readFlagValue(argv, ++index, arg))
    } else if (arg === "--help") {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`unknown flag: ${arg}`)
    }
  }
  return input
}

function buildFingerprint(input: JSONRecord): JSONRecord {
  const manifestPath = stringField(input.manifest_path)
  const timeframe = stringField(input.timeframe)
  const supplementalDataRefs = stringArray(input.supplemental_data_refs)
  const hasAssumptions = Object.prototype.hasOwnProperty.call(input, "assumptions")
  const assumptions = hasAssumptions ? requiredRecord(input.assumptions, "assumptions") : undefined
  if (Boolean(manifestPath) !== Boolean(timeframe)) {
    throw new Error("manifest_path and timeframe must be provided together")
  }
  return {
    harness_hash: replayHarnessHash(),
    ...(manifestPath ? { data_hash: replayDataHash(manifestPath, timeframe, supplementalDataRefs) } : {}),
    ...(assumptions ? { assumptions_hash: hashCanonical(assumptions) } : {}),
  }
}

function requiredRecord(value: unknown, field: string): JSONRecord {
  const result = record(value)
  if (result !== value) throw new Error(`${field} must be an object`)
  return result
}

function record(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(stringField).filter(Boolean) : []
}

function printHelp(): void {
  console.log("Usage: bun src/scripts/main.ts --json '<payload>'")
}

if (import.meta.main) {
  printScriptResult(run(process.argv.slice(2)))
}
