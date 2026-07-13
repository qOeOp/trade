#!/usr/bin/env bun

import { evaluateTriggerCondition } from "../lib/execution-gate"

type JSONRecord = Record<string, unknown>

function main(argv: string[]): void {
  const result = run(argv)
  console.log(JSON.stringify(result, null, 2))
  if (!result.ok) process.exit(1)
}

export function run(argv: string[]): JSONRecord {
  try {
    const input = parseArgs(argv)
    return {
      ok: true,
      schema_version: "execution-gate.result.v1",
      data: evaluateTriggerCondition(input),
    }
  } catch (error) {
    return { ok: false, schema_version: "execution-gate.result.v1", error: error instanceof Error ? error.message : String(error) }
  }
}

function parseArgs(argv: string[]): JSONRecord {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--json") return readJson(readValue(argv, ++index, arg))
    if (arg === "--help") {
      printHelp()
      process.exit(0)
    }
    throw new Error(`unknown flag: ${arg}`)
  }
  return {}
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

function printHelp(): void {
  console.log("Usage: bun src/scripts/main.ts --json '<execution gate payload>'")
}

if (import.meta.main) main(process.argv.slice(2))
