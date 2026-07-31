#!/usr/bin/env bun

import { repoRoot } from "../../../../contracts/runtime-core/src/paths"
import { errorResponse, printScriptResult, readFlagValue, readJsonObject, successResponse } from "../../../../contracts/runtime-core/src/script-json"
import { observeFromTools } from "../lib/observe-runner"

type JSONRecord = Record<string, unknown>

interface Config {
  input: JSONRecord
}

function main(argv: string[]): void {
  run(argv).then((result) => {
    printScriptResult(result)
  })
}

export async function run(argv: string[]): Promise<JSONRecord> {
  const previousCwd = process.cwd()
  try {
    process.chdir(repoRoot())
    const config = parseArgs(argv)
    return successResponse("observe-runner.script-response.v1", await observeFromTools(config.input))
  } catch (error) {
    return errorResponse("observe-runner.script-response.v1", error)
  } finally {
    process.chdir(previousCwd)
  }
}

function parseArgs(argv: string[]): Config {
  const config: Config = { input: {} }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case "--observe-from-tools": break
      case "--json": config.input = readJsonObject(readFlagValue(argv, ++index, arg)); break
      case "--help": printHelp(); return process.exit(0)
      default: throw new Error(`unknown flag: ${arg}`)
    }
  }
  return config
}

function printHelp(): void {
  console.log(`Usage:
  bun src/scripts/main.ts --observe-from-tools --json '{"symbol":"BTCUSDT","side":"long"}'
`)
}

if (import.meta.main) {
  main(process.argv.slice(2))
}
