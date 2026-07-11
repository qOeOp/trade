#!/usr/bin/env bun

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { defaultCatalogDbPathForGeneratedPath, registerCatalogArtifact } from "../../../../contracts/catalog-contract/src/catalog-client"
import { assertProjectRuntimePath, repoRoot } from "../../../../contracts/runtime-core/src/paths"
import {
  createRdShadowTrackerFromForwardHoldout,
  manifestRefsFromJson,
  readJsonFile as readTrackerJsonFile,
  updateRdShadowTracker,
  type RdShadowTrackerOptions,
} from "../lib/rd-shadow-tracker"

type JSONRecord = Record<string, unknown>

interface Config {
  forwardResultPath: string
  manifestMapPath: string
  outputPath: string
  now: string
  maxHoldBars?: number
  statePath: string
  catalogDbPath: string
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
    assertRuntimeOutputPaths(config.outputPath, config.catalogDbPath)
    return successResponse(runRdShadowTracker(config))
  } catch (error) {
    return errorResponse(error)
  } finally {
    process.chdir(previousCwd)
  }
}

function parseArgs(argv: string[]): Config {
  const config: Config = {
    forwardResultPath: "",
    manifestMapPath: "",
    outputPath: "",
    now: "",
    statePath: "",
    catalogDbPath: "./data/data_catalog.db",
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case "--max-hold-bars": config.maxHoldBars = Number(readValue(argv, ++index, arg)); break
      case "--state": config.statePath = readValue(argv, ++index, arg); break
      case "--forward-result": config.forwardResultPath = readValue(argv, ++index, arg); break
      case "--manifest-map": config.manifestMapPath = readValue(argv, ++index, arg); break
      case "--output": config.outputPath = readValue(argv, ++index, arg); break
      case "--catalog-db": config.catalogDbPath = readValue(argv, ++index, arg); break
      case "--now": config.now = readValue(argv, ++index, arg); break
      case "--help": printHelp(); process.exit(0)
      default: throw new Error(`unknown flag: ${arg}`)
    }
  }
  return config
}

function runRdShadowTracker(config: Config): unknown {
  if (!config.forwardResultPath && !config.statePath) {
    throw new Error("rd-shadow-tracker requires --forward-result or --state")
  }
  const options: RdShadowTrackerOptions = {
    now: config.now || undefined,
    sourceRef: config.forwardResultPath || undefined,
    maxHoldBars: config.maxHoldBars,
    forwardReport: config.statePath && config.forwardResultPath ? readTrackerJsonFile(config.forwardResultPath) : undefined,
    manifestRefs: config.manifestMapPath ? manifestRefsFromJson(readTrackerJsonFile(config.manifestMapPath)) : undefined,
  }
  const state = config.statePath
    ? updateRdShadowTracker(readTrackerJsonFile(config.statePath), options)
    : createRdShadowTrackerFromForwardHoldout(readTrackerJsonFile(config.forwardResultPath), options)
  if (!config.outputPath) {
    return state
  }
  mkdirSync(dirname(config.outputPath), { recursive: true })
  writeFileSync(config.outputPath, `${JSON.stringify({ ok: true, data: state }, null, 2)}\n`)
  const catalogDbPath = config.catalogDbPath || defaultCatalogDbPathForGeneratedPath(config.outputPath)
  registerCatalogArtifact({
    catalogDbPath,
    path: config.outputPath,
    now: state.updated_at,
    referrerType: "run",
    referrerID: state.tracker_id,
    role: "output",
  })
  return {
    ...state,
    output_ref: config.outputPath,
    catalog_db_path: catalogDbPath,
  }
}

function assertRuntimeOutputPaths(...paths: string[]): void {
  for (const path of paths) {
    if (path) assertProjectRuntimePath(path)
  }
}

function readValue(argv: string[], index: number, name: string): string {
  const value = argv[index]
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`)
  return value
}

function successResponse(data: unknown): JSONRecord {
  return { ok: true, schema_version: "rd-shadow-tracker.script-response.v1", data }
}

function errorResponse(error: unknown): JSONRecord {
  const message = error instanceof Error ? error.message : String(error)
  return { ok: false, schema_version: "rd-shadow-tracker.script-response.v1", error: message }
}

function printHelp(): void {
  console.log(`Usage:
  bun src/scripts/main.ts --forward-result ./tmp/forward.json --output ./tmp/artifacts/strategy-rnd/shadow.json
  bun src/scripts/main.ts --state ./tmp/artifacts/strategy-rnd/shadow.json --manifest-map ./tmp/manifest-map.json --output ./tmp/artifacts/strategy-rnd/shadow-updated.json
`)
}

if (import.meta.main) {
  main(process.argv.slice(2))
}
