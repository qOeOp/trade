#!/usr/bin/env bun

import { assertProjectRuntimePath, repoRoot } from "../../../../../contracts/runtime-core/src/paths"
import { errorResponse, printScriptResult, readFlagValue, readJsonObject, readJsonObjectFile, successResponse } from "../../../../../contracts/runtime-core/src/script-json"
import type { JSONRecord } from "../../../../../contracts/runtime-core/src/json"
import { runRdProgramStateCommand } from "../lib/rd-program-state"

interface Config {
  dbPath: string
  programId: string
  input: JSONRecord
}

const SCHEMA_VERSION = "rd-program-state.script-response.v1"

function main(argv: string[]): void {
  printScriptResult(run(argv))
}

export function run(argv: string[]): JSONRecord {
  const previousCwd = process.cwd()
  try {
    process.chdir(repoRoot())
    const config = parseArgs(argv)
    assertRuntimeOutputPaths(config.dbPath)
    return successResponse(SCHEMA_VERSION, runRdProgramStateCommand({ dbPath: config.dbPath, programId: config.programId, input: config.input }))
  } catch (error) {
    return errorResponse(SCHEMA_VERSION, error)
  } finally {
    process.chdir(previousCwd)
  }
}

function parseArgs(argv: string[]): Config {
  const config: Config = { dbPath: "./data/rd_state.db", programId: "rd-program", input: {} }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case "--db":
        config.dbPath = readFlagValue(argv, ++index, arg)
        break
      case "--program-id":
        config.programId = readFlagValue(argv, ++index, arg)
        break
      case "--input":
        config.input = readJsonObjectFile(readFlagValue(argv, ++index, arg))
        break
      case "--json":
        config.input = readJsonObject(readFlagValue(argv, ++index, arg))
        break
      case "--help":
        return exitWithHelp()
      default:
        throw new Error(`unknown flag: ${arg}`)
    }
  }
  return config
}

function assertRuntimeOutputPaths(...paths: string[]): void {
  for (const path of paths) {
    if (path) assertProjectRuntimePath(path)
  }
}

function printHelp(): void {
  console.log(`Usage:
  bun src/scripts/main.ts --db ./data/rd_state.db --program-id rd-program --json '{"action":"plan_next"}'
  bun src/scripts/main.ts --db ./data/rd_state.db --program-id rd-program --json '{"action":"queue_proposal","expected_updated_at":"...","now":"...","proposal":{}}'
`)
}

function exitWithHelp(): never {
  printHelp()
  process.exit(0)
}

if (import.meta.main) {
  main(process.argv.slice(2))
}
