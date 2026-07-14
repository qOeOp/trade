#!/usr/bin/env bun

import { repoRoot } from "../../../../../../contracts/runtime-core/src/paths"
import { errorResponse, printScriptResult, readFlagValue, readJsonObject, readJsonObjectFile, successResponse } from "../../../../../../contracts/runtime-core/src/script-json"
import type { JSONRecord } from "../../../../../../contracts/runtime-core/src/json"
import { compileStrategyContract } from "../../../../../../contracts/strategy-contract/src/strategy-contract"

interface Config {
  strategyPath: string
  input: JSONRecord
}

const SCHEMA_VERSION = "strategy-contract-compile.script-response.v1"

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
  if (!config.strategyPath) throw new Error("strategy-contract-compile requires --strategy")
  return compileStrategyContract(config.strategyPath, asRecord(config.input.candidate_param_overrides))
}

function parseArgs(argv: string[]): Config {
  const config: Config = {
    strategyPath: "",
    input: {},
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case "--strategy":
        config.strategyPath = readFlagValue(argv, ++index, arg)
        break
      case "--input":
        config.input = readJsonObjectFile(readFlagValue(argv, ++index, arg))
        break
      case "--json":
        config.input = readJsonObject(readFlagValue(argv, ++index, arg))
        break
      case "--help":
        exitWithHelp()
      default:
        throw new Error(`unknown flag: ${arg}`)
    }
  }
  return config
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

function printHelp(): void {
  console.log(`Usage:
  bun src/scripts/main.ts --strategy strategies/S-EXAMPLE.md
  bun src/scripts/main.ts --strategy strategies/S-EXAMPLE.md --json '{"candidate_param_overrides":{"benchmark_manifest_path":"tmp/panels/btc/manifest.json"}}'
`)
}

function exitWithHelp(): never {
  printHelp()
  process.exit(0)
}

if (import.meta.main) {
  main(process.argv.slice(2))
}
