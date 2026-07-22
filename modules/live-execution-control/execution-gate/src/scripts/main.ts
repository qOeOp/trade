#!/usr/bin/env bun

import { evaluateTriggerCondition } from "../lib/execution-gate"
import { errorResponse, printScriptResult, readJsonObjectFlag, successResponse } from "../../../../contracts/runtime-core/src/script-json"

type JSONRecord = Record<string, unknown>

function main(argv: string[]): void {
  const result = run(argv)
  printScriptResult(result)
}

export function run(argv: string[]): JSONRecord {
  try {
    const input = parseArgs(argv)
    return successResponse("execution-gate.result.v1", evaluateTriggerCondition(input))
  } catch (error) {
    return errorResponse("execution-gate.result.v1", error)
  }
}

function parseArgs(argv: string[]): JSONRecord {
  return readJsonObjectFlag(argv, printHelp)
}

function printHelp(): void {
  console.log("Usage: bun src/scripts/main.ts --json '<execution gate payload>'")
}

if (import.meta.main) main(process.argv.slice(2))
