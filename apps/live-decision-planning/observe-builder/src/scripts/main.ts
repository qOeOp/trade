#!/usr/bin/env bun

import { buildObserveEvent, type ObserveInput } from "../lib/observe-builder"
import { errorResponse, printScriptResult, readFlagValue, readJsonObject, successResponse } from "../../../../contracts/runtime-core/src/script-json"

type JSONRecord = Record<string, unknown>

interface Config {
  input: JSONRecord
}

function main(argv: string[]): void {
  const result = run(argv)
  printScriptResult(result)
}

export function run(argv: string[]): JSONRecord {
  try {
    const config = parseArgs(argv)
    return successResponse("observe-builder.script-response.v1", buildObserveEvent(config.input as unknown as ObserveInput))
  } catch (error) {
    return errorResponse("observe-builder.script-response.v1", error)
  }
}

function parseArgs(argv: string[]): Config {
  const config: Config = { input: {} }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case "--build-observe": break
      case "--json": config.input = readJsonObject(readFlagValue(argv, ++index, arg)); break
      case "--help": printHelp(); return process.exit(0)
      default: throw new Error(`unknown flag: ${arg}`)
    }
  }
  return config
}

function printHelp(): void {
  console.log(`Usage:
  bun src/scripts/main.ts --build-observe --json '{...}'
`)
}

if (import.meta.main) {
  main(process.argv.slice(2))
}
