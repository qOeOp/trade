#!/usr/bin/env bun

import { errorResponse, printScriptResult, readJsonObjectFlag, successResponse } from "../../../../contracts/runtime-core/src/script-json"
import { revalidateWatchHandoff, type WatchHandoffRevalidationInput } from "../lib/watch-handoff-revalidation"

export function run(argv: string[]): Record<string, unknown> {
  try {
    const input = readJsonObjectFlag(argv, printHelp)
    return successResponse(
      "watch-handoff-revalidation.result.v1",
      revalidateWatchHandoff(input as unknown as WatchHandoffRevalidationInput),
    )
  } catch (error) {
    return errorResponse("watch-handoff-revalidation.result.v1", error)
  }
}

function printHelp(): void {
  console.log("Usage: bun src/scripts/main.ts --json '<definition + handoff + current observation + preflight facts>'")
}

if (import.meta.main) printScriptResult(run(Bun.argv.slice(2)))
