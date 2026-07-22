#!/usr/bin/env bun

import { dirname } from "node:path"
import { assertProjectRuntimePath, repoRoot } from "../../../../contracts/runtime-core/src/paths"
import { numberOrUndefined, stringField } from "../../../../contracts/runtime-core/src/json"
import { errorResponse, printScriptResult, readFlagValue, readJsonObject, successResponse } from "../../../../contracts/runtime-core/src/script-json"
import { runSlowTrackWorkflowDryRun } from "../lib/slow-track-plan"

type JSONRecord = Record<string, unknown>

interface Config {
  dbPath: string
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
    const runId = stringField(config.input.run_id) || `slow-${Date.now()}`
    const dataDir = dirname(config.dbPath)
    const data = await runSlowTrackWorkflowDryRun({
      repoRoot: repoRoot(),
      dataDir,
      runId,
      dbPath: config.dbPath,
      candidateLimitPerSide: numberOrUndefined(config.input.candidate_limit_per_side),
      symbolSnapshotLimitPerSide: numberOrUndefined(config.input.symbol_snapshot_limit_per_side),
      technicalAnalysisLimitPerSide: numberOrUndefined(config.input.technical_analysis_limit_per_side),
    })
    return successResponse("slow-track-plan.script-response.v1", data)
  } catch (error) {
    return errorResponse("slow-track-plan.script-response.v1", error)
  } finally {
    process.chdir(previousCwd)
  }
}

function parseArgs(argv: string[]): Config {
  const config: Config = { dbPath: "./data/trade.db", input: {} }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case "--db": config.dbPath = readFlagValue(argv, ++index, arg); break
      case "--json": config.input = readJsonObject(readFlagValue(argv, ++index, arg)); break
      case "--help": printHelp(); return process.exit(0)
      default: throw new Error(`unknown flag: ${arg}`)
    }
  }
  return config
}

function printHelp(): void {
  console.log(`Usage:
  bun src/scripts/main.ts --db ./data/trade.db --json '{"run_id":"slow-cycle"}'
`)
}

if (import.meta.main) {
  main(process.argv.slice(2))
}
