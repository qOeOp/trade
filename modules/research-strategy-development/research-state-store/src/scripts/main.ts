#!/usr/bin/env bun

import { Database } from "bun:sqlite"
import { readFileSync } from "node:fs"
import {
  buildRdHoldoutUse,
  buildRdHypothesis,
  buildRdLesson,
  buildRdProgram,
  buildRdTrial,
  ensureResearchStateSchema,
  readRdProgram,
  recordRdHoldoutUse,
  recordRdLesson,
  recordRdTrial,
  upsertRdHypothesis,
  upsertRdProgram,
} from "../lib/research-state-store"
import { stringField, type JSONRecord } from "../../../../contracts/runtime-core/src/json"

interface Args {
  dbPath: string
  action: string
  json: JSONRecord
}

export function parseArgs(argv: string[]): Args {
  let dbPath = "data/rd_state.db"
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
    ensureResearchStateSchema(db)
    if (args.action === "init") {
      return { ok: true, action: "init", db: args.dbPath }
    }
    if (args.action === "upsert_program") {
      const program = buildRdProgram(args.json)
      upsertRdProgram(db, program)
      return { ok: true, action: args.action, program }
    }
    if (args.action === "upsert_hypothesis") {
      const hypothesis = buildRdHypothesis(args.json)
      upsertRdHypothesis(db, hypothesis)
      return { ok: true, action: args.action, hypothesis }
    }
    if (args.action === "record_trial") {
      const trial = buildRdTrial(args.json)
      recordRdTrial(db, trial)
      return { ok: true, action: args.action, trial }
    }
    if (args.action === "record_holdout_use") {
      const holdout_use = buildRdHoldoutUse(args.json)
      recordRdHoldoutUse(db, holdout_use)
      return { ok: true, action: args.action, holdout_use }
    }
    if (args.action === "record_lesson") {
      const lesson = buildRdLesson(args.json)
      recordRdLesson(db, lesson)
      return { ok: true, action: args.action, lesson }
    }
    if (args.action === "read_program") {
      return { ok: true, action: args.action, program: readRdProgram(db, stringField(args.json.program_id)) }
    }
    throw new Error(`unsupported action: ${args.action}`)
  } finally {
    db.close()
  }
}

function printHelp(): void {
  console.log([
    "usage: bun src/scripts/main.ts --db data/rd_state.db --action init",
    "actions: init | upsert_program | upsert_hypothesis | record_trial | record_holdout_use | record_lesson | read_program",
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

