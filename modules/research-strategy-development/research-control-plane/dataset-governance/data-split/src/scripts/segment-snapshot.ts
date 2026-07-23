#!/usr/bin/env bun

import {
  errorResponse,
  printScriptResult,
  readJsonInputArgs,
  successResponse,
} from "../../../../../../contracts/runtime-core/src/script-json"
import { repoRoot } from "../../../../../../contracts/runtime-core/src/paths"
import { bindDataSplitSegmentSnapshot } from "../lib/data-split-segment-snapshot"

const SCHEMA_VERSION = "data-split.segment-snapshot-script-response.v1"

async function main(argv: string[]): Promise<void> {
  const previousCwd = process.cwd()
  try {
    process.chdir(repoRoot())
    const { input } = readJsonInputArgs(argv, printHelp)
    const snapshot = await bindDataSplitSegmentSnapshot({
      report_path: stringField(input.report_path, "report_path"),
      dataset_id: stringField(input.dataset_id, "dataset_id"),
      segment: segmentField(input.segment),
      timeframe: stringField(input.timeframe, "timeframe"),
    })
    printScriptResult(successResponse(SCHEMA_VERSION, { snapshot }))
  } catch (error) {
    printScriptResult(errorResponse(SCHEMA_VERSION, error))
  } finally {
    process.chdir(previousCwd)
  }
}

function segmentField(value: unknown): "discovery" | "validation" {
  if (value !== "discovery" && value !== "validation") {
    throw new Error("segment must be discovery or validation")
  }
  return value
}

function stringField(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`)
  return value
}

function printHelp(): void {
  console.log("Usage: bun src/scripts/segment-snapshot.ts --json '<payload>'")
}

if (import.meta.main) {
  await main(process.argv.slice(2))
}
