#!/usr/bin/env bun

import { readDbActionJsonArgs } from "../../../../contracts/runtime-core/src/script-json"
import { repoRoot } from "../../../../contracts/runtime-core/src/paths"
import { compileWatchTaskDefinition } from "../../../../contracts/watch-task-contract/src/watch-task-contract"
import {
  createOpsRuntimeStorePort,
  createPublicMarkObservationPort,
  createWatchHandoffRevalidationPort,
} from "../lib/watch-task-owner-ports"
import { runWatchTaskSession } from "../lib/watch-task-runtime"
import { closeWatchTaskRevalidation } from "../lib/watch-task-handoff-session"

async function main(): Promise<void> {
  const args = readDbActionJsonArgs(Bun.argv.slice(2), { dbPath: "data/ops_runtime.db", action: "run" }, printHelp)
  const root = repoRoot()
  const state = createOpsRuntimeStorePort({ repositoryRoot: root, bunPath: process.execPath, dbPath: args.dbPath })
  const result = args.action === "run"
    ? await runWatchTaskSession({
      definition: compileWatchTaskDefinition(args.json.definition),
      state,
      observations: createPublicMarkObservationPort({ repositoryRoot: root, bunPath: process.execPath }),
    })
    : args.action === "revalidate"
      ? await closeWatchTaskRevalidation({
        taskId: String(args.json.task_id ?? ""),
        state,
        revalidation: createWatchHandoffRevalidationPort({ repositoryRoot: root, bunPath: process.execPath }),
        currentObservation: args.json.current_observation,
        preflight: args.json.preflight,
      })
      : (() => { throw new Error("watch task runtime supports action=run or revalidate") })()
  process.stdout.write(`${JSON.stringify({ ok: true, data: result }, null, 2)}\n`)
}

function printHelp(): void {
  console.log("Usage: bun src/scripts/main.ts --db data/ops_runtime.db --action <run|revalidate> --json '<payload>'")
}

try {
  await main()
} catch (error) {
  process.stdout.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`)
  process.exitCode = 1
}
