#!/usr/bin/env bun

import { buildExecutionCommandSpec } from "../lib/execution-router"
import { errorResponse, printScriptResult, readJsonObjectFlag, successResponse } from "../../../../contracts/runtime-core/src/script-json"

type JSONRecord = Record<string, unknown>

function main(argv: string[]): void {
  const result = run(argv)
  printScriptResult(result)
}

export function run(argv: string[]): JSONRecord {
  try {
    const input = parseArgs(argv)
    return successResponse("execution-router.result.v1", buildExecutionCommandSpec(input))
  } catch (error) {
    return errorResponse("execution-router.result.v1", error)
  }
}

function parseArgs(argv: string[]): JSONRecord {
  return readJsonObjectFlag(argv, printHelp)
}

function printHelp(): void {
  console.log("Usage: bun src/scripts/main.ts --json '<execution routing payload>'")
}

if (import.meta.main) main(process.argv.slice(2))
