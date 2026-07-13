#!/usr/bin/env bun

import { assertProjectRuntimePath, repoRoot } from "../../../../contracts/runtime-core/src/paths"
import { errorResponse, printScriptResult, readJsonInputArgs, successResponse } from "../../../../contracts/runtime-core/src/script-json"
import type { JSONRecord } from "../../../../contracts/runtime-core/src/json"
import { runStrategyDataSplit, strategyDataSplitInputFromJson } from "../lib/strategy-data-split"

const SCHEMA_VERSION = "data-split.script-response.v1"

function main(argv: string[]): void {
  printScriptResult(run(argv))
}

export function run(argv: string[]): JSONRecord {
  const previousCwd = process.cwd()
  try {
    process.chdir(repoRoot())
    return successResponse(SCHEMA_VERSION, runConfig(readJsonInputArgs(argv, printHelp)))
  } catch (error) {
    return errorResponse(SCHEMA_VERSION, error)
  } finally {
    process.chdir(previousCwd)
  }
}

function runConfig(config: { input: JSONRecord }): unknown {
  const input = strategyDataSplitInputFromJson(config.input)
  assertRuntimeOutputPaths(input.outputRoot, input.reportPath, input.catalogDbPath)
  return runStrategyDataSplit(input)
}

function assertRuntimeOutputPaths(...paths: Array<string | undefined>): void {
  for (const path of paths) {
    if (path) assertProjectRuntimePath(path)
  }
}

function printHelp(): void {
  console.log(`Usage:
  bun src/scripts/main.ts --json '{"timeframe":"4h","output_root":"tmp/panels/example","datasets":[{"dataset_id":"BTC","manifest_path":"data/ohlcv/BTCUSDT/manifest.json"}]}'
`)
}

if (import.meta.main) {
  main(process.argv.slice(2))
}
