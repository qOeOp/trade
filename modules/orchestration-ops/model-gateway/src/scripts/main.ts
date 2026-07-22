#!/usr/bin/env bun

import { readFileSync } from "node:fs"
import { errorResponse, printScriptResult, readJsonObjectFlag, successResponse } from "../../../../contracts/runtime-core/src/script-json"
import { assertProjectRuntimePath, resolveRepoPath } from "../../../../contracts/runtime-core/src/paths"
import { runModelTask } from "../lib/model-gateway"

async function run(argv: string[]): Promise<Record<string, unknown>> {
  try {
    const profileIndex = argv.indexOf("--profile")
    if (profileIndex < 0 || !argv[profileIndex + 1]) throw new Error("--profile is required")
    const profilePath = argv[profileIndex + 1]
    assertProjectRuntimePath(profilePath)
    const requestArgs = [...argv.slice(0, profileIndex), ...argv.slice(profileIndex + 2)]
    const request = readJsonObjectFlag(requestArgs, printHelp)
    const profile = JSON.parse(readFileSync(resolveRepoPath(profilePath), "utf8"))
    return successResponse("model-gateway.result.v1", await runModelTask(request, profile))
  } catch (error) {
    return errorResponse("model-gateway.result.v1", error)
  }
}

function printHelp(): void { console.log("Usage: bun src/scripts/main.ts --profile profile/model-gateway.json --json '<model task request>'") }

printScriptResult(await run(Bun.argv.slice(2)))
