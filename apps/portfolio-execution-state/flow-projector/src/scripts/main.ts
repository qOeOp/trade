#!/usr/bin/env bun

import { Database } from "bun:sqlite"
import { buildLogicalStoreRef } from "../../../../contracts/protocol-fabric/src/protocol-fabric"
import { assertProjectRuntimePath, repoRoot } from "../../../../contracts/runtime-core/src/paths"
import { asRecord } from "../../../../contracts/runtime-core/src/json"
import { errorResponse, printScriptResult, readFlagValue, readJsonObject, successResponse } from "../../../../contracts/runtime-core/src/script-json"
import { buildDatabaseIdentity, ensureDatabaseIdentity } from "../../../../contracts/runtime-core/src/database-identity"
import { ensureSchema } from "../../../event-store/src/lib/event-store"
import {
  applyReconcileDrafts,
  buildPortfolioAccountProjection,
  findActiveLaneConflicts,
  listActiveFlows,
  readLatestSlowObserve,
  reduceFlowState,
} from "../lib/flow-projector"

type JSONRecord = Record<string, unknown>

interface Config {
  dbPath: string
  mode: "reduce-flow" | "active-flows" | "latest-slow-observe" | "portfolio-account" | "apply-reconcile" | ""
  chainId: string
  accountRef: string
  accountScope: string
  symbol: string
  asOf: string
  yes: boolean
  environmentId: string
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
    const db = new Database(config.dbPath)
    try {
      ensureDatabaseIdentity(db, buildDatabaseIdentity(config.environmentId, "trade_event_store"))
      ensureSchema(db)
      if (config.mode === "reduce-flow") {
        return successResponse("flow-projector.script-response.v1", withReadModelRef(
          reduceFlowState(db, config.chainId),
          config.dbPath,
          `flow_read_models:flow/${config.chainId}`,
          "state.flow-projector --reduce-flow",
        ))
      }
      if (config.mode === "active-flows") {
        const active_flows = listActiveFlows(db)
        return successResponse("flow-projector.script-response.v1", withReadModelRef({
          active_flow_count: active_flows.length,
          active_flows,
          lane_conflicts: findActiveLaneConflicts(active_flows),
        }, config.dbPath, "flow_read_models:active-flows", "state.flow-projector --active-flows"))
      }
      if (config.mode === "latest-slow-observe") {
        const observe = readLatestSlowObserve(db, config.chainId)
        return successResponse("flow-projector.script-response.v1", observe ? withReadModelRef(
          observe,
          config.dbPath,
          `flow_read_models:latest-slow-observe/${config.chainId}`,
          "state.flow-projector --latest-slow-observe",
        ) : null)
      }
      if (config.mode === "portfolio-account") {
        return successResponse("flow-projector.script-response.v1", withReadModelRef(
          buildPortfolioAccountProjection(db, {
            account_ref: config.accountRef,
            account_scope: config.accountScope,
            symbol: config.symbol || undefined,
            as_of: config.asOf || undefined,
          }),
          config.dbPath,
          `flow_read_models:portfolio-account/${config.accountScope}`,
          "state.flow-projector --portfolio-account",
        ))
      }
      if (config.mode === "apply-reconcile") return successResponse("flow-projector.script-response.v1", applyReconcileDrafts(db, config.input, config.yes))
      throw new Error("provide --reduce-flow, --active-flows, --latest-slow-observe, --portfolio-account, or --apply-reconcile")
    } finally {
      db.close()
    }
  } catch (error) {
    return errorResponse("flow-projector.script-response.v1", error)
  } finally {
    process.chdir(previousCwd)
  }
}

function parseArgs(argv: string[]): Config {
  const config: Config = {
    dbPath: "./data/trade.db",
    mode: "",
    chainId: "",
    accountRef: "",
    accountScope: "",
    symbol: "",
    asOf: "",
    yes: false,
    environmentId: "local:local",
    input: {},
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case "--reduce-flow": config.mode = "reduce-flow"; break
      case "--active-flows": config.mode = "active-flows"; break
      case "--latest-slow-observe": config.mode = "latest-slow-observe"; break
      case "--portfolio-account": config.mode = "portfolio-account"; break
      case "--apply-reconcile": config.mode = "apply-reconcile"; break
      case "--yes": config.yes = true; break
      case "--db": config.dbPath = readFlagValue(argv, ++index, arg); break
      case "--environment-id": config.environmentId = readFlagValue(argv, ++index, arg); break
      case "--chain-id": config.chainId = readFlagValue(argv, ++index, arg); break
      case "--account-ref": config.accountRef = readFlagValue(argv, ++index, arg); break
      case "--account-scope": config.accountScope = readFlagValue(argv, ++index, arg); break
      case "--symbol": config.symbol = readFlagValue(argv, ++index, arg); break
      case "--as-of": config.asOf = readFlagValue(argv, ++index, arg); break
      case "--json": config.input = readJsonObject(readFlagValue(argv, ++index, arg)); break
      case "--help": printHelp(); return process.exit(0)
      default: throw new Error(`unknown flag: ${arg}`)
    }
  }
  return config
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

function printHelp(): void {
  console.log(`Usage:
  bun src/scripts/main.ts --active-flows --db ./data/trade.db
  bun src/scripts/main.ts --reduce-flow --db ./data/trade.db --chain-id flow-1
  bun src/scripts/main.ts --latest-slow-observe --db ./data/trade.db --chain-id flow-1
  bun src/scripts/main.ts --portfolio-account --db ./data/trade.db --account-ref exchange-account://binance/live/usdm/primary --account-scope capital-scope://retail-small-usdm --symbol BTCUSDT
`)
}

if (import.meta.main) main(process.argv.slice(2))
