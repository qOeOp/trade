#!/usr/bin/env bun

import { errorResponse, printScriptResult, readJsonInputArgs, successResponse } from "../../../../contracts/runtime-core/src/script-json"
import { arbitrateAccountCandidates, type AccountCandidateArbiterInput } from "../lib/account-candidate-arbiter"

export function run(argv: string[]): Record<string, unknown> {
  try {
    const { input } = readJsonInputArgs(argv, printHelp)
    return successResponse(
      "account-candidate-arbiter.result.v1",
      arbitrateAccountCandidates(input as unknown as AccountCandidateArbiterInput),
    )
  } catch (error) {
    return errorResponse("account-candidate-arbiter.result.v1", error)
  }
}

function printHelp(): void {
  console.log("Usage: bun src/scripts/main.ts --json '<account candidate allocation input>'")
}

if (import.meta.main) printScriptResult(run(Bun.argv.slice(2)))
