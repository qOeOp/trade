#!/usr/bin/env bun

import type { JSONRecord } from "../../../../contracts/runtime-core/src/json"
import { readJsonObjectFlag } from "../../../../contracts/runtime-core/src/script-json"
import { runL2CurrentBookProbe } from "../lib/l2-current-book-probe"

export function parseArgs(argv: string[]): JSONRecord {
  return readJsonObjectFlag(argv, printHelp)
}

export function run(input: JSONRecord): JSONRecord {
  return runL2CurrentBookProbe(input) as unknown as JSONRecord
}

function printHelp(): void {
  console.log("usage: bun src/scripts/main.ts --json '{\"depth\":20,\"max_freshness_ms\":1000}'")
}

if (import.meta.main) {
  try {
    process.stdout.write(`${JSON.stringify(run(parseArgs(Bun.argv.slice(2))))}\n`)
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`)
    process.exitCode = 1
  }
}
