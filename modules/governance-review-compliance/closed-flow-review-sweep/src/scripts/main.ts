#!/usr/bin/env bun

import { Database } from "bun:sqlite"
import { readFileSync } from "node:fs"
import { runClosedFlowReviewSweep } from "../lib/closed-flow-review-sweep"
import type { JSONRecord } from "../../../../contracts/runtime-core/src/json"

interface Args {
  tradeDbPath: string
  governanceDbPath: string
  json: JSONRecord
}

export function parseArgs(argv: string[]): Args {
  let tradeDbPath = "data/trade.db"
  let governanceDbPath = "data/governance.db"
  let json: JSONRecord = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--trade-db") {
      tradeDbPath = argv[++index] ?? tradeDbPath
    } else if (arg === "--governance-db") {
      governanceDbPath = argv[++index] ?? governanceDbPath
    } else if (arg === "--json") {
      json = JSON.parse(argv[++index] ?? "{}") as JSONRecord
    } else if (arg === "--json-file") {
      json = JSON.parse(readFileSync(argv[++index] ?? "", "utf8")) as JSONRecord
    } else if (arg === "--help") {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }
  return { tradeDbPath, governanceDbPath, json }
}

export function run(args: Args): JSONRecord {
  const tradeDb = new Database(args.tradeDbPath)
  const governanceDb = new Database(args.governanceDbPath)
  try {
    return runClosedFlowReviewSweep(tradeDb, governanceDb, args.json) as unknown as JSONRecord
  } finally {
    tradeDb.close()
    governanceDb.close()
  }
}

function printHelp(): void {
  console.log("usage: bun src/scripts/main.ts --trade-db data/trade.db --governance-db data/governance.db --json '{\"batch_id\":\"...\"}'")
}

if (import.meta.main) {
  try {
    console.log(JSON.stringify(run(parseArgs(Bun.argv.slice(2))), null, 2))
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }))
    process.exit(1)
  }
}

