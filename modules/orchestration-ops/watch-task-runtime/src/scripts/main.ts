#!/usr/bin/env bun

import { readDbActionJsonArgs } from "../../../../contracts/runtime-core/src/script-json"
import { repoRoot } from "../../../../contracts/runtime-core/src/paths"
import { compileWatchTaskDefinition } from "../../../../contracts/watch-task-contract/src/watch-task-contract"
import {
  createOpsRuntimeStorePort,
  createPublicMarkObservationPort,
} from "../lib/watch-task-owner-ports"
import { runWatchTaskSession } from "../lib/watch-task-runtime"

async function main(): Promise<void> {
  const args = readDbActionJsonArgs(Bun.argv.slice(2), { dbPath: "data/ops_runtime.db", action: "run" }, printHelp)
  if (args.action !== "run") throw new Error("watch task runtime only supports action=run")
  const root = repoRoot()
  const definition = compileWatchTaskDefinition(args.json.definition)
  const result = await runWatchTaskSession({
    definition,
    state: createOpsRuntimeStorePort({ repositoryRoot: root, bunPath: process.execPath, dbPath: args.dbPath }),
    observations: createPublicMarkObservationPort({ repositoryRoot: root, bunPath: process.execPath }),
  })
  process.stdout.write(`${JSON.stringify({ ok: true, data: result }, null, 2)}\n`)
}

function printHelp(): void {
  console.log("Usage: bun src/scripts/main.ts --db data/ops_runtime.db --action run --json '<definition envelope>'")
}

try {
  await main()
} catch (error) {
  process.stdout.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`)
  process.exitCode = 1
}
