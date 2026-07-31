#!/usr/bin/env bun

import { Database } from "bun:sqlite"
import { dirname } from "node:path"
import { mkdirSync } from "node:fs"
import { assertProjectRuntimePath, displayPath, repoRoot } from "../../../../contracts/runtime-core/src/paths"
import { stringField } from "../../../../contracts/runtime-core/src/json"
import { errorResponse, printScriptResult, readFlagValue, readJsonObject, successResponse } from "../../../../contracts/runtime-core/src/script-json"
import { buildDatabaseIdentity, ensureDatabaseIdentity } from "../../../../contracts/runtime-core/src/database-identity"
import {
  appendPlanEvent,
  buildOrderFillEvent,
  buildReviewEvent,
  ensureSchema,
  readFlowEvents,
  readLatestOrderFill,
  listChainIds,
  type PlanEvent,
} from "../lib/event-store"

type JSONRecord = Record<string, unknown>

interface Config {
  dbPath: string
  mode:
    | "init"
    | "append-event"
    | "append-event-envelope"
    | "append-order-fill"
    | "append-review"
    | "list-chain-ids"
    | "read-flow-events"
    | "read-latest-order-fill"
    | ""
  chainId: string
  environmentId: string
  migrateIdentity: boolean
  input: JSONRecord
}

function main(argv: string[]): void {
  const result = run(argv)
  printScriptResult(result)
}

export function run(argv: string[]): JSONRecord {
  const previousCwd = process.cwd()
  try {
    process.chdir(repoRoot())
    const config = parseArgs(argv)
    assertProjectRuntimePath(config.dbPath)
    mkdirSync(dirname(config.dbPath), { recursive: true })
    const db = new Database(config.dbPath)
    try {
      ensureDatabaseIdentity(db, buildDatabaseIdentity(config.environmentId, "trade_event_store"), { allowLegacyMigration: config.migrateIdentity })
      ensureSchema(db)
      if (config.mode === "init") {
        return successResponse("event-store.script-response.v1", {
          initialized: true,
          dbPath: displayPath(config.dbPath),
          environment_id: config.environmentId,
          store_id: "trade_event_store",
        })
      }
      if (config.mode === "append-event") {
        const event = config.input as unknown as PlanEvent
        appendPlanEvent(db, event)
        return successResponse("event-store.script-response.v1", event)
      }
      if (config.mode === "append-event-envelope") {
        const { envelope, event } = readEventWriteEnvelope(config.input)
        appendPlanEvent(db, event)
        return successResponse("event-store.script-response.v1", { ...envelope, event_inline: event })
      }
      if (config.mode === "append-order-fill") {
        const event = buildOrderFillEvent(config.input)
        appendPlanEvent(db, event)
        return successResponse("event-store.script-response.v1", event)
      }
      if (config.mode === "append-review") {
        const event = buildReviewEvent(config.input)
        appendPlanEvent(db, event)
        return successResponse("event-store.script-response.v1", event)
      }
      if (config.mode === "list-chain-ids") {
        return successResponse("event-store.script-response.v1", listChainIds(db))
      }
      if (config.mode === "read-flow-events") {
        return successResponse("event-store.script-response.v1", readFlowEvents(db, config.chainId))
      }
      if (config.mode === "read-latest-order-fill") {
        return successResponse("event-store.script-response.v1", readLatestOrderFill(db, config.chainId))
      }
      throw new Error("provide --init, --append-event, --append-event-envelope, --append-order-fill, --append-review, --list-chain-ids, --read-flow-events, or --read-latest-order-fill")
    } finally {
      db.close()
    }
  } catch (error) {
    return errorResponse("event-store.script-response.v1", error)
  } finally {
    process.chdir(previousCwd)
  }
}

function parseArgs(argv: string[]): Config {
  const config: Config = { dbPath: "./data/trade.db", mode: "", chainId: "", environmentId: "local:local", migrateIdentity: false, input: {} }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case "--init": config.mode = "init"; break
      case "--append-event": config.mode = "append-event"; break
      case "--append-event-envelope": config.mode = "append-event-envelope"; break
      case "--append-order-fill": config.mode = "append-order-fill"; break
      case "--append-review": config.mode = "append-review"; break
      case "--list-chain-ids": config.mode = "list-chain-ids"; break
      case "--read-flow-events": config.mode = "read-flow-events"; break
      case "--read-latest-order-fill": config.mode = "read-latest-order-fill"; break
      case "--db": config.dbPath = readFlagValue(argv, ++index, arg); break
      case "--environment-id": config.environmentId = readFlagValue(argv, ++index, arg); break
      case "--migrate-database-identity": config.migrateIdentity = true; break
      case "--chain-id": config.chainId = readFlagValue(argv, ++index, arg); break
      case "--json": config.input = readJsonObject(readFlagValue(argv, ++index, arg)); break
      case "--help": printHelp(); return process.exit(0)
      default: throw new Error(`unknown flag: ${arg}`)
    }
  }
  if (config.migrateIdentity && config.mode !== "init") throw new Error("--migrate-database-identity requires --init")
  return config
}

function readEventWriteEnvelope(input: JSONRecord): { envelope: JSONRecord; event: PlanEvent } {
  if (input.schema_version !== "trade.protocol.event-write-envelope.v1") {
    throw new Error("event_write_envelope.schema_version must be trade.protocol.event-write-envelope.v1")
  }
  if (input.owner_store !== "trade_event_store") {
    throw new Error("event_write_envelope.owner_store must be trade_event_store")
  }
  const event = readPlanEvent(input.event_inline)
  const eventKind = stringField(input.event_kind)
  if (eventKind !== event.kind) {
    throw new Error("event_write_envelope.event_kind must match event_inline.kind")
  }
  if (!stringField(input.event_ref)) {
    throw new Error("event_write_envelope.event_ref is required")
  }
  if (!stringField(input.idempotency_key)) {
    throw new Error("event_write_envelope.idempotency_key is required")
  }
  return { envelope: input, event }
}

function readPlanEvent(value: unknown): PlanEvent {
  const event = value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
  return {
    event_key: stringField(event.event_key),
    chain_id: stringField(event.chain_id),
    kind: stringField(event.kind) as PlanEvent["kind"],
    body_json: readBody(event.body_json),
    created_at: stringField(event.created_at),
  }
}

function readBody(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

function printHelp(): void {
  console.log(`Usage:
  bun src/scripts/main.ts --init --db ./data/trade.db
  bun src/scripts/main.ts --append-event --db ./data/trade.db --json '{...}'
  bun src/scripts/main.ts --append-event-envelope --db ./data/trade.db --json '{...}'
  bun src/scripts/main.ts --list-chain-ids --db ./data/trade.db
  bun src/scripts/main.ts --read-flow-events --db ./data/trade.db --chain-id flow-1
  bun src/scripts/main.ts --read-latest-order-fill --db ./data/trade.db --chain-id flow-1
`)
}

if (import.meta.main) {
  main(process.argv.slice(2))
}
