#!/usr/bin/env bun

import { Database } from "bun:sqlite"
import { readFileSync } from "node:fs"
import {
  buildCycleRun,
  buildDomainMessage,
  buildIncident,
  buildJobRun,
  ensureOpsRuntimeSchema,
  readCycleSummary,
  readDomainMessages,
  readIncidentEvents,
  readIncidents,
  recordIncident,
  updateIncidentStatus,
  upsertCycleRun,
  upsertDomainMessage,
  upsertJobRun,
} from "../lib/ops-runtime-store"
import { stringField, type JSONRecord } from "../../../../contracts/runtime-core/src/json"

interface Args {
  dbPath: string
  action: string
  json: JSONRecord
}

export function parseArgs(argv: string[]): Args {
  let dbPath = "data/ops_runtime.db"
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
    ensureOpsRuntimeSchema(db)
    if (args.action === "init") {
      return { ok: true, action: "init", db: args.dbPath }
    }
    if (args.action === "record_cycle") {
      const cycle = buildCycleRun(args.json)
      upsertCycleRun(db, cycle)
      return { ok: true, action: args.action, cycle }
    }
    if (args.action === "record_job") {
      const job = buildJobRun(args.json)
      upsertJobRun(db, job)
      return { ok: true, action: args.action, job }
    }
    if (args.action === "record_message") {
      const message = buildDomainMessage(args.json)
      upsertDomainMessage(db, message)
      return { ok: true, action: args.action, message }
    }
    if (args.action === "record_incident") {
      const incident = buildIncident(args.json)
      recordIncident(db, incident)
      return { ok: true, action: args.action, incident }
    }
    if (args.action === "list_messages") {
      return { ok: true, action: args.action, messages: readDomainMessages(db, args.json) }
    }
    if (args.action === "list_incidents") {
      return { ok: true, action: args.action, incidents: readIncidents(db, args.json) }
    }
    if (args.action === "list_incident_events") {
      return { ok: true, action: args.action, events: readIncidentEvents(db, args.json) }
    }
    if (args.action === "update_incident") {
      const incident = updateIncidentStatus(db, args.json)
      return { ok: true, action: args.action, incident, events: readIncidentEvents(db, { incident_id: incident.incident_id }) }
    }
    if (args.action === "summary") {
      const cycleId = stringField(args.json.cycle_id)
      return { ok: true, action: args.action, summary: readCycleSummary(db, cycleId) }
    }
    throw new Error(`unsupported action: ${args.action}`)
  } finally {
    db.close()
  }
}

function printHelp(): void {
  console.log([
    "usage: bun src/scripts/main.ts --db data/ops_runtime.db --action init",
    "actions: init | record_cycle | record_job | record_message | list_messages | record_incident | list_incidents | update_incident | list_incident_events | summary",
  ].join("\n"))
}

if (import.meta.main) {
  try {
    const result = run(parseArgs(Bun.argv.slice(2)))
    console.log(JSON.stringify(result, null, 2))
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }))
    process.exit(1)
  }
}
