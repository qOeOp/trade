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
  readRuntimeParityStatus,
  readDomainMessages,
  readIncidentEvents,
  readIncidents,
  recordIncident,
  releaseOpsLock,
  renewOpsLock,
  updateIncidentStatus,
  upsertCycleRun,
  upsertDomainMessage,
  upsertJobRun,
} from "../lib/ops-runtime-store"
import { stringField, type JSONRecord } from "../../../../contracts/runtime-core/src/json"
import { readDbActionJsonArgs, type DbActionJsonArgs } from "../../../../contracts/runtime-core/src/script-json"
import { assertDatabaseIdentity, buildDatabaseIdentity, ensureDatabaseIdentity } from "../../../../contracts/runtime-core/src/database-identity"
import {
  applyWatchTaskEvaluation,
  armWatchTask,
  cancelWatchTask,
  completeWatchTask,
  createWatchTask,
  handoffWatchTask,
  readWatchTask,
  readWatchTaskTransitions,
} from "../lib/watch-task-store"
import type { WatchTaskEvaluation } from "../../../../contracts/watch-task-contract/src/watch-task-contract"
import { displayPath } from "../../../../contracts/runtime-core/src/paths"
import {
  ensureAgentRunStoreSchema,
  readAgentRun,
  readAgentRunToolUsage,
  recordAgentRunToolCall,
} from "../lib/agent-run-store"

type Args = DbActionJsonArgs

export function parseArgs(argv: string[]): Args {
  return readDbActionJsonArgs(argv, { dbPath: "data/ops_runtime.db" }, printHelp)
}

export function run(args: Args): JSONRecord {
  if (args.action === "summary") {
    const db = new Database(args.dbPath, { readonly: true })
    try {
      assertDatabaseIdentity(db, buildDatabaseIdentity(args.environmentId, "ops_runtime_store"))
      const cycleId = stringField(args.json.cycle_id)
      return { ok: true, action: args.action, summary: readCycleSummary(db, cycleId) }
    } finally {
      db.close()
    }
  }
  if (args.action === "parity_status") {
    const db = new Database(args.dbPath, { readonly: true })
    try {
      assertDatabaseIdentity(db, buildDatabaseIdentity(args.environmentId, "ops_runtime_store"))
      const asOfText = stringField(args.json.as_of)
      return {
        ok: true,
        action: args.action,
        parity_status: readRuntimeParityStatus(db, asOfText ? new Date(asOfText) : new Date()),
      }
    } finally {
      db.close()
    }
  }
  const db = new Database(args.dbPath)
  try {
    ensureDatabaseIdentity(db, buildDatabaseIdentity(args.environmentId, "ops_runtime_store"), { allowLegacyMigration: args.migrateIdentity })
    ensureOpsRuntimeSchema(db)
    ensureAgentRunStoreSchema(db)
    if (args.action === "init") {
      return { ok: true, action: "init", db: displayPath(args.dbPath), environment_id: args.environmentId, store_id: "ops_runtime_store" }
    }
    if (args.action === "watch_create") {
      return { ok: true, action: args.action, watch_task: createWatchTask(db, args.json.definition) }
    }
    if (args.action === "watch_read") {
      const taskId = stringField(args.json.task_id)
      return {
        ok: true,
        action: args.action,
        watch_task: readWatchTask(db, taskId),
        transitions: readWatchTaskTransitions(db, taskId),
      }
    }
    if (args.action === "watch_arm") {
      return { ok: true, action: args.action, watch_task: armWatchTask(db, args.json) }
    }
    if (args.action === "watch_apply_evaluation") {
      return { ok: true, action: args.action, watch_task: applyWatchTaskEvaluation(db, {
        task_id: stringField(args.json.task_id),
        expected_version: Number(args.json.expected_version),
        evaluation: args.json.evaluation as unknown as WatchTaskEvaluation,
      }) }
    }
    if (args.action === "watch_handoff") {
      return { ok: true, action: args.action, watch_task: handoffWatchTask(db, args.json) }
    }
    if (args.action === "watch_complete") {
      return { ok: true, action: args.action, watch_task: completeWatchTask(db, args.json) }
    }
    if (args.action === "watch_cancel") {
      return { ok: true, action: args.action, watch_task: cancelWatchTask(db, args.json) }
    }
    if (args.action === "record_cycle") {
      const cycle = buildCycleRun(args.json)
      upsertCycleRun(db, cycle)
      return { ok: true, action: args.action, cycle }
    }
    if (args.action === "record_agent_tool_call") {
      return {
        ok: true,
        action: args.action,
        usage: recordAgentRunToolCall(db, {
          call_id: stringField(args.json.call_id),
          run_id: stringField(args.json.run_id),
          request_hash: stringField(args.json.request_hash),
          task_profile: stringField(args.json.task_profile) as "planner" | "developer" | "reviewer" | "explanation",
          tool_name: stringField(args.json.tool_name),
          occurred_at: stringField(args.json.occurred_at),
        }),
      }
    }
    if (args.action === "read_agent_tool_usage") {
      return {
        ok: true,
        action: args.action,
        usage: readAgentRunToolUsage(
          db,
          stringField(args.json.run_id),
          stringField(args.json.request_hash),
        ),
      }
    }
    if (args.action === "read_agent_run") {
      const runId = stringField(args.json.run_id)
      const agentRun = readAgentRun(db, runId)
      if (!agentRun) throw new Error(`Agent Run not found: ${runId}`)
      return { ok: true, action: args.action, agent_run: agentRun }
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
    if (args.action === "renew_lock") {
      return { ok: true, action: args.action, ...renewOpsLock(db, {
        lock_key: stringField(args.json.lock_key),
        holder_id: stringField(args.json.holder_id),
        fencing_token: Number(args.json.fencing_token),
        renewed_at: stringField(args.json.renewed_at),
        expires_at: stringField(args.json.expires_at),
      }) }
    }
    if (args.action === "release_lock") {
      return { ok: true, action: args.action, released: releaseOpsLock(
        db,
        stringField(args.json.lock_key),
        stringField(args.json.holder_id),
        Number(args.json.fencing_token),
      ) }
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
    "actions: init | record_cycle | record_job | record_message | list_messages | record_incident | list_incidents | update_incident | list_incident_events | acquire_lock | read_lock | renew_lock | release_lock | summary | parity_status | record_agent_tool_call | read_agent_tool_usage | read_agent_run | watch_create | watch_read | watch_arm | watch_apply_evaluation | watch_handoff | watch_complete | watch_cancel",
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
