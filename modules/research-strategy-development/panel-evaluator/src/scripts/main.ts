#!/usr/bin/env bun

import { repoRoot } from "../../../../contracts/runtime-core/src/paths"
import { errorResponse, printScriptResult, readJsonInputArgs, successResponse } from "../../../../contracts/runtime-core/src/script-json"
import type { JSONRecord } from "../../../../contracts/runtime-core/src/json"
import { runStrategyPanelRnd, strategyPanelRndInputFromJson } from "../lib/strategy-panel-rnd"

const SCHEMA_VERSION = "panel-evaluator.script-response.v1"

function main(argv: string[]): void {
  printScriptResult(run(argv))
}

export function run(argv: string[]): JSONRecord {
  const previousCwd = process.cwd()
  try {
    process.chdir(repoRoot())
    return successResponse(SCHEMA_VERSION, runStrategyPanelRnd(strategyPanelRndInputFromJson(readJsonInputArgs(argv, printHelp).input)))
  } catch (error) {
    return errorResponse(SCHEMA_VERSION, error)
  } finally {
    process.chdir(previousCwd)
  }
}

function printHelp(): void {
  console.log(`Usage:
  bun src/scripts/main.ts --json '{"datasets":[...],"candidates":[...]}'
`)
}

if (import.meta.main) {
  main(process.argv.slice(2))
}
