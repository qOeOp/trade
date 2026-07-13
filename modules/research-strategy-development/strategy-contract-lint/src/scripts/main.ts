#!/usr/bin/env bun

import { repoRoot } from "../../../../contracts/runtime-core/src/paths"
import { errorResponse, printScriptResult, readFlagValue, successResponse } from "../../../../contracts/runtime-core/src/script-json"
import type { JSONRecord } from "../../../../contracts/runtime-core/src/json"
import { lintStrategyContract } from "../../../../contracts/strategy-contract/src/strategy-contract"

interface Config {
  strategyPath: string
}

const SCHEMA_VERSION = "strategy-contract-lint.script-response.v1"

function main(argv: string[]): void {
  printScriptResult(run(argv))
}

export function run(argv: string[]): JSONRecord {
  const previousCwd = process.cwd()
  try {
    process.chdir(repoRoot())
    return successResponse(SCHEMA_VERSION, runConfig(parseArgs(argv)))
  } catch (error) {
    return errorResponse(SCHEMA_VERSION, error)
  } finally {
    process.chdir(previousCwd)
  }
}

function runConfig(config: Config): unknown {
  if (!config.strategyPath) throw new Error("strategy-contract-lint requires --strategy")
  return lintStrategyContract(config.strategyPath)
}

function parseArgs(argv: string[]): Config {
  const config: Config = {
    strategyPath: "",
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case "--strategy":
        config.strategyPath = readFlagValue(argv, ++index, arg)
        break
      case "--help":
        exitWithHelp()
      default:
        throw new Error(`unknown flag: ${arg}`)
    }
  }
  return config
}

function printHelp(): void {
  console.log(`Usage:
  bun src/scripts/main.ts --strategy strategies/S-EXAMPLE.md
`)
}

function exitWithHelp(): never {
  printHelp()
  process.exit(0)
}

if (import.meta.main) {
  main(process.argv.slice(2))
}
