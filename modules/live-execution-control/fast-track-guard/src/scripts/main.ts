#!/usr/bin/env bun

import { dirname } from "node:path"
import { assertProjectRuntimePath, repoRoot } from "../../../../contracts/runtime-core/src/paths"
import { stringField } from "../../../../contracts/runtime-core/src/json"
import { errorResponse, printScriptResult, readFlagValue, readJsonObject, successResponse } from "../../../../contracts/runtime-core/src/script-json"
import { runFastTrackGuardJob, runFastTrackWorkflowDryRun } from "../lib/fast-track-guard"

type JSONRecord = Record<string, unknown>

interface Config {
  dbPath: string
  jobMode: boolean
  input: JSONRecord
}

function main(argv: string[]): void {
  run(argv).then((result) => {
    printScriptResult(result)
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
    return successResponse("fast-track-guard.script-response.v1", data)
  } catch (error) {
    return errorResponse("fast-track-guard.script-response.v1", error)
  } finally {
    process.chdir(previousCwd)
  }
}

function parseArgs(argv: string[]): Config {
  const config: Config = { dbPath: "./data/trade.db", jobMode: false, input: {} }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case "--db": config.dbPath = readFlagValue(argv, ++index, arg); break
      case "--fast-guard-job": config.jobMode = true; break
      case "--json": config.input = readJsonObject(readFlagValue(argv, ++index, arg)); break
      case "--help": printHelp(); return process.exit(0)
      default: throw new Error(`unknown flag: ${arg}`)
    }
  }
  return config
}

function printHelp(): void {
  console.log(`Usage:
  bun src/scripts/main.ts --fast-guard-job --db ./data/trade.db --json '{"cycle_id":"cycle","run_id":"fast-cycle"}'
`)
}

if (import.meta.main) {
  main(process.argv.slice(2))
}
