#!/usr/bin/env bun

import { Database } from "bun:sqlite"
import { readFileSync } from "node:fs"
import {
  buildCanonicalCandles,
  buildFeatureManifest,
  buildFundingEvents,
  buildMarketManifest,
  ensureMarketDataSchema,
  readMarketManifest,
  upsertCanonicalCandles,
  upsertFeatureManifest,
  upsertFundingEvents,
  upsertMarketManifest,
} from "../lib/market-data-store"
import { stringField, type JSONRecord } from "../../../../contracts/runtime-core/src/json"

interface Args {
  dbPath: string
  action: string
  json: JSONRecord
}

export function parseArgs(argv: string[]): Args {
  let dbPath = "data/market_data.duckdb"
  let action = "init"
  let json: JSONRecord = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--db") {
      dbPath = argv[++index] ?? dbPath
    } else if (arg === "--action") {
      action = argv[++index] ?? action
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
  return { dbPath, action, json }
}

export function run(args: Args): JSONRecord {
  const db = new Database(args.dbPath)
  try {
    ensureMarketDataSchema(db)
    if (args.action === "init") {
      return { ok: true, action: "init", db: args.dbPath }
    }
    if (args.action === "upsert_manifest") {
      const manifest = buildMarketManifest(args.json)
      upsertMarketManifest(db, manifest)
      return { ok: true, action: args.action, manifest }
    }
    if (args.action === "upsert_candles") {
      const count = upsertCanonicalCandles(db, buildCanonicalCandles(args.json.candles))
      return { ok: true, action: args.action, count }
    }
    if (args.action === "upsert_funding") {
      const count = upsertFundingEvents(db, buildFundingEvents(args.json.events))
      return { ok: true, action: args.action, count }
    }
    if (args.action === "upsert_feature_manifest") {
      const manifest = buildFeatureManifest(args.json)
      upsertFeatureManifest(db, manifest)
      return { ok: true, action: args.action, manifest }
    }
    if (args.action === "read_manifest") {
      return {
        ok: true,
        action: args.action,
        manifest: readMarketManifest(db, stringField(args.json.manifest_id)),
      }
    }
    throw new Error(`unsupported action: ${args.action}`)
  } finally {
    db.close()
  }
}

function printHelp(): void {
  console.log([
    "usage: bun src/scripts/main.ts --db data/market_data.duckdb --action init",
    "actions: init | upsert_manifest | upsert_candles | upsert_funding | upsert_feature_manifest | read_manifest",
  ].join("\n"))
}

if (import.meta.main) {
  try {
    console.log(JSON.stringify(run(parseArgs(Bun.argv.slice(2))), null, 2))
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }))
    process.exit(1)
  }
}

