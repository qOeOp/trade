#!/usr/bin/env bun

import { errorResponse, printScriptResult, readFlagValue, readJsonObject, successResponse } from "../../../../../contracts/runtime-core/src/script-json"
import type { JSONRecord } from "../../../../../contracts/runtime-core/src/json"
import type { ReplayDatasetManifest, ReplayFundingEvent, ReplayMarkEvent, ReplayMarketBar } from "../../../../replay-execution-plane/contracts/src/lib/replay-contracts"
import type { ForwardAdmissionRequest } from "../../../contracts/src/lib/forward-evidence-contracts"
import type { ReplayAttemptLeaseSnapshot } from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import { runForwardEvidenceSession } from "../lib/forward-evidence-runner"

const SCHEMA_VERSION = "rd-forward-evidence.script-response.v1"

export function run(argv: string[]): JSONRecord {
  try {
    const input = parse(argv)
    return successResponse(SCHEMA_VERSION, runForwardEvidenceSession({
      admission: record(input.admission) as unknown as ForwardAdmissionRequest,
      replay_attempt_lease: record(input.replay_attempt_lease) as unknown as ReplayAttemptLeaseSnapshot,
      replay_observed_at: text(input.replay_observed_at),
      dataset_manifest: record(input.dataset_manifest) as unknown as ReplayDatasetManifest,
      bars: array(input.bars) as ReplayMarketBar[],
      funding_events: array(input.funding_events) as ReplayFundingEvent[],
      mark_events: array(input.mark_events) as ReplayMarkEvent[],
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
  throw new Error("Forward Evidence runner requires --json")
}

function record(value: unknown): JSONRecord { return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {} }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }
function text(value: unknown): string { return typeof value === "string" ? value : "" }

if (import.meta.main) printScriptResult(run(process.argv.slice(2)))
