#!/usr/bin/env bun

import { readFileSync } from "node:fs"
import { repoRoot } from "../../../../contracts/runtime-core/src/paths"
import { forwardHoldoutInputFromJson, runForwardHoldout } from "../lib/forward-holdout"

type JSONRecord = Record<string, unknown>

interface Config {
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
    const config = parseArgs(argv)
    return successResponse(runForwardHoldout(forwardHoldoutInputFromJson(config.input)))
  } catch (error) {
    return errorResponse(error)
  } finally {
    process.chdir(previousCwd)
  }
}

function parseArgs(argv: string[]): Config {
  const config: Config = { input: {} }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
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

function successResponse(data: unknown): JSONRecord {
  return { ok: true, schema_version: "forward-holdout.script-response.v1", data }
}

function errorResponse(error: unknown): JSONRecord {
  const message = error instanceof Error ? error.message : String(error)
  return { ok: false, schema_version: "forward-holdout.script-response.v1", error: message }
}

function printHelp(): void {
  console.log(`Usage:
  bun src/scripts/main.ts --json '{"strategy_id":"...","setup_id":"...","frozen_at":"...","candidate":{...},"datasets":[...]}'
`)
}

if (import.meta.main) {
  main(process.argv.slice(2))
}
