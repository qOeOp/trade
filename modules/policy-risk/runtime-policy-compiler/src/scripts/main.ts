#!/usr/bin/env bun

import { repoRoot } from "../../../../contracts/runtime-core/src/paths"
import { loadRuntimePolicy } from "../lib/runtime-policy"

type JSONRecord = Record<string, unknown>

interface Config {
  tradingConfigPath?: string
  accountConfigPath?: string
  notifyConfigPath?: string
  now?: string
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
    const config = parseArgs(argv)
    return successResponse(loadRuntimePolicy(config))
  } catch (error) {
    return errorResponse(error)
  } finally {
    process.chdir(previousCwd)
  }
}

function parseArgs(argv: string[]): Config {
  const config: Config = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case "--trading-config": config.tradingConfigPath = readValue(argv, ++index, arg); break
      case "--account-config": config.accountConfigPath = readValue(argv, ++index, arg); break
      case "--notify-config": config.notifyConfigPath = readValue(argv, ++index, arg); break
      case "--now": config.now = readValue(argv, ++index, arg); break
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
  return { ok: true, schema_version: "runtime-policy-compiler.script-response.v1", data }
}

function errorResponse(error: unknown): JSONRecord {
  const message = error instanceof Error ? error.message : String(error)
  return { ok: false, schema_version: "runtime-policy-compiler.script-response.v1", error: message }
}

function printHelp(): void {
  console.log(`Usage:
  bun src/scripts/main.ts --trading-config ./profile/trading-config.json --account-config ./profile/account_config.json
`)
}

if (import.meta.main) main(process.argv.slice(2))
