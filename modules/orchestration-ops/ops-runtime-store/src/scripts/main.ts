#!/usr/bin/env bun

import { Database } from "bun:sqlite"
import {
  buildCycleRun,
  acquireOpsLock,
  buildDomainMessage,
  buildIncident,
  buildJobRun,
  ensureOpsRuntimeSchema,
  readCycleSummary,
  readOpsLock,
  readDomainMessages,
  readIncidentEvents,
  readIncidents,
  recordIncident,
  releaseOpsLock,
  updateIncidentStatus,
  upsertCycleRun,
  upsertDomainMessage,
  upsertJobRun,
} from "../lib/ops-runtime-store"
import { stringField, type JSONRecord } from "../../../../contracts/runtime-core/src/json"
import { readDbActionJsonArgs, type DbActionJsonArgs } from "../../../../contracts/runtime-core/src/script-json"

type Args = DbActionJsonArgs

export function parseArgs(argv: string[]): Args {
  return readDbActionJsonArgs(argv, { dbPath: "data/ops_runtime.db" }, printHelp)
}

export function run(args: Args): JSONRecord {
  if (args.action === "summary") {
    const db = new Database(args.dbPath, { readonly: true })
    try {
      const cycleId = stringField(args.json.cycle_id)
      return { ok: true, action: args.action, summary: readCycleSummary(db, cycleId) }
    } finally {
      db.close()
    }
  }
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
    if (args.action === "acquire_lock") {
      return { ok: true, action: args.action, ...acquireOpsLock(db, {
        lock_key: stringField(args.json.lock_key),
        holder_id: stringField(args.json.holder_id),
        acquired_at: stringField(args.json.acquired_at),
        expires_at: stringField(args.json.expires_at),
      }) }
    }
    if (args.action === "read_lock") {
      return { ok: true, action: args.action, lock: readOpsLock(db, stringField(args.json.lock_key)) }
    }
    if (args.action === "release_lock") {
      return { ok: true, action: args.action, released: releaseOpsLock(db, stringField(args.json.lock_key), stringField(args.json.holder_id)) }
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
    throw new Error(`unsupported action: ${args.action}`)
  } finally {
    db.close()
  }
}

function printHelp(): void {
  console.log([
    "usage: bun src/scripts/main.ts --db data/ops_runtime.db --action init",
    "actions: init | record_cycle | record_job | record_message | list_messages | record_incident | list_incidents | update_incident | list_incident_events | acquire_lock | read_lock | release_lock | summary",
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
