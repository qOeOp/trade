#!/usr/bin/env bun

import { readFileSync } from "node:fs"
import { runArtifactGc } from "../lib/artifact-hygiene"
import { runCatalogHygieneJob } from "../lib/catalog-hygiene-job"
import {
  initDataCatalog,
  listCatalogStrategyEvidence,
  listCatalogStrategyRndRuns,
  listStaleCatalogArtifacts,
  queryDataCatalog,
  readCatalogArtifact,
  registerCatalogArtifact,
  scanDataCatalog,
  upsertCatalogStrategyEvidence,
  upsertCatalogStrategyRndRun,
} from "../lib/data-catalog"
import { assertProjectRuntimePath, repoRoot } from "../../../../contracts/runtime-core/src/paths"

type JSONRecord = Record<string, unknown>

interface Config {
  catalogInit: boolean
  catalogHygieneJob: boolean
  catalogScan: boolean
  catalogQuery: boolean
  catalogReadArtifact: boolean
  catalogRegisterArtifact: boolean
  catalogUpsertStrategyEvidence: boolean
  catalogListStrategyEvidence: boolean
  catalogUpsertStrategyRndRun: boolean
  catalogListStrategyRndRuns: boolean
  catalogStale: boolean
  catalogGc: boolean
  artifactGc: boolean
  yes: boolean
  environmentId: string
  migrateIdentity: boolean
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
  if (config.catalogInit) return initDataCatalog(config.catalogDbPath, config.environmentId, config.migrateIdentity)
  if (config.catalogHygieneJob) {
    return runCatalogHygieneJob({
      cycle_id: requiredString(config.input.cycle_id, "cycle_id"),
      ticket_no: stringField(config.input.ticket_no),
      job_id: stringField(config.input.job_id),
      idempotency_key: stringField(config.input.idempotency_key),
      catalog_db_path: stringField(config.input.catalog_db_path ?? config.input.catalogDbPath) || config.catalogDbPath,
      environment_id: config.environmentId,
      roots: catalogRoots(config),
      now: stringField(config.input.now),
    })
  }
  if (config.catalogScan) {
    return scanDataCatalog({
      catalogDbPath: config.catalogDbPath,
      environmentId: config.environmentId,
      roots: catalogRoots(config),
    })
  }
  if (config.catalogQuery) {
    return queryDataCatalog({
      catalogDbPath: config.catalogDbPath,
      environmentId: config.environmentId,
      path: stringField(config.input.path),
      artifactID: stringField(config.input.artifact_id),
      symbol: stringField(config.input.symbol),
      strategyID: stringField(config.input.strategy_id),
      reportKind: stringField(config.input.report_kind),
      limit: numberField(config.input.limit),
    })
  }
  if (config.catalogReadArtifact) {
    return readCatalogArtifact({
      catalogDbPath: config.catalogDbPath,
      environmentId: config.environmentId,
      artifactID: requiredString(config.input.artifact_id, "artifact_id"),
      maxBytes: numberField(config.input.max_bytes),
    })
  }
  if (config.catalogRegisterArtifact) {
    return registerCatalogArtifact({
      catalogDbPath: optionalCatalogDbPath(config),
      environmentId: config.environmentId,
      path: requiredString(config.input.path, "path"),
      now: stringField(config.input.now),
      maxHashBytes: numberField(config.input.max_hash_bytes ?? config.input.maxHashBytes),
      referrerType: stringField(config.input.referrer_type ?? config.input.referrerType),
      referrerID: stringField(config.input.referrer_id ?? config.input.referrerID),
      role: stringField(config.input.role),
    })
  }
  if (config.catalogUpsertStrategyEvidence) {
    return upsertCatalogStrategyEvidence({
      catalogDbPath: requiredCatalogDbPath(config),
      environmentId: config.environmentId,
      record: recordField(config.input.record),
      now: stringField(config.input.now),
    })
  }
  if (config.catalogListStrategyEvidence) {
    return listCatalogStrategyEvidence({
      catalogDbPath: requiredCatalogDbPath(config),
      environmentId: config.environmentId,
      strategyID: stringField(config.input.strategy_id ?? config.input.strategyID),
      limit: numberField(config.input.limit),
    })
  }
  if (config.catalogUpsertStrategyRndRun) {
    return upsertCatalogStrategyRndRun({
      catalogDbPath: requiredCatalogDbPath(config),
      environmentId: config.environmentId,
      record: recordField(config.input.record),
      now: stringField(config.input.now),
    })
  }
  if (config.catalogListStrategyRndRuns) {
    return listCatalogStrategyRndRuns({
      catalogDbPath: requiredCatalogDbPath(config),
      environmentId: config.environmentId,
      limit: numberField(config.input.limit),
    })
  }
  if (config.catalogStale || config.catalogGc) {
    return listStaleCatalogArtifacts({
      catalogDbPath: config.catalogDbPath,
      environmentId: config.environmentId,
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
  let environmentIdExplicit = false
  const config: Config = {
    catalogInit: false,
    catalogHygieneJob: false,
    catalogScan: false,
    catalogQuery: false,
    catalogReadArtifact: false,
    catalogRegisterArtifact: false,
    catalogUpsertStrategyEvidence: false,
    catalogListStrategyEvidence: false,
    catalogUpsertStrategyRndRun: false,
    catalogListStrategyRndRuns: false,
    catalogStale: false,
    catalogGc: false,
    artifactGc: false,
    yes: false,
    environmentId: "local:local",
    migrateIdentity: false,
    catalogDbPath: "./data/data_catalog.db",
    catalogRoots: [],
    artifactRoot: "",
    input: {},
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case "--catalog-init": config.catalogInit = true; break
      case "--catalog-hygiene-job": config.catalogHygieneJob = true; break
      case "--catalog-scan": config.catalogScan = true; break
      case "--catalog-query": config.catalogQuery = true; break
      case "--catalog-read-artifact": config.catalogReadArtifact = true; break
      case "--catalog-register-artifact": config.catalogRegisterArtifact = true; break
      case "--catalog-upsert-strategy-evidence": config.catalogUpsertStrategyEvidence = true; break
      case "--catalog-list-strategy-evidence": config.catalogListStrategyEvidence = true; break
      case "--catalog-upsert-strategy-rnd-run": config.catalogUpsertStrategyRndRun = true; break
      case "--catalog-list-strategy-rnd-runs": config.catalogListStrategyRndRuns = true; break
      case "--catalog-stale": config.catalogStale = true; break
      case "--catalog-gc": config.catalogGc = true; break
      case "--artifact-gc": config.artifactGc = true; break
      case "--yes": config.yes = true; break
      case "--environment-id": config.environmentId = readValue(argv, ++index, arg); environmentIdExplicit = true; break
      case "--migrate-database-identity": config.migrateIdentity = true; break
      case "--catalog-db": config.catalogDbPath = readValue(argv, ++index, arg); break
      case "--catalog-root": config.catalogRoots.push(readValue(argv, ++index, arg)); break
      case "--artifact-root": config.artifactRoot = readValue(argv, ++index, arg); break
      case "--retention-hours": config.retentionHours = Number(readValue(argv, ++index, arg)); break
      case "--ephemeral-retention-hours": config.ephemeralRetentionHours = Number(readValue(argv, ++index, arg)); break
      case "--input": config.input = readJsonFile(readValue(argv, ++index, arg)); break
      case "--json": config.input = readJson(readValue(argv, ++index, arg)); break
      case "--help": printHelp(); return process.exit(0)
      default: throw new Error(`unknown flag: ${arg}`)
    }
  }
  if (!environmentIdExplicit) {
    config.environmentId = stringField(config.input.environment_id ?? config.input.environmentId) || config.environmentId
  }
  if (config.migrateIdentity && !config.catalogInit) throw new Error("--migrate-database-identity requires --catalog-init")
  return config
}

function catalogRoots(config: Config): string[] {
  const roots = config.catalogRoots.length > 0 ? config.catalogRoots : readStringArray(config.input.roots)
  const resolved = roots.length > 0 ? roots : ["./data"]
  for (const root of resolved) assertProjectRuntimePath(root)
  return resolved
}

function optionalCatalogDbPath(config: Config): string | undefined {
  return stringField(config.input.catalog_db_path ?? config.input.catalogDbPath) || config.catalogDbPath
}

function requiredCatalogDbPath(config: Config): string {
  return optionalCatalogDbPath(config) || "./data/data_catalog.db"
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

function requiredString(value: unknown, field: string): string {
  const result = stringField(value)
  if (!result) throw new Error(`${field} is required`)
  return result
}

function recordField(value: unknown): JSONRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("record must be an object")
  }
  return value as JSONRecord
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
  bun src/scripts/main.ts --catalog-hygiene-job --catalog-root ./data --json '{"cycle_id":"cycle-1"}'
  bun src/scripts/main.ts --catalog-scan --catalog-root ./data --catalog-root ./tmp
  bun src/scripts/main.ts --catalog-query --json '{"symbol":"BTCUSDT"}'
  bun src/scripts/main.ts --catalog-read-artifact --json '{"artifact_id":"artifact_...","max_bytes":204800}'
  bun src/scripts/main.ts --catalog-register-artifact --json '{"path":"./tmp/report.json"}'
  bun src/scripts/main.ts --catalog-upsert-strategy-evidence --json '{"catalog_db_path":"./data/data_catalog.db","record":{}}'
  bun src/scripts/main.ts --catalog-list-strategy-evidence --json '{"strategy_id":"demo"}'
  bun src/scripts/main.ts --catalog-upsert-strategy-rnd-run --json '{"catalog_db_path":"./data/data_catalog.db","record":{}}'
  bun src/scripts/main.ts --catalog-list-strategy-rnd-runs --json '{"limit":100}'
  bun src/scripts/main.ts --catalog-stale --catalog-root ./tmp
  bun src/scripts/main.ts --catalog-gc --catalog-root ./tmp --yes
  bun src/scripts/main.ts --artifact-gc --artifact-root ./tmp/artifacts
`)
}

if (import.meta.main) {
  main(process.argv.slice(2))
}
