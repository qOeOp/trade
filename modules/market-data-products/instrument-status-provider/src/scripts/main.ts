#!/usr/bin/env bun

import { Database } from "bun:sqlite"
import { readFileSync } from "node:fs"
import { asRecord, stringField, type JSONRecord } from "../../../../contracts/runtime-core/src/json"
import { readInstrumentStatusArchive } from "../../../market-data-store/src/lib/market-data-store"
import { assertReplayInstrumentStatusEvidence, buildReplayInstrumentStatusEvidence } from "../lib/instrument-status-provider"

interface Args {
  dbPath: string
  input: JSONRecord
}

export function parseArgs(argv: string[]): Args {
  let dbPath = "data/market_data.db"
  let input: JSONRecord = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--db") dbPath = argv[++index] ?? dbPath
    else if (arg === "--json") input = asRecord(JSON.parse(argv[++index] ?? "{}"))
    else if (arg === "--json-file") input = asRecord(JSON.parse(readFileSync(argv[++index] ?? "", "utf8")))
    else if (arg === "--help") {
      console.log("usage: bun src/scripts/main.ts --db data/market_data.db --json '<archive_id/replay_start/replay_end/produced_at/provider_certification>'")
      process.exit(0)
    } else throw new Error(`unknown argument: ${arg}`)
  }
  return { dbPath, input }
}

export function run(args: Args): JSONRecord {
  const archiveId = stringField(args.input.archive_id)
  if (!archiveId) throw new Error("archive_id is required")
  const db = new Database(args.dbPath, { readonly: true })
  try {
    const archive = readInstrumentStatusArchive(db, archiveId)
    if (!archive) throw new Error("instrument status archive not found")
    const evidence = buildReplayInstrumentStatusEvidence({
      archive,
      replay_start: stringField(args.input.replay_start),
      replay_end: stringField(args.input.replay_end),
      produced_at: stringField(args.input.produced_at),
      provider_certification: {
        certification_ref: stringField(asRecord(args.input.provider_certification).certification_ref),
        certification_hash: stringField(asRecord(args.input.provider_certification).certification_hash),
        provider_capability_hash: stringField(asRecord(args.input.provider_certification).provider_capability_hash),
      },
    })
    assertReplayInstrumentStatusEvidence(evidence)
    return { ok: true, evidence }
  } finally {
    db.close()
  }
}

if (import.meta.main) {
  try {
    console.log(JSON.stringify(run(parseArgs(Bun.argv.slice(2))), null, 2))
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }))
    process.exit(1)
  }
}
