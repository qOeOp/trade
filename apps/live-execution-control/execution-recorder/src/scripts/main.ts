#!/usr/bin/env bun

import { buildRecordedActionEvents, buildRecordedExecutionEvent } from "../lib/execution-recorder"
import { errorResponse, printScriptResult, readFlagValue, readJsonObject, successResponse } from "../../../../contracts/runtime-core/src/script-json"

type JSONRecord = Record<string, unknown>

interface Config {
  mode: "record-execution" | "record-action" | ""
  input: JSONRecord
}

function main(argv: string[]): void {
  const result = run(argv)
  printScriptResult(result)
}

export function run(argv: string[]): JSONRecord {
  try {
    const config = parseArgs(argv)
    if (config.mode === "record-execution") {
      return successResponse("execution-recorder.script-response.v1", buildRecordedExecutionEvent(config.input))
    }
    if (config.mode === "record-action") {
      return successResponse("execution-recorder.script-response.v1", buildRecordedActionEvents(config.input))
    }
    throw new Error("provide --record-execution or --record-action")
  } catch (error) {
    return errorResponse("execution-recorder.script-response.v1", error)
  }
}

function parseArgs(argv: string[]): Config {
  const config: Config = { mode: "", input: {} }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case "--record-execution": config.mode = "record-execution"; break
      case "--record-action": config.mode = "record-action"; break
      case "--json": config.input = readJsonObject(readFlagValue(argv, ++index, arg)); break
      case "--help": printHelp(); return process.exit(0)
      default: throw new Error(`unknown flag: ${arg}`)
    }
  }
  return config
}

function printHelp(): void {
  console.log(`Usage:
  bun src/scripts/main.ts --record-execution --json '{...}'
`)
}

if (import.meta.main) {
  main(process.argv.slice(2))
}
