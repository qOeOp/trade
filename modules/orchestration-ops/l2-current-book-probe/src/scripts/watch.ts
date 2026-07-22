#!/usr/bin/env bun

import type { JSONRecord } from "../../../../contracts/runtime-core/src/json"
import { readJsonObjectFlag } from "../../../../contracts/runtime-core/src/script-json"
import { runL2BookWatchProbe } from "../lib/l2-book-watch-probe"

export function parseArgs(argv: string[]): JSONRecord {
  return readJsonObjectFlag(argv, printHelp)
}

export function run(input: JSONRecord): JSONRecord {
  return runL2BookWatchProbe(input)
}

function printHelp(): void {
  console.log("usage: bun src/scripts/watch.ts --json '{\"max_events\":20,\"watch_ms\":1000}'")
}

if (import.meta.main) {
  try {
    process.stdout.write(`${JSON.stringify(run(parseArgs(Bun.argv.slice(2))))}\n`)
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`)
    process.exitCode = 1
  }
}
