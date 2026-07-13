#!/usr/bin/env bun

import { buildObserveEvent, type ObserveInput } from "../lib/observe-builder"

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
  try {
    const config = parseArgs(argv)
    return successResponse(buildObserveEvent(config.input as unknown as ObserveInput))
  } catch (error) {
    return errorResponse(error)
  }
}

function parseArgs(argv: string[]): Config {
  const config: Config = { input: {} }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case "--build-observe": break
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

function readJson(raw: string): JSONRecord {
  const parsed = JSON.parse(raw)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("input JSON must be an object")
  return parsed as JSONRecord
}

function successResponse(data: unknown): JSONRecord {
  return { ok: true, schema_version: "observe-builder.script-response.v1", data }
}

function errorResponse(error: unknown): JSONRecord {
  const message = error instanceof Error ? error.message : String(error)
  return { ok: false, schema_version: "observe-builder.script-response.v1", error: message }
}

function printHelp(): void {
  console.log(`Usage:
  bun src/scripts/main.ts --build-observe --json '{...}'
`)
}

if (import.meta.main) {
  main(process.argv.slice(2))
}
