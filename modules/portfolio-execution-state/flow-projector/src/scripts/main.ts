#!/usr/bin/env bun

import { Database } from "bun:sqlite"
import { buildLogicalStoreRef } from "../../../../contracts/protocol-fabric/src/protocol-fabric"
import { assertProjectRuntimePath, repoRoot } from "../../../../contracts/runtime-core/src/paths"
import { ensureSchema } from "../../../event-store/src/lib/event-store"
import {
  applyReconcileDrafts,
  findActiveLaneConflicts,
  listActiveFlows,
  readLatestSlowObserve,
  reduceFlowState,
} from "../lib/flow-projector"

type JSONRecord = Record<string, unknown>

interface Config {
  dbPath: string
  mode: "reduce-flow" | "active-flows" | "latest-slow-observe" | "apply-reconcile" | ""
  chainId: string
  yes: boolean
  input: JSONRecord
}

function main(argv: string[]): void {
  const result = run(argv)
  console.log(JSON.stringify(result, null, 2))
  if (!result.ok) process.exit(1)
}

export function run(argv: string[]): JSONRecord {
  const previousCwd = process.cwd()
  try {
    process.chdir(repoRoot())
    const config = parseArgs(argv)
    assertProjectRuntimePath(config.dbPath)
    const db = new Database(config.dbPath)
    try {
      ensureSchema(db)
      if (config.mode === "reduce-flow") {
        return successResponse(withReadModelRef(
          reduceFlowState(db, config.chainId),
          config.dbPath,
          `flow_read_models:flow/${config.chainId}`,
          "state.flow-projector --reduce-flow",
        ))
      }
      if (config.mode === "active-flows") {
        const active_flows = listActiveFlows(db)
        return successResponse(withReadModelRef({
          active_flow_count: active_flows.length,
          active_flows,
          lane_conflicts: findActiveLaneConflicts(active_flows),
        }, config.dbPath, "flow_read_models:active-flows", "state.flow-projector --active-flows"))
      }
      if (config.mode === "latest-slow-observe") {
        const observe = readLatestSlowObserve(db, config.chainId)
        return successResponse(observe ? withReadModelRef(
          observe,
          config.dbPath,
          `flow_read_models:latest-slow-observe/${config.chainId}`,
          "state.flow-projector --latest-slow-observe",
        ) : null)
      }
      if (config.mode === "apply-reconcile") return successResponse(applyReconcileDrafts(db, config.input, config.yes))
      throw new Error("provide --reduce-flow, --active-flows, --latest-slow-observe, or --apply-reconcile")
    } finally {
      db.close()
    }
  } catch (error) {
    return errorResponse(error)
  } finally {
    process.chdir(previousCwd)
  }
}

function parseArgs(argv: string[]): Config {
  const config: Config = { dbPath: "./data/trade.db", mode: "", chainId: "", yes: false, input: {} }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case "--reduce-flow": config.mode = "reduce-flow"; break
      case "--active-flows": config.mode = "active-flows"; break
      case "--latest-slow-observe": config.mode = "latest-slow-observe"; break
      case "--apply-reconcile": config.mode = "apply-reconcile"; break
      case "--yes": config.yes = true; break
      case "--db": config.dbPath = readValue(argv, ++index, arg); break
      case "--chain-id": config.chainId = readValue(argv, ++index, arg); break
      case "--json": config.input = readJson(readValue(argv, ++index, arg)); break
      case "--help": printHelp(); return process.exit(0)
      default: throw new Error(`unknown flag: ${arg}`)
    }
  }
  return config
}

function readValue(argv: string[], index: number, name: string): string {
  const value = argv[index]
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`)
  return value
}

function readJson(raw: string): JSONRecord {
  const parsed = JSON.parse(raw)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("input JSON must be an object")
  return parsed as JSONRecord
}

function withReadModelRef(data: unknown, dbPath: string, ref: string, entrypoint: string): JSONRecord {
  return {
    ...asRecord(data),
    read_model_ref: buildLogicalStoreRef({
      store: "flow_read_models",
      owner_domain: "portfolio-execution-state",
      owner_module: "flow-projector",
      ref,
      mode: "derived",
      entrypoint,
      path: dbPath,
      table: "plan_event",
      as_of: new Date().toISOString(),
    }),
  }
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

function successResponse(data: unknown): JSONRecord {
  return { ok: true, schema_version: "flow-projector.script-response.v1", data }
}

function errorResponse(error: unknown): JSONRecord {
  const message = error instanceof Error ? error.message : String(error)
  return { ok: false, schema_version: "flow-projector.script-response.v1", error: message }
}

function printHelp(): void {
  console.log(`Usage:
  bun src/scripts/main.ts --active-flows --db ./data/trade.db
  bun src/scripts/main.ts --reduce-flow --db ./data/trade.db --chain-id flow-1
  bun src/scripts/main.ts --latest-slow-observe --db ./data/trade.db --chain-id flow-1
`)
}

if (import.meta.main) main(process.argv.slice(2))
