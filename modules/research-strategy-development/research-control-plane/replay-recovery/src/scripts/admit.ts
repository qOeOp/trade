#!/usr/bin/env bun

import { repoRoot, assertProjectRuntimePath } from "../../../../../contracts/runtime-core/src/paths"
import { errorResponse, printScriptResult, readFlagValue, readJsonObject, successResponse } from "../../../../../contracts/runtime-core/src/script-json"
import type { JSONRecord } from "../../../../../contracts/runtime-core/src/json"
import type { ClaimReplayAttemptInput } from "../../../state-store/src/lib/replay-attempt-authority"
import {
  admitReplayAttemptAfterCancellationRecovery,
  type ReplayAttemptAdmissionDependencies,
} from "../lib/replay-attempt-admission"

const SCHEMA_VERSION = "rd-replay-attempt-admission.script-response.v1"

interface Args {
  dbPath: string
  artifactRoot: string
  recoveredAt: string
  claim: JSONRecord
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { dbPath: "data/rd_state.db", artifactRoot: "", recoveredAt: "", claim: {} }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--db") args.dbPath = readFlagValue(argv, ++index, arg)
    else if (arg === "--artifact-root") args.artifactRoot = readFlagValue(argv, ++index, arg)
    else if (arg === "--recovered-at") args.recoveredAt = readFlagValue(argv, ++index, arg)
    else if (arg === "--json") args.claim = readJsonObject(readFlagValue(argv, ++index, arg))
    else throw new Error(`unknown flag: ${arg}`)
  }
  if (!args.artifactRoot) throw new Error("Replay Attempt admission requires --artifact-root")
  if (!args.recoveredAt) throw new Error("Replay Attempt admission requires --recovered-at")
  if (Object.keys(args.claim).length === 0) throw new Error("Replay Attempt admission requires --json claim payload")
  return args
}

export function run(argv: string[], dependencies?: ReplayAttemptAdmissionDependencies): JSONRecord {
  const previousCwd = process.cwd()
  try {
    process.chdir(repoRoot())
    const args = parseArgs(argv)
    assertProjectRuntimePath(args.dbPath)
    assertProjectRuntimePath(args.artifactRoot)
    return successResponse(SCHEMA_VERSION, admitReplayAttemptAfterCancellationRecovery({
      db_path: args.dbPath,
      artifact_root: args.artifactRoot,
      recovered_at: args.recoveredAt,
      claim: args.claim as unknown as ClaimReplayAttemptInput,
    }, dependencies))
  } catch (error) {
    return errorResponse(SCHEMA_VERSION, error)
  } finally {
    process.chdir(previousCwd)
  }
}

if (import.meta.main) printScriptResult(run(process.argv.slice(2)))
