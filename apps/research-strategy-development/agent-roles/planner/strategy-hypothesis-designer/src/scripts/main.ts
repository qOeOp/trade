#!/usr/bin/env bun

import { repoRoot } from "../../../../../../contracts/runtime-core/src/paths"
import { errorResponse, printScriptResult, readFlagValue, readJsonObject, readJsonObjectFile, successResponse } from "../../../../../../contracts/runtime-core/src/script-json"
import type { JSONRecord } from "../../../../../../contracts/runtime-core/src/json"
import {
  buildStrategyHypothesisDesignContext,
  lintStrategyHypothesisContract,
  renderStrategyDesignerPrompt,
  renderControlPlanePlannerPrompt,
  strategyHypothesisToQueueItem,
} from "../lib/strategy-hypothesis-designer"
import { assessStrategyHypothesisModelResult, buildStrategyHypothesisModelTask } from "../lib/model-task-adapter"

type Action = "context" | "render_prompt" | "render_control_plane_prompt" | "model_task" | "assess_model_result" | "validate" | "queue_item"

interface Config {
  action: Action
  input: JSONRecord
}

const SCHEMA_VERSION = "strategy-hypothesis-designer.script-response.v1"

function main(argv: string[]): void {
  printScriptResult(run(argv))
}

export function run(argv: string[]): JSONRecord {
  const previousCwd = process.cwd()
  try {
    process.chdir(repoRoot())
    const config = parseArgs(argv)
    return successResponse(SCHEMA_VERSION, execute(config))
  } catch (error) {
    return errorResponse(SCHEMA_VERSION, error)
  } finally {
    process.chdir(previousCwd)
  }
}

function execute(config: Config): JSONRecord {
  if (config.action === "context") {
    return buildStrategyHypothesisDesignContext(config.input)
  }
  if (config.action === "render_prompt") {
    return { prompt: renderStrategyDesignerPrompt(buildStrategyHypothesisDesignContext(config.input)) }
  }
  if (config.action === "render_control_plane_prompt") {
    return { prompt: renderControlPlanePlannerPrompt(buildStrategyHypothesisDesignContext(config.input)) }
  }
  if (config.action === "validate") {
    return lintStrategyHypothesisContract(config.input) as unknown as JSONRecord
  }
  if (config.action === "model_task") {
    return { model_task: buildStrategyHypothesisModelTask(config.input as unknown as Parameters<typeof buildStrategyHypothesisModelTask>[0]) }
  }
  if (config.action === "assess_model_result") {
    return assessStrategyHypothesisModelResult(config.input.request, config.input.result)
  }
  return { queue_item: strategyHypothesisToQueueItem(config.input) }
}

function parseArgs(argv: string[]): Config {
  const config: Config = { action: "render_prompt", input: {} }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case "--action":
        config.action = readAction(readFlagValue(argv, ++index, arg))
        break
      case "--input":
        config.input = readJsonObjectFile(readFlagValue(argv, ++index, arg))
        break
      case "--json":
        config.input = readJsonObject(readFlagValue(argv, ++index, arg))
        break
      case "--help":
        return exitWithHelp()
      default:
        throw new Error(`unknown flag: ${arg}`)
    }
  }
  return config
}

function readAction(value: string): Action {
  if (value === "context" || value === "render_prompt" || value === "render_control_plane_prompt" || value === "model_task" || value === "assess_model_result" || value === "validate" || value === "queue_item") return value
  throw new Error(`unsupported action: ${value}`)
}

function printHelp(): void {
  console.log(`Usage:
  bun src/scripts/main.ts --action render_prompt --json '{"objective":"..."}'
  bun src/scripts/main.ts --action render_control_plane_prompt --json '{"objective":"...","control_plane_context":{}}'
  bun src/scripts/main.ts --action model_task --json '{"task_id":"...","idempotency_key":"...","trace_id":"...","program_ref":"...","designer_input":{}}'
  bun src/scripts/main.ts --action assess_model_result --json '{"request":{},"result":{}}'
  bun src/scripts/main.ts --action validate --input ./tmp/hypothesis.json
  bun src/scripts/main.ts --action queue_item --input ./tmp/hypothesis.json
`)
}

function exitWithHelp(): never {
  printHelp()
  process.exit(0)
}

if (import.meta.main) {
  main(process.argv.slice(2))
}
