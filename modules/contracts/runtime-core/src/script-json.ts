import { readFileSync } from "node:fs"
import { asRecord, type JSONRecord } from "./json"

export interface JsonInputArgs {
  input: JSONRecord
}

export interface DbActionJsonArgs {
  dbPath: string
  action: string
  json: JSONRecord
}

export interface DbJsonArgs {
  dbPath: string
  json: JSONRecord
}

export function printScriptResult(result: JSONRecord): void {
  console.log(JSON.stringify(result, null, 2))
  if (!result.ok) process.exit(1)
}

export function successResponse(schemaVersion: string, data: unknown): JSONRecord {
  return { ok: true, schema_version: schemaVersion, data }
}

export function errorResponse(schemaVersion: string, error: unknown): JSONRecord {
  return { ok: false, schema_version: schemaVersion, error: error instanceof Error ? error.message : String(error) }
}

export function readJsonObjectFlag(argv: string[], printHelp: () => void): JSONRecord {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--json") return readJsonObject(readFlagValue(argv, ++index, arg))
    if (arg === "--help") {
      printHelp()
      return process.exit(0)
    }
    throw new Error(`unknown flag: ${arg}`)
  }
  return {}
}

export function readJsonInputArgs(argv: string[], printHelp: () => void): JsonInputArgs {
  const config: JsonInputArgs = { input: {} }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case "--input": config.input = readJsonObjectFile(readFlagValue(argv, ++index, arg)); break
      case "--json": config.input = readJsonObject(readFlagValue(argv, ++index, arg)); break
      case "--help": printHelp(); return process.exit(0)
      default: throw new Error(`unknown flag: ${arg}`)
    }
  }
  return config
}

export function readDbActionJsonArgs(
  argv: string[],
  defaults: { dbPath: string; action?: string },
  printHelp: () => void,
): DbActionJsonArgs {
  const config: DbActionJsonArgs = { dbPath: defaults.dbPath, action: defaults.action ?? "init", json: {} }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case "--db": config.dbPath = readFlagValue(argv, ++index, arg); break
      case "--action": config.action = readFlagValue(argv, ++index, arg); break
      case "--json": config.json = readJsonObject(readFlagValue(argv, ++index, arg)); break
      case "--json-file": config.json = readJsonObjectFile(readFlagValue(argv, ++index, arg)); break
      case "--help": printHelp(); return process.exit(0)
      default: throw new Error(`unknown argument: ${arg}`)
    }
  }
  return config
}

export function readDbJsonArgs(argv: string[], defaultDbPath: string, printHelp: () => void): DbJsonArgs {
  const config: DbJsonArgs = { dbPath: defaultDbPath, json: {} }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case "--db": config.dbPath = readFlagValue(argv, ++index, arg); break
      case "--json": config.json = readJsonObject(readFlagValue(argv, ++index, arg)); break
      case "--json-file": config.json = readJsonObjectFile(readFlagValue(argv, ++index, arg)); break
      case "--help": printHelp(); return process.exit(0)
      default: throw new Error(`unknown argument: ${arg}`)
    }
  }
  return config
}

export function readFlagValue(argv: string[], index: number, name: string): string {
  const value = argv[index]
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`)
  return value
}

export function readJsonObject(raw: string): JSONRecord {
  const parsed = JSON.parse(raw)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("input JSON must be an object")
  return asRecord(parsed)
}

export function readJsonObjectFile(path: string): JSONRecord {
  return readJsonObject(readFileSync(path, "utf8"))
}
