#!/usr/bin/env bun

import { Database } from "bun:sqlite"
import { mkdirSync, readFileSync } from "node:fs"
import { dirname } from "node:path"
import {
  buildCanonicalCandles,
  admitL2EpochManifest,
  buildFeatureManifest,
  buildFundingEvents,
  buildInstrumentStatusArchive,
  buildMarketManifest,
  commitInstrumentStatusArchive,
  ensureMarketDataSchema,
  ensureOhlcvSchema,
  listFeatureManifests,
  readCanonicalCandles,
  readFeatureManifest,
  readFundingEvents,
  readInstrumentStatusAcquisitionReceipt,
  readInstrumentStatusArchive,
  readLatestCandleOpenTime,
  readL2EpochManifest,
  reconcileL2EpochManifests,
  readMarketManifest,
  upsertCanonicalCandles,
  upsertFeatureManifest,
  upsertFundingEvents,
  upsertMarketManifest,
} from "../lib/market-data-store"
import { stringField, type JSONRecord } from "../../../../contracts/runtime-core/src/json"
import { repoRoot } from "../../../../contracts/runtime-core/src/paths"

interface Args {
  dbPath: string
  ohlcvDbPath: string
  action: string
  json: JSONRecord
}

export function parseArgs(argv: string[]): Args {
  let dbPath = "data/market_data.db"
  let ohlcvDbPath = "data/ohlcv.db"
  let action = "init"
  let json: JSONRecord = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--db") {
      dbPath = argv[++index] ?? dbPath
    } else if (arg === "--ohlcv-db") {
      ohlcvDbPath = argv[++index] ?? ohlcvDbPath
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
  return { dbPath, ohlcvDbPath, action, json }
}

export function run(args: Args): JSONRecord {
  mkdirSync(dirname(args.dbPath), { recursive: true })
  const db = new Database(args.dbPath)
  try {
    ensureMarketDataSchema(db)
    if (args.action === "init") {
      withOhlcvDb(args.ohlcvDbPath, () => null)
      return { ok: true, action: "init", db: args.dbPath, ohlcv_db: args.ohlcvDbPath }
    }
    if (args.action === "upsert_manifest") {
      const manifest = buildMarketManifest(args.json)
      upsertMarketManifest(db, manifest)
      return { ok: true, action: args.action, manifest }
    }
    if (args.action === "admit_l2_epoch_manifest") {
      const result = admitL2EpochManifest(db, {
        repository_root: repoRoot(),
        manifest_path: stringField(args.json.manifest_path),
        admitted_at: stringField(args.json.admitted_at) || undefined,
      })
      return { ok: true, action: args.action, ...result }
    }
    if (args.action === "reconcile_l2_epoch_manifests") {
      const scanRoots = Array.isArray(args.json.scan_roots)
        ? args.json.scan_roots.map((value) => stringField(value)).filter(Boolean)
        : [stringField(args.json.scan_root) || "data/l2"]
      return {
        ok: true,
        action: args.action,
        result: reconcileL2EpochManifests(db, {
          repository_root: repoRoot(),
          scan_roots: scanRoots,
          observed_at: stringField(args.json.observed_at) || undefined,
        }),
      }
    }
    if (args.action === "upsert_candles") {
      return withOhlcvDb(args.ohlcvDbPath, (ohlcvDb) => ({
        ok: true,
        action: args.action,
        count: upsertCanonicalCandles(ohlcvDb, buildCanonicalCandles(args.json.candles)),
      }))
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
    if (args.action === "commit_instrument_status_archive") {
      const archive = buildInstrumentStatusArchive(args.json)
      const commit_status = commitInstrumentStatusArchive(db, archive)
      return { ok: true, action: args.action, commit_status, archive_id: archive.archive_id, archive_hash: archive.archive_hash }
    }
    if (args.action === "read_manifest") {
      return {
        ok: true,
        action: args.action,
        manifest: readMarketManifest(db, stringField(args.json.manifest_id)),
      }
    }
    if (args.action === "read_l2_epoch_manifest") {
      return {
        ok: true,
        action: args.action,
        epoch: readL2EpochManifest(db, stringField(args.json.epoch_id)),
      }
    }
    if (args.action === "read_funding") {
      return {
        ok: true,
        action: args.action,
        events: readFundingEvents(db, {
          exchange: stringField(args.json.exchange) || undefined,
          symbol: stringField(args.json.symbol) || undefined,
          since_ts: optionalNumber(args.json.since_ts),
          until_ts: optionalNumber(args.json.until_ts),
          limit: optionalNumber(args.json.limit),
        }),
      }
    }
    if (args.action === "read_instrument_status_archive") {
      return {
        ok: true,
        action: args.action,
        archive: readInstrumentStatusArchive(db, stringField(args.json.archive_id)),
      }
    }
    if (args.action === "read_instrument_status_acquisition_receipt") {
      return {
        ok: true,
        action: args.action,
        receipt: readInstrumentStatusAcquisitionReceipt(db, stringField(args.json.acquisition_id)),
      }
    }
    if (args.action === "read_latest_candle") {
      return withOhlcvDb(args.ohlcvDbPath, (ohlcvDb) => ({
        ok: true,
        action: args.action,
        open_time: readLatestCandleOpenTime(ohlcvDb, {
          exchange: stringField(args.json.exchange) || undefined,
          symbol: stringField(args.json.symbol),
          timeframe: stringField(args.json.timeframe),
        }),
      }))
    }
    if (args.action === "read_candles") {
      return withOhlcvDb(args.ohlcvDbPath, (ohlcvDb) => ({
        ok: true,
        action: args.action,
        candles: readCanonicalCandles(ohlcvDb, {
          exchange: stringField(args.json.exchange) || undefined,
          symbol: stringField(args.json.symbol),
          timeframe: stringField(args.json.timeframe),
          since_ts: optionalNumber(args.json.since_ts),
          until_ts: optionalNumber(args.json.until_ts),
          limit: optionalNumber(args.json.limit),
        }),
      }))
    }
    if (args.action === "read_feature_manifest") {
      return {
        ok: true,
        action: args.action,
        manifest: readFeatureManifest(db, stringField(args.json.feature_manifest_id)),
      }
    }
    if (args.action === "list_feature_manifests") {
      return {
        ok: true,
        action: args.action,
        manifests: listFeatureManifests(db, {
          symbol: stringField(args.json.symbol) || undefined,
          timeframe: stringField(args.json.timeframe) || undefined,
          feature_set_id: stringField(args.json.feature_set_id) || undefined,
          limit: optionalNumber(args.json.limit),
        }),
      }
    }
    throw new Error(`unsupported action: ${args.action}`)
  } finally {
    db.close()
  }
}

function printHelp(): void {
  console.log([
    "usage: bun src/scripts/main.ts --db data/market_data.db --ohlcv-db data/ohlcv.db --action init",
    "actions: init | upsert_manifest | admit_l2_epoch_manifest | reconcile_l2_epoch_manifests | upsert_candles | upsert_funding | upsert_feature_manifest | commit_instrument_status_archive | read_manifest | read_l2_epoch_manifest | read_funding | read_instrument_status_acquisition_receipt | read_instrument_status_archive | read_latest_candle | read_candles | read_feature_manifest | list_feature_manifests",
  ].join("\n"))
}

function withOhlcvDb<T>(dbPath: string, fn: (db: Database) => T): T {
  mkdirSync(dirname(dbPath), { recursive: true })
  const db = new Database(dbPath)
  try {
    ensureOhlcvSchema(db)
    return fn(db)
  } finally {
    db.close()
  }
}

function optionalNumber(value: unknown): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

if (import.meta.main) {
  try {
    console.log(JSON.stringify(run(parseArgs(Bun.argv.slice(2))), null, 2))
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }))
    process.exit(1)
  }
}
