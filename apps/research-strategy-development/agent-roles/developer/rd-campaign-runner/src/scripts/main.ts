#!/usr/bin/env bun

import { assertProjectRuntimePath, repoRoot } from "../../../../../../contracts/runtime-core/src/paths"
import { errorResponse, printScriptResult, readJsonInputArgs, successResponse } from "../../../../../../contracts/runtime-core/src/script-json"
import type { JSONRecord } from "../../../../../../contracts/runtime-core/src/json"
import { strategyRndCampaignInputFromJson } from "../../../candidate-batch-engine/src/lib/strategy-rnd-inputs"
import { runStrategyRndCampaign } from "../lib/rd-campaign-runner"

const SCHEMA_VERSION = "rd-campaign-runner.script-response.v1"

function main(argv: string[]): void {
  printScriptResult(run(argv))
}

export function run(argv: string[]): JSONRecord {
  const previousCwd = process.cwd()
  try {
    process.chdir(repoRoot())
    const config = readJsonInputArgs(argv, printHelp)
    const input = strategyRndCampaignInputFromJson(config.input)
    assertRuntimeOutputPaths(input.artifactRoot, input.ledgerPath, input.catalogDbPath, input.rdStateDb)
    return successResponse(SCHEMA_VERSION, runStrategyRndCampaign(input))
  } catch (error) {
    return errorResponse(SCHEMA_VERSION, error)
  } finally {
    process.chdir(previousCwd)
  }
}

function assertRuntimeOutputPaths(...paths: Array<string | undefined>): void {
  for (const path of paths) {
    if (path) assertProjectRuntimePath(path)
  }
}

function printHelp(): void {
  console.log(`Usage:
  bun src/scripts/main.ts --json '{"campaign_id":"...","hypotheses":[...]}'
`)
}

if (import.meta.main) {
  main(process.argv.slice(2))
}
