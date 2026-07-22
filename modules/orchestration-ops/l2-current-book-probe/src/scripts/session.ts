#!/usr/bin/env bun

import type { JSONRecord } from "../../../../contracts/runtime-core/src/json"
import { readJsonObjectFlag } from "../../../../contracts/runtime-core/src/script-json"
import { runL2BookWatchSession } from "../lib/l2-book-watch-session"

export function parseArgs(argv: string[]): JSONRecord {
  return readJsonObjectFlag(argv, printHelp)
}

export async function run(input: JSONRecord): Promise<JSONRecord> {
  return runL2BookWatchSession(input)
}

function printHelp(): void {
  console.log("usage: bun src/scripts/session.ts --json '{\"max_cycles\":3,\"session_ms\":30000,\"max_events\":20,\"watch_ms\":1000,\"depth\":20,\"max_freshness_ms\":1000}'")
}

if (import.meta.main) {
  try {
    const result = await run(parseArgs(Bun.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(result)}\n`)
    if (result.ok !== true) process.exitCode = 1
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`)
    process.exitCode = 1
  }
}
