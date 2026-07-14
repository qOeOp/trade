#!/usr/bin/env bun

import { errorResponse, printScriptResult, readFlagValue, readJsonObject, successResponse } from "../../../../../contracts/runtime-core/src/script-json"
import type { JSONRecord } from "../../../../../contracts/runtime-core/src/json"
import type { ReplayDatasetManifest, ReplayExecutionRequest, ReplayFundingEvent, ReplayMarketBar } from "../../../contracts/src/lib/replay-contracts"
import { runReplayTrial } from "../lib/replay-trial-runner"

const SCHEMA_VERSION = "rd-replay-execution.script-response.v1"

export function run(argv: string[]): JSONRecord {
  try {
    const input = parse(argv)
    return successResponse(SCHEMA_VERSION, runReplayTrial({
      request: record(input.request) as unknown as ReplayExecutionRequest,
      dataset_manifest: record(input.dataset_manifest) as unknown as ReplayDatasetManifest,
      bars: array(input.bars) as ReplayMarketBar[],
      funding_events: array(input.funding_events) as ReplayFundingEvent[],
      artifact_root: text(input.artifact_root) || undefined,
      cancel_requested: input.cancel_requested === true,
    }))
  } catch (error) {
    return errorResponse(SCHEMA_VERSION, error)
  }
}

function parse(argv: string[]): JSONRecord {
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--json") return readJsonObject(readFlagValue(argv, ++index, "--json"))
    throw new Error(`unknown flag: ${argv[index]}`)
  }
  throw new Error("Replay execution requires --json")
}

function record(value: unknown): JSONRecord { return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {} }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }
function text(value: unknown): string { return typeof value === "string" ? value : "" }

if (import.meta.main) printScriptResult(run(process.argv.slice(2)))
