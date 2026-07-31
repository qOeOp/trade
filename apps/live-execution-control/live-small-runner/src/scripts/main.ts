#!/usr/bin/env bun

import { assertProjectRuntimePath, repoRoot } from "../../../../contracts/runtime-core/src/paths"
import { errorResponse, printScriptResult, readFlagValue, readJsonObject, successResponse } from "../../../../contracts/runtime-core/src/script-json"
import { runLiveSmall } from "../lib/live-small-runner"

type JSONRecord = Record<string, unknown>

interface Config {
  dbPath: string
  yes: boolean
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
    assertProjectRuntimePath(config.dbPath)
    return successResponse("live-small-runner.script-response.v1", await runLiveSmall(config.dbPath, config.input, config.yes))
  } catch (error) {
    return errorResponse("live-small-runner.script-response.v1", error)
  } finally {
    process.chdir(previousCwd)
  }
}

function parseArgs(argv: string[]): Config {
  const config: Config = { dbPath: "./data/trade.db", yes: false, input: {} }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case "--run-live-small": break
      case "--yes": config.yes = true; break
      case "--db": config.dbPath = readFlagValue(argv, ++index, arg); break
      case "--json": config.input = readJsonObject(readFlagValue(argv, ++index, arg)); break
      case "--help": printHelp(); return process.exit(0)
      default: throw new Error(`unknown flag: ${arg}`)
    }
  }
  return config
}

function printHelp(): void {
  console.log(`Usage:
  bun src/scripts/main.ts --run-live-small --yes --db ./data/trade.db --json '{...}'
`)
}

if (import.meta.main) {
  main(process.argv.slice(2))
}
