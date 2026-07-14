#!/usr/bin/env bun

import { repoRoot } from "../../../../../../contracts/runtime-core/src/paths"
import { errorResponse, printScriptResult, readJsonInputArgs, successResponse } from "../../../../../../contracts/runtime-core/src/script-json"
import type { JSONRecord } from "../../../../../../contracts/runtime-core/src/json"
import { runStrategyRndBatch } from "../../../candidate-batch-engine/src/lib/strategy-rnd-batch"
import { strategyRndBatchInputFromJson } from "../../../candidate-batch-engine/src/lib/strategy-rnd-inputs"

const SCHEMA_VERSION = "candidate-batch.script-response.v1"

function main(argv: string[]): void {
  printScriptResult(run(argv))
}

export function run(argv: string[]): JSONRecord {
  const previousCwd = process.cwd()
  try {
    process.chdir(repoRoot())
    const config = readJsonInputArgs(argv, printHelp)
    return successResponse(SCHEMA_VERSION, runStrategyRndBatch(strategyRndBatchInputFromJson(config.input)))
  } catch (error) {
    return errorResponse(SCHEMA_VERSION, error)
  } finally {
    process.chdir(previousCwd)
  }
}

function printHelp(): void {
  console.log(`Usage:
  bun src/scripts/main.ts --json '{"manifest_path":"...","candidates":[...]}'
`)
}

if (import.meta.main) {
  main(process.argv.slice(2))
}
