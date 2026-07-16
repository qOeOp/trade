#!/usr/bin/env bun

import { repoRoot, assertProjectRuntimePath } from "../../../../../contracts/runtime-core/src/paths"
import { errorResponse, printScriptResult, readFlagValue, successResponse } from "../../../../../contracts/runtime-core/src/script-json"
import type { JSONRecord } from "../../../../../contracts/runtime-core/src/json"
import { runReplayCancellationRecoveryJob } from "../lib/replay-cancellation-recovery-job"

const SCHEMA_VERSION = "rd-replay-cancellation-recovery.script-response.v1"

interface Args {
  dbPath: string
  artifactRoot: string
  registeredAt: string
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { dbPath: "data/rd_state.db", artifactRoot: "", registeredAt: new Date().toISOString() }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--db") args.dbPath = readFlagValue(argv, ++index, arg)
    else if (arg === "--artifact-root") args.artifactRoot = readFlagValue(argv, ++index, arg)
    else if (arg === "--registered-at") args.registeredAt = readFlagValue(argv, ++index, arg)
    else throw new Error(`unknown flag: ${arg}`)
  }
  if (!args.artifactRoot) throw new Error("Replay cancellation recovery requires --artifact-root")
  return args
}

export function run(argv: string[]): JSONRecord {
  const previousCwd = process.cwd()
  try {
    process.chdir(repoRoot())
    const args = parseArgs(argv)
    assertProjectRuntimePath(args.dbPath)
    assertProjectRuntimePath(args.artifactRoot)
    return successResponse(SCHEMA_VERSION, runReplayCancellationRecoveryJob({
      db_path: args.dbPath,
      artifact_root: args.artifactRoot,
      registered_at: args.registeredAt,
    }))
  } catch (error) {
    return errorResponse(SCHEMA_VERSION, error)
  } finally {
    process.chdir(previousCwd)
  }
}

if (import.meta.main) printScriptResult(run(process.argv.slice(2)))
