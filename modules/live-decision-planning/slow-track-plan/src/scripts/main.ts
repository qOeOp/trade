#!/usr/bin/env bun

import { dirname } from "node:path"
import { assertProjectRuntimePath, repoRoot } from "../../../../contracts/runtime-core/src/paths"
import { runSlowTrackWorkflowDryRun } from "../lib/slow-track-plan"

type JSONRecord = Record<string, unknown>

interface Config {
  dbPath: string
  input: JSONRecord
}

function main(argv: string[]): void {
  run(argv).then((result) => {
    console.log(JSON.stringify(result, null, 2))
    if (!result.ok) process.exit(1)
  })
}

export async function run(argv: string[]): Promise<JSONRecord> {
  const previousCwd = process.cwd()
  try {
    process.chdir(repoRoot())
    const config = parseArgs(argv)
    assertProjectRuntimePath(config.dbPath)
    const runId = stringField(config.input.run_id) || `slow-${Date.now()}`
    const dataDir = dirname(config.dbPath)
    const data = await runSlowTrackWorkflowDryRun({
      repoRoot: repoRoot(),
      dataDir,
      runId,
      dbPath: config.dbPath,
      candidateLimitPerSide: numberField(config.input.candidate_limit_per_side),
      symbolSnapshotLimitPerSide: numberField(config.input.symbol_snapshot_limit_per_side),
      technicalAnalysisLimitPerSide: numberField(config.input.technical_analysis_limit_per_side),
    })
    return successResponse(data)
  } catch (error) {
    return errorResponse(error)
  } finally {
    process.chdir(previousCwd)
  }
}

function parseArgs(argv: string[]): Config {
  const config: Config = { dbPath: "./data/trade.db", input: {} }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case "--db": config.dbPath = readValue(argv, ++index, arg); break
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
  return { ok: true, schema_version: "slow-track-plan.script-response.v1", data }
}

function errorResponse(error: unknown): JSONRecord {
  const message = error instanceof Error ? error.message : String(error)
  return { ok: false, schema_version: "slow-track-plan.script-response.v1", error: message }
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function numberField(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function printHelp(): void {
  console.log(`Usage:
  bun src/scripts/main.ts --db ./data/trade.db --json '{"run_id":"slow-cycle"}'
`)
}

if (import.meta.main) {
  main(process.argv.slice(2))
}
