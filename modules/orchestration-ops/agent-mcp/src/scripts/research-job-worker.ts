#!/usr/bin/env bun

import { executeOwnerCli } from "../lib/owner-cli"

type JSONRecord = Record<string, unknown>

interface WorkerInput {
  cycle_id: string
  holder_id: string
  lock_key: string
  trade_db_path: string
  ops_runtime_db: string
  job_graph: JSONRecord
}

async function main(argv: string[]): Promise<void> {
  const input = parseInput(argv)
  try {
    await executeOwnerCli({
      script: "modules/orchestration-ops/trade-flow/src/scripts/main.ts",
      args: ["--db", input.trade_db_path, "--run-job-graph", "--json", JSON.stringify(input.job_graph)],
    }, { timeoutMs: 6 * 60 * 60 * 1000, maxOutputBytes: 10_000_000 })
  } catch (error) {
    await recordWorkerFailure(input, error)
    throw error
  } finally {
    await runOps(input, "release_lock", { lock_key: input.lock_key, holder_id: input.holder_id }).catch(() => undefined)
  }
}

async function recordWorkerFailure(input: WorkerInput, error: unknown): Promise<void> {
  const existing: JSONRecord = await runOps(input, "summary", { cycle_id: input.cycle_id }).catch(() => ({}))
  const cycle = asRecord(asRecord(existing.summary).cycle)
  if (["completed", "failed", "blocked"].includes(stringField(cycle.status))) return
  await runOps(input, "record_cycle", {
    cycle_id: input.cycle_id,
    now: stringField(cycle.triggered_at) || new Date().toISOString(),
    completed_at: new Date().toISOString(),
    status: "failed",
    summary: { phase: "worker_failed", error: error instanceof Error ? error.message : String(error) },
  })
}

function runOps(input: WorkerInput, action: string, payload: JSONRecord): Promise<JSONRecord> {
  return executeOwnerCli({
    script: "modules/orchestration-ops/ops-runtime-store/src/scripts/main.ts",
    args: ["--db", input.ops_runtime_db, "--action", action, "--json", JSON.stringify(payload)],
  })
}

function parseInput(argv: string[]): WorkerInput {
  if (argv[0] !== "--json" || !argv[1]) throw new Error("research job worker requires --json")
  const input = JSON.parse(argv[1]) as WorkerInput
  for (const field of ["cycle_id", "holder_id", "lock_key", "trade_db_path", "ops_runtime_db"] as const) {
    if (!stringField(input[field])) throw new Error(`research job worker requires ${field}`)
  }
  if (!input.job_graph || typeof input.job_graph !== "object" || Array.isArray(input.job_graph)) {
    throw new Error("research job worker requires job_graph")
  }
  return input
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
