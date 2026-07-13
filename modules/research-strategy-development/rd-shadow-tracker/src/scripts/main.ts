#!/usr/bin/env bun

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { defaultCatalogDbPathForGeneratedPath, registerCatalogArtifact } from "../../../../contracts/catalog-contract/src/catalog-client"
import { buildDomainJobResult, validateDomainJobResult } from "../../../../contracts/domain-runtime/src/domain-runtime"
import { assertProjectRuntimePath, repoRoot } from "../../../../contracts/runtime-core/src/paths"
import { errorResponse, printScriptResult, readFlagValue, successResponse } from "../../../../contracts/runtime-core/src/script-json"
import type { JSONRecord } from "../../../../contracts/runtime-core/src/json"
import {
  createRdShadowTrackerFromForwardHoldout,
  manifestRefsFromJson,
  readJsonFile as readTrackerJsonFile,
  updateRdShadowTracker,
  type RdShadowTrackerOptions,
} from "../lib/rd-shadow-tracker"

interface Config {
  forwardResultPath: string
  manifestMapPath: string
  outputPath: string
  now: string
  maxHoldBars?: number
  statePath: string
  catalogDbPath: string
  shadowTrackerJob: boolean
  jsonPayload: string
}

interface ShadowTrackerJobInput {
  cycle_id?: string
  ticket_no?: string
  job_id?: string
  idempotency_key?: string
  now?: string
  catalog_db_path?: string
  trackers?: JSONRecord[]
}

const SCHEMA_VERSION = "rd-shadow-tracker.script-response.v1"

function main(argv: string[]): void {
  printScriptResult(run(argv))
}

export function run(argv: string[]): JSONRecord {
  const previousCwd = process.cwd()
  try {
    process.chdir(repoRoot())
    const config = parseArgs(argv)
    assertRuntimeOutputPaths(config.outputPath, config.catalogDbPath)
    return successResponse(SCHEMA_VERSION, runRdShadowTracker(config))
  } catch (error) {
    return errorResponse(SCHEMA_VERSION, error)
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
    shadowTrackerJob: false,
    jsonPayload: "",
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case "--max-hold-bars":
        config.maxHoldBars = Number(readFlagValue(argv, ++index, arg))
        break
      case "--state":
        config.statePath = readFlagValue(argv, ++index, arg)
        break
      case "--forward-result":
        config.forwardResultPath = readFlagValue(argv, ++index, arg)
        break
      case "--manifest-map":
        config.manifestMapPath = readFlagValue(argv, ++index, arg)
        break
      case "--output":
        config.outputPath = readFlagValue(argv, ++index, arg)
        break
      case "--catalog-db":
        config.catalogDbPath = readFlagValue(argv, ++index, arg)
        break
      case "--now":
        config.now = readFlagValue(argv, ++index, arg)
        break
      case "--shadow-tracker-job":
        config.shadowTrackerJob = true
        break
      case "--json":
        config.jsonPayload = readFlagValue(argv, ++index, arg)
        break
      case "--help":
        exitWithHelp()
      default:
        throw new Error(`unknown flag: ${arg}`)
    }
  }
  return config
}

function runRdShadowTracker(config: Config): unknown {
  if (config.shadowTrackerJob) {
    return runRdShadowTrackerJob(parseJsonPayload(config.jsonPayload), config)
  }
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

function runRdShadowTrackerJob(input: ShadowTrackerJobInput, config: Config): JSONRecord {
  const cycleId = input.cycle_id || "manual-cycle"
  const ticketNo = input.ticket_no || "J05"
  const jobId = input.job_id || "rd_forward_shadow_trackers"
  const idempotencyKey = input.idempotency_key || `${cycleId}:${ticketNo}`
  const now = input.now || config.now || new Date().toISOString()
  const catalogDbPath = input.catalog_db_path || config.catalogDbPath
  const trackers = Array.isArray(input.trackers) ? input.trackers.map(asRecord) : []
  const results: JSONRecord[] = []
  const inputRefs: string[] = []
  const outputRefs: string[] = []
  let runnableCount = 0

  for (const tracker of trackers) {
    const trackerId = stringField(tracker.tracker_id) || `tracker-${results.length + 1}`
    const forwardResultPath = stringField(tracker.forward_result_path)
    const statePath = stringField(tracker.state_path)
    const manifestMapPath = stringField(tracker.manifest_map_path)
    const artifactScope = stringField(tracker.artifact_scope) || "./tmp/artifacts/strategy-rnd"
    const outputPath = stringField(tracker.output_path) || `${artifactScope.replace(/\/$/, "")}/${trackerId}.shadow-tracker.json`
    assertRuntimeOutputPaths(outputPath, catalogDbPath)
    inputRefs.push(`rd-shadow-tracker:${trackerId}`)
    if (forwardResultPath) inputRefs.push(`artifact:${forwardResultPath}`)
    if (statePath) inputRefs.push(`artifact:${statePath}`)

    if (!forwardResultPath && !statePath) {
      results.push({
        tracker_id: trackerId,
        status: "skipped",
        reason: "tracker has no forward_result_path or state_path",
      })
      continue
    }

    runnableCount += 1
    const data = runRdShadowTracker({
      forwardResultPath,
      statePath,
      manifestMapPath,
      outputPath,
      now,
      maxHoldBars: positiveNumber(tracker.max_hold_bars),
      catalogDbPath,
      shadowTrackerJob: false,
      jsonPayload: "",
    }) as JSONRecord
    const outputRef = stringField(data.output_ref) || outputPath
    outputRefs.push(outputRef)
    results.push({
      tracker_id: trackerId,
      status: "ok",
      output_ref: outputRef,
      catalog_db_path: stringField(data.catalog_db_path) || catalogDbPath,
      summary: asRecord(data.summary),
    })
  }

  const status = trackers.length === 0 || runnableCount === 0 ? "skipped" : "ok"
  const runtimeResult = buildDomainJobResult({
    domain: "research-strategy-development",
    job_id: jobId,
    idempotency_key: idempotencyKey,
    status,
    input_refs: inputRefs,
    output_refs: outputRefs,
    writes: outputRefs.length > 0 ? { artifact_catalog: true } : {},
    incidents: [],
    audit: {
      cycle_id: cycleId,
      ticket_no: ticketNo,
      tracker_count: trackers.length,
      runnable_count: runnableCount,
      output_count: outputRefs.length,
      skipped_count: results.filter((result) => stringField(result.status) === "skipped").length,
    },
  })
  validateDomainJobResult(runtimeResult, ["artifact_catalog"])
  return {
    trackers: results,
    runtime_result: runtimeResult,
  }
}

function parseJsonPayload(value: string): ShadowTrackerJobInput {
  if (!value) {
    throw new Error("--shadow-tracker-job requires --json payload")
  }
  return asRecord(JSON.parse(value)) as ShadowTrackerJobInput
}

function assertRuntimeOutputPaths(...paths: string[]): void {
  for (const path of paths) {
    if (path) assertProjectRuntimePath(path)
  }
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function positiveNumber(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number(value)
  return Number.isFinite(number) && number > 0 ? number : undefined
}

function printHelp(): void {
  console.log(`Usage:
  bun src/scripts/main.ts --forward-result ./tmp/forward.json --output ./tmp/artifacts/strategy-rnd/shadow.json
  bun src/scripts/main.ts --state ./tmp/artifacts/strategy-rnd/shadow.json --manifest-map ./tmp/manifest-map.json --output ./tmp/artifacts/strategy-rnd/shadow-updated.json
`)
}

function exitWithHelp(): never {
  printHelp()
  process.exit(0)
}

if (import.meta.main) {
  main(process.argv.slice(2))
}
