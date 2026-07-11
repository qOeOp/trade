#!/usr/bin/env bun

import { repoRoot } from "../../../../contracts/runtime-core/src/paths"
import { lintStrategyContract } from "../../../../contracts/strategy-contract/src/strategy-contract"

type JSONRecord = Record<string, unknown>

interface Config {
  strategyPath: string
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
      case "--strategy": config.strategyPath = readValue(argv, ++index, arg); break
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

function successResponse(data: unknown): JSONRecord {
  return { ok: true, schema_version: "strategy-contract-lint.script-response.v1", data }
}

function errorResponse(error: unknown): JSONRecord {
  const message = error instanceof Error ? error.message : String(error)
  return { ok: false, schema_version: "strategy-contract-lint.script-response.v1", error: message }
}

function printHelp(): void {
  console.log(`Usage:
  bun src/scripts/main.ts --strategy strategies/S-EXAMPLE.md
`)
}

if (import.meta.main) {
  main(process.argv.slice(2))
}
