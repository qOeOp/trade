#!/usr/bin/env bun

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { assertProjectRuntimePath, repoRoot } from "../lib/paths"
import { defaultCatalogDbPathForGeneratedPath, registerCatalogArtifact } from "../lib/data-catalog"
import {
  createRdShadowTrackerFromForwardHoldout,
  manifestRefsFromJson,
  readJsonFile as readTrackerJsonFile,
  updateRdShadowTracker,
  type RdShadowTrackerOptions,
} from "../lib/rd-shadow-tracker"
import {
  runStrategyRndBatch,
  runStrategyRndCampaign,
  runStrategyRndLoop,
  strategyRndBatchInputFromJson,
  strategyRndCampaignInputFromJson,
  strategyRndLoopInputFromJson,
} from "../lib/strategy-rnd"

type JSONRecord = Record<string, unknown>

interface Config {
  strategyRndBatch: boolean
  strategyRndLoop: boolean
  strategyRndCampaign: boolean
  rdShadowTracker: boolean
  forwardResultPath: string
  manifestMapPath: string
  outputPath: string
  now: string
  maxHoldBars?: number
  statePath: string
  catalogDbPath: string
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
  if (config.strategyRndBatch) return runStrategyRndBatch(strategyRndBatchInputFromJson(config.input))
  if (config.strategyRndLoop) {
    const input = strategyRndLoopInputFromJson(config.input)
    assertRuntimeOutputPaths(input.artifactRoot, input.ledgerPath, input.catalogDbPath, input.rdProgramStatePath)
    return runStrategyRndLoop(input)
  }
  if (config.strategyRndCampaign) {
    const input = strategyRndCampaignInputFromJson(config.input)
    assertRuntimeOutputPaths(input.artifactRoot, input.ledgerPath, input.catalogDbPath, input.rdProgramStatePath)
    return runStrategyRndCampaign(input)
  }
  if (config.rdShadowTracker) return runRdShadowTracker(config)
  throw new Error("provide a strategy RD command flag")
}

function parseArgs(argv: string[]): Config {
  const config: Config = {
    strategyRndBatch: false,
    strategyRndLoop: false,
    strategyRndCampaign: false,
    rdShadowTracker: false,
    forwardResultPath: "",
    manifestMapPath: "",
    outputPath: "",
    now: "",
    statePath: "",
    catalogDbPath: "./data/data_catalog.db",
    input: {},
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case "--strategy-rnd-batch": config.strategyRndBatch = true; break
      case "--strategy-rnd-loop": config.strategyRndLoop = true; break
      case "--strategy-rnd-campaign": config.strategyRndCampaign = true; break
      case "--rd-shadow-tracker": config.rdShadowTracker = true; break
      case "--max-hold-bars": config.maxHoldBars = Number(readValue(argv, ++index, arg)); break
      case "--state": config.statePath = readValue(argv, ++index, arg); break
      case "--forward-result": config.forwardResultPath = readValue(argv, ++index, arg); break
      case "--manifest-map": config.manifestMapPath = readValue(argv, ++index, arg); break
      case "--output": config.outputPath = readValue(argv, ++index, arg); break
      case "--catalog-db": config.catalogDbPath = readValue(argv, ++index, arg); break
      case "--now": config.now = readValue(argv, ++index, arg); break
      case "--db": ++index; break
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

function assertRuntimeOutputPaths(...paths: Array<string | undefined>): void {
  for (const path of paths) {
    if (path) assertProjectRuntimePath(path)
  }
}

function runRdShadowTracker(config: Config): unknown {
  if (!config.forwardResultPath && !config.statePath) {
    throw new Error("--rd-shadow-tracker requires --forward-result or --state")
  }
  assertRuntimeOutputPaths(config.outputPath, config.catalogDbPath)
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

function successResponse(data: unknown): JSONRecord {
  return { ok: true, schema_version: "strategy-rd.script-response.v1", data }
}

function errorResponse(error: unknown): JSONRecord {
  const message = error instanceof Error ? error.message : String(error)
  return { ok: false, schema_version: "strategy-rd.script-response.v1", error: message }
}

function printHelp(): void {
  console.log(`Usage:
  bun src/scripts/main.ts --strategy-rnd-batch --json '{"manifest_path":"...","candidates":[...]}'
  bun src/scripts/main.ts --strategy-rnd-loop --json '{"manifest_path":"...","candidates":[...]}'
  bun src/scripts/main.ts --strategy-rnd-campaign --json '{"campaign_id":"...","hypotheses":[...]}'
  bun src/scripts/main.ts --rd-shadow-tracker --forward-result ./tmp/forward.json --output ./tmp/artifacts/strategy-rnd/shadow.json
`)
}

if (import.meta.main) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    console.log(JSON.stringify(errorResponse(error), null, 2))
    process.exit(1)
  }
}
