#!/usr/bin/env bun

import { repoRoot } from "../../../../../../contracts/runtime-core/src/paths"
import { errorResponse, printScriptResult, readJsonInputArgs, successResponse } from "../../../../../../contracts/runtime-core/src/script-json"
import type { JSONRecord } from "../../../../../../contracts/runtime-core/src/json"
import { fundingCarryGovernanceInputFromJson, runFundingCarryGovernance } from "../lib/funding-carry-governance"

const SCHEMA_VERSION = "funding-governance.script-response.v1"

function main(argv: string[]): void {
  printScriptResult(run(argv))
}

export function run(argv: string[]): JSONRecord {
  const previousCwd = process.cwd()
  try {
    process.chdir(repoRoot())
    return successResponse(SCHEMA_VERSION, runFundingCarryGovernance(fundingCarryGovernanceInputFromJson(readJsonInputArgs(argv, printHelp).input)))
  } catch (error) {
    return errorResponse(SCHEMA_VERSION, error)
  } finally {
    process.chdir(previousCwd)
  }
}

function printHelp(): void {
  console.log(`Usage:
  bun src/scripts/main.ts --json '{"datasets":[{"dataset_id":"BTCUSDT","manifest_path":"data/ohlcv/BTCUSDT/manifest.json","indicator_report_path":"tmp/features/BTCUSDT.json"}]}'
`)
}

if (import.meta.main) {
  main(process.argv.slice(2))
}
