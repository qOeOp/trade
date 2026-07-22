#!/usr/bin/env bun

import { errorResponse, printScriptResult, readJsonInputArgs, successResponse } from "../../../../contracts/runtime-core/src/script-json"
import { compilePlanWatchTask, type WatchTaskCompileInput } from "../lib/watch-task-compiler"

export function run(argv: string[]): Record<string, unknown> {
  try {
    const { input } = readJsonInputArgs(argv, printHelp)
    return successResponse("watch-task-compiler.result.v1", compilePlanWatchTask(input as unknown as WatchTaskCompileInput))
  } catch (error) {
    return errorResponse("watch-task-compiler.result.v1", error)
  }
}

function printHelp(): void {
  console.log("Usage: bun src/scripts/main.ts --json '<plan + action intent + bounded watch fields>'")
}

if (import.meta.main) printScriptResult(run(Bun.argv.slice(2)))
