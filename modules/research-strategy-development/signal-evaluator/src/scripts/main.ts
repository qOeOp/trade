#!/usr/bin/env bun

import { readFileSync } from "node:fs"
import { repoRoot } from "../../../../contracts/runtime-core/src/paths"
import { candidateFromStrategyContract } from "../../../../contracts/strategy-contract/src/strategy-contract"
import { evaluateStrategySignal, strategySignalInputFromJson } from "../../../signal-engine/src/lib/strategy-signal"

type JSONRecord = Record<string, unknown>

interface Config {
  strategyPath: string
  input: JSONRecord
}

function main(argv: string[]): void {
  const result = run(argv)
  console.log(JSON.stringify(result, null, 2))
  if (!result.ok) process.exit(1)
}

export function run(argv: string[]): JSONRecord {
  const previousCwd = process.cwd()
  try {
    process.chdir(repoRoot())
    return successResponse(runConfig(parseArgs(argv)))
  } catch (error) {
    return errorResponse(error)
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
      case "--strategy": config.strategyPath = readValue(argv, ++index, arg); break
      case "--input": config.input = readJsonFile(readValue(argv, ++index, arg)); break
      case "--json": config.input = readJson(readValue(argv, ++index, arg)); break
      case "--help": printHelp(); process.exit(0)
      default: throw new Error(`unknown flag: ${arg}`)
    }
  }
  return config
}

function readValue(argv: string[], index: number, name: string): string {
  const value = argv[index]
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`)
  return value
}

function readJsonFile(path: string): JSONRecord {
  return readJson(readFileSync(path, "utf8"))
}

function readJson(raw: string): JSONRecord {
  const parsed = JSON.parse(raw)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("input JSON must be an object")
  return parsed as JSONRecord
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

function successResponse(data: unknown): JSONRecord {
  return { ok: true, schema_version: "signal-evaluator.script-response.v1", data }
}

function errorResponse(error: unknown): JSONRecord {
  const message = error instanceof Error ? error.message : String(error)
  return { ok: false, schema_version: "signal-evaluator.script-response.v1", error: message }
}

function printHelp(): void {
  console.log(`Usage:
  bun src/scripts/main.ts --json '{"manifest_path":"...","entry_price":65000,"candidate":{"candidate_id":"C-1"}}'
  bun src/scripts/main.ts --strategy strategies/example.md --json '{"manifest_path":"...","entry_price":65000}'
`)
}

if (import.meta.main) {
  main(process.argv.slice(2))
}
