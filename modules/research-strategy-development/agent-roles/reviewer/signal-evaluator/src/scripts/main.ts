#!/usr/bin/env bun

import { repoRoot } from "../../../../../../contracts/runtime-core/src/paths"
import { errorResponse, printScriptResult, readFlagValue, readJsonObject, readJsonObjectFile, successResponse } from "../../../../../../contracts/runtime-core/src/script-json"
import type { JSONRecord } from "../../../../../../contracts/runtime-core/src/json"
import { candidateFromStrategyContract } from "../../../../../../contracts/strategy-contract/src/strategy-contract"
import { evaluateStrategySignal, strategySignalInputFromJson } from "../../../../developer/signal-engine/src/lib/strategy-signal"

interface Config {
  strategyPath: string
  input: JSONRecord
}

const SCHEMA_VERSION = "signal-evaluator.script-response.v1"

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
  const parsed = strategySignalInputFromJson(config.input)
  const input = config.strategyPath && !config.input.candidate
    ? { ...parsed, candidate: candidateFromStrategyContract(config.strategyPath, signalCandidateOverrides(config.input)) }
    : parsed
  return evaluateStrategySignal(input)
}

function parseArgs(argv: string[]): Config {
  const config: Config = { strategyPath: "", input: {} }
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

function signalCandidateOverrides(input: JSONRecord): JSONRecord {
  const overrides = asRecord(input.candidate_param_overrides)
  for (const key of ["benchmark_manifest_path", "benchmark_timeframe"]) {
    const value = stringField(input[key])
    if (value) overrides[key] = value
  }
  return overrides
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function printHelp(): void {
  console.log(`Usage:
  bun src/scripts/main.ts --json '{"manifest_path":"...","entry_price":65000,"candidate":{"candidate_id":"C-1"}}'
  bun src/scripts/main.ts --strategy strategies/example.md --json '{"manifest_path":"...","entry_price":65000}'
`)
}

function exitWithHelp(): never {
  printHelp()
  process.exit(0)
}

if (import.meta.main) {
  main(process.argv.slice(2))
}
