#!/usr/bin/env bun

import { errorResponse, printScriptResult, readFlagValue, readJsonObject, readJsonObjectFile, successResponse } from "../../../../../contracts/runtime-core/src/script-json"
import type { JSONRecord } from "../../../../../contracts/runtime-core/src/json"
import { assertProjectRuntimePath, resolveRepoPath } from "../../../../../contracts/runtime-core/src/paths"
import type { ReplayResumeAuthorizationSnapshot, TrialReservationSnapshot } from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import type { ReplayRegisteredAttemptDispatchAuthority } from "../../../../research-control-plane/contracts/src/lib/replay-registered-attempt-dispatch-authority"
import type { ReplayDatasetManifest, ReplayFundingEvent, ReplayMarkEvent, ReplayMarketBar, ReplaySupplementalFact } from "../../../contracts/src/lib/replay-contracts"
import type { ReplayEngineCheckpoint } from "../../../engine/src/lib/replay-reference-engine"
import { compileFormalReplayDataBundle } from "../lib/formal-replay-data-bundle"
import { runRegisteredReplayTrial } from "../lib/replay-registered-trial-runner"

const SCHEMA_VERSION = "rd-replay-execution.script-response.v1"

export function run(argv: string[]): JSONRecord {
  try {
    const config = parse(argv)
    const input = config.input
    if (config.compileDataBundle) {
      return successResponse(
        SCHEMA_VERSION,
        compileFormalReplayDataBundle(input),
      )
    }
    if ("request" in input || "attempt_lease" in input) {
      throw new Error("Replay execution rejects caller-supplied Request and Attempt Lease; dispatch_authority is required")
    }
    return successResponse(SCHEMA_VERSION, runRegisteredReplayTrial({
      dispatch_authority: record(input.dispatch_authority) as unknown as ReplayRegisteredAttemptDispatchAuthority,
      trial_reservation: record(input.trial_reservation) as unknown as TrialReservationSnapshot,
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

function parse(argv: string[]): {
  input: JSONRecord
  compileDataBundle: boolean
} {
  let input: JSONRecord | null = null
  let compileDataBundle = false
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--json") {
      if (input) throw new Error("Replay execution accepts one input source")
      input = readJsonObject(readFlagValue(argv, ++index, "--json"))
    } else if (argv[index] === "--input") {
      if (input) throw new Error("Replay execution accepts one input source")
      const ref = readFlagValue(argv, ++index, "--input")
      assertProjectRuntimePath(ref)
      input = readJsonObjectFile(resolveRepoPath(ref))
    } else if (argv[index] === "--compile-data-bundle") {
      if (compileDataBundle) throw new Error("Replay data bundle compile mode was repeated")
      compileDataBundle = true
    } else throw new Error(`unknown flag: ${argv[index]}`)
  }
  if (!input) throw new Error("Replay execution requires --json or --input")
  return { input, compileDataBundle }
}

function record(value: unknown): JSONRecord { return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {} }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }
function text(value: unknown): string { return typeof value === "string" ? value : "" }

if (import.meta.main) printScriptResult(run(process.argv.slice(2)))
