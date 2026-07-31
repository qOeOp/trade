#!/usr/bin/env bun

import { repoRoot } from "../../../../../../contracts/runtime-core/src/paths"
import { errorResponse, printScriptResult, readJsonInputArgs, successResponse } from "../../../../../../contracts/runtime-core/src/script-json"
import type { JSONRecord } from "../../../../../../contracts/runtime-core/src/json"
import { runStrategyPanelRnd, strategyPanelRndInputFromJson } from "../../../candidate-batch-engine/src/lib/strategy-panel-rnd"
import { runStrategyRndBatch } from "../../../candidate-batch-engine/src/lib/strategy-rnd-batch"
import { strategyRndBatchInputFromJson } from "../../../candidate-batch-engine/src/lib/strategy-rnd-inputs"

const SCHEMA_VERSION = "candidate-batch.script-response.v1"
const PANEL_SCHEMA_VERSION = "panel-evaluator.script-response.v1"

function main(argv: string[]): void {
  printScriptResult(run(argv))
}

export function run(argv: string[]): JSONRecord {
  const previousCwd = process.cwd()
  const panelMode = argv.includes("--panel")
  const inputArgs = argv.filter((arg) => arg !== "--panel")
  try {
    process.chdir(repoRoot())
    const input = readJsonInputArgs(inputArgs, printHelp).input
    return panelMode
      ? successResponse(PANEL_SCHEMA_VERSION, runStrategyPanelRnd(strategyPanelRndInputFromJson(input)))
      : successResponse(SCHEMA_VERSION, runStrategyRndBatch(strategyRndBatchInputFromJson(input)))
  } catch (error) {
    return errorResponse(panelMode ? PANEL_SCHEMA_VERSION : SCHEMA_VERSION, error)
  } finally {
    process.chdir(previousCwd)
  }
}

function printHelp(): void {
  console.log(`Usage:
  bun src/scripts/main.ts --json '{"manifest_path":"...","candidates":[...]}'
  bun src/scripts/main.ts --panel --json '{"datasets":[...],"candidates":[...]}'
`)
}

if (import.meta.main) {
  main(process.argv.slice(2))
}
