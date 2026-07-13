#!/usr/bin/env bun

import { dirname } from "node:path"
import { assertProjectRuntimePath, repoRoot } from "../../../../contracts/runtime-core/src/paths"
import { runFastTrackGuardJob, runFastTrackWorkflowDryRun } from "../lib/fast-track-guard"

type JSONRecord = Record<string, unknown>

interface Config {
  dbPath: string
  jobMode: boolean
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
    const runId = stringField(config.input.run_id) || `fast-${Date.now()}`
    const dataDir = dirname(config.dbPath)
    const data = config.jobMode
      ? await runFastTrackGuardJob({
        cycle_id: stringField(config.input.cycle_id) || "manual-cycle",
        ticket_no: stringField(config.input.ticket_no) || "J02",
        job_id: stringField(config.input.job_id) || "fast_track_guard",
        idempotency_key: stringField(config.input.idempotency_key) || undefined,
        now: stringField(config.input.now) || undefined,
        repoRoot: repoRoot(),
        dataDir,
        runId,
        dbPath: config.dbPath,
      })
      : await runFastTrackWorkflowDryRun({
        repoRoot: repoRoot(),
        dataDir,
        runId,
        dbPath: config.dbPath,
      })
    return successResponse(data)
  } catch (error) {
    return errorResponse(error)
  } finally {
    process.chdir(previousCwd)
  }
}

function parseArgs(argv: string[]): Config {
  const config: Config = { dbPath: "./data/trade.db", jobMode: false, input: {} }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case "--db": config.dbPath = readValue(argv, ++index, arg); break
      case "--fast-guard-job": config.jobMode = true; break
      case "--json": config.input = readJson(readValue(argv, ++index, arg)); break
      case "--help": printHelp(); return process.exit(0)
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
  return { ok: true, schema_version: "fast-track-guard.script-response.v1", data }
}

function errorResponse(error: unknown): JSONRecord {
  const message = error instanceof Error ? error.message : String(error)
  return { ok: false, schema_version: "fast-track-guard.script-response.v1", error: message }
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function printHelp(): void {
  console.log(`Usage:
  bun src/scripts/main.ts --fast-guard-job --db ./data/trade.db --json '{"cycle_id":"cycle","run_id":"fast-cycle"}'
`)
}

if (import.meta.main) {
  main(process.argv.slice(2))
}
