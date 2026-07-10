#!/usr/bin/env bun

import { readFileSync } from "node:fs"
import { runArtifactGc } from "../lib/artifact-hygiene"
import {
  initDataCatalog,
  listStaleCatalogArtifacts,
  queryDataCatalog,
  scanDataCatalog,
} from "../lib/data-catalog"
import { assertProjectRuntimePath, repoRoot } from "../lib/paths"

type JSONRecord = Record<string, unknown>

interface Config {
  catalogInit: boolean
  catalogScan: boolean
  catalogQuery: boolean
  catalogStale: boolean
  catalogGc: boolean
  artifactGc: boolean
  yes: boolean
  catalogDbPath: string
  catalogRoots: string[]
  artifactRoot: string
  retentionHours?: number
  ephemeralRetentionHours?: number
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
  if (config.catalogInit) return initDataCatalog(config.catalogDbPath)
  if (config.catalogScan) {
    return scanDataCatalog({
      catalogDbPath: config.catalogDbPath,
      roots: catalogRoots(config),
    })
  }
  if (config.catalogQuery) {
    return queryDataCatalog({
      catalogDbPath: config.catalogDbPath,
      path: stringField(config.input.path),
      artifactID: stringField(config.input.artifact_id),
      symbol: stringField(config.input.symbol),
      strategyID: stringField(config.input.strategy_id),
      reportKind: stringField(config.input.report_kind),
      limit: numberField(config.input.limit),
    })
  }
  if (config.catalogStale || config.catalogGc) {
    return listStaleCatalogArtifacts({
      catalogDbPath: config.catalogDbPath,
      roots: catalogRoots(config),
      retentionHours: config.retentionHours ?? numberField(config.input.retention_hours),
      ephemeralRetentionHours: config.ephemeralRetentionHours ?? numberField(config.input.ephemeral_retention_hours),
      now: stringField(config.input.now),
      limit: numberField(config.input.limit),
      yes: config.catalogGc ? config.yes : false,
    })
  }
  if (config.artifactGc) {
    if (!config.artifactRoot) throw new Error("--artifact-gc requires --artifact-root")
    return runArtifactGc({
      root: config.artifactRoot,
      retentionHours: config.retentionHours,
      ephemeralRetentionHours: config.ephemeralRetentionHours,
      yes: config.yes,
      referencedPaths: readStringArray(config.input.referenced_paths),
      now: stringField(config.input.now) || undefined,
    })
  }
  throw new Error("provide an artifact catalog command flag")
}

function parseArgs(argv: string[]): Config {
  const config: Config = {
    catalogInit: false,
    catalogScan: false,
    catalogQuery: false,
    catalogStale: false,
    catalogGc: false,
    artifactGc: false,
    yes: false,
    catalogDbPath: "./data/data_catalog.db",
    catalogRoots: [],
    artifactRoot: "",
    input: {},
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case "--catalog-init": config.catalogInit = true; break
      case "--catalog-scan": config.catalogScan = true; break
      case "--catalog-query": config.catalogQuery = true; break
      case "--catalog-stale": config.catalogStale = true; break
      case "--catalog-gc": config.catalogGc = true; break
      case "--artifact-gc": config.artifactGc = true; break
      case "--yes": config.yes = true; break
      case "--catalog-db": config.catalogDbPath = readValue(argv, ++index, arg); break
      case "--catalog-root": config.catalogRoots.push(readValue(argv, ++index, arg)); break
      case "--artifact-root": config.artifactRoot = readValue(argv, ++index, arg); break
      case "--retention-hours": config.retentionHours = Number(readValue(argv, ++index, arg)); break
      case "--ephemeral-retention-hours": config.ephemeralRetentionHours = Number(readValue(argv, ++index, arg)); break
      case "--input": config.input = readJsonFile(readValue(argv, ++index, arg)); break
      case "--json": config.input = readJson(readValue(argv, ++index, arg)); break
      case "--help": printHelp(); process.exit(0)
      default: throw new Error(`unknown flag: ${arg}`)
    }
  }
  return config
}

function catalogRoots(config: Config): string[] {
  const roots = config.catalogRoots.length > 0 ? config.catalogRoots : readStringArray(config.input.roots)
  const resolved = roots.length > 0 ? roots : ["./data"]
  for (const root of resolved) assertProjectRuntimePath(root)
  return resolved
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

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : []
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

function numberField(value: unknown): number | undefined {
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function successResponse(data: unknown): JSONRecord {
  return { ok: true, schema_version: "artifact-catalog.script-response.v1", data }
}

function errorResponse(error: unknown): JSONRecord {
  const message = error instanceof Error ? error.message : String(error)
  return { ok: false, schema_version: "artifact-catalog.script-response.v1", error: message }
}

function printHelp(): void {
  console.log(`Usage:
  bun src/scripts/main.ts --catalog-init --catalog-db ./data/data_catalog.db
  bun src/scripts/main.ts --catalog-scan --catalog-root ./data --catalog-root ./tmp
  bun src/scripts/main.ts --catalog-query --json '{"symbol":"BTCUSDT"}'
  bun src/scripts/main.ts --catalog-stale --catalog-root ./tmp
  bun src/scripts/main.ts --catalog-gc --catalog-root ./tmp --yes
  bun src/scripts/main.ts --artifact-gc --artifact-root ./tmp/artifacts
`)
}

if (import.meta.main) {
  main(process.argv.slice(2))
}
