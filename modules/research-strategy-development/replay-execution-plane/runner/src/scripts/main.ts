#!/usr/bin/env bun

import { errorResponse, printScriptResult, readFlagValue, readJsonObject, successResponse } from "../../../../../contracts/runtime-core/src/script-json"
import type { JSONRecord } from "../../../../../contracts/runtime-core/src/json"
import type { ReplayAttemptLeaseSnapshot, ReplayResumeAuthorizationSnapshot, TrialReservationSnapshot } from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import type { ReplayDatasetManifest, ReplayExecutionRequest, ReplayFundingEvent, ReplayMarkEvent, ReplayMarketBar, ReplaySupplementalFact } from "../../../contracts/src/lib/replay-contracts"
import type { ReplayEngineCheckpoint } from "../../../engine/src/lib/replay-reference-engine"
import { runReplayTrial } from "../lib/replay-trial-runner"

const SCHEMA_VERSION = "rd-replay-execution.script-response.v1"

export function run(argv: string[]): JSONRecord {
  try {
    const input = parse(argv)
    return successResponse(SCHEMA_VERSION, runReplayTrial({
      request: record(input.request) as unknown as ReplayExecutionRequest,
      trial_reservation: record(input.trial_reservation) as unknown as TrialReservationSnapshot,
      attempt_lease: record(input.attempt_lease) as unknown as ReplayAttemptLeaseSnapshot,
      observed_at: String(input.observed_at || ""),
      dataset_manifest: record(input.dataset_manifest) as unknown as ReplayDatasetManifest,
      bars: array(input.bars) as ReplayMarketBar[],
      funding_events: array(input.funding_events) as ReplayFundingEvent[],
      mark_events: array(input.mark_events) as ReplayMarkEvent[],
      supplemental_facts: array(input.supplemental_facts) as ReplaySupplementalFact[],
      artifact_root: text(input.artifact_root) || undefined,
      cancel_requested: input.cancel_requested === true,
      execution_control: input.resume_checkpoint || input.resume_authorization
        ? {
          ...(input.resume_checkpoint
            ? { resume_checkpoint: record(input.resume_checkpoint) as unknown as ReplayEngineCheckpoint }
            : {}),
          ...(input.resume_authorization
            ? { resume_authorization: record(input.resume_authorization) as unknown as ReplayResumeAuthorizationSnapshot }
            : {}),
        }
        : undefined,
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
