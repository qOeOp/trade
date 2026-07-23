#!/usr/bin/env bun

import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { asRecord, stringField } from "../../../../contracts/runtime-core/src/json"
import { repoRoot } from "../../../../contracts/runtime-core/src/paths"
import {
  classifyResidentWorkerFailure,
  parseBoundedInteger,
  waitForResidentWorkerBackoff,
  writeResidentWorkerState,
} from "../../../../contracts/runtime-core/src/resident-worker"
import { compileMarketDataSubscriptionPlan } from "../../../../contracts/market-data-demand-contract/src/market-data-demand-contract"
import { compileOhlcvCoverageAudit } from "../../../../contracts/market-data-demand-contract/src/ohlcv-coverage-contract"
import { runOhlcvDemandCycle } from "../lib/worker-cycle"

interface Args {
  marketDataDb: "data/market_data.db"
  ohlcvDb: "data/ohlcv.db"
  maxSymbols: number
  maxJobsPerCycle: number
  maxRowsPerJob: number
  intervalMs: number
  commandTimeoutMs: number
}

const STATE_SCHEMA = "trade.ohlcv-demand-worker-state.v1" as const

export function parseArgs(argv: string[]): Args {
  const values = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (name == null || value == null || !name.startsWith("--")) throw new Error(`incomplete argument: ${name ?? "<missing>"}`)
    if (values.has(name)) throw new Error(`duplicate argument: ${name}`)
    if (!new Set([
      "--market-data-db", "--ohlcv-db", "--max-symbols", "--max-jobs-per-cycle",
      "--max-rows-per-job", "--interval-ms", "--command-timeout-ms",
    ]).has(name)) throw new Error(`unknown argument: ${name}`)
    values.set(name, value)
  }
  const marketDataDb = values.get("--market-data-db") ?? "data/market_data.db"
  const ohlcvDb = values.get("--ohlcv-db") ?? "data/ohlcv.db"
  if (marketDataDb !== "data/market_data.db" || ohlcvDb !== "data/ohlcv.db") {
    throw new Error("OHLCV worker database paths are fixed")
  }
  return {
    marketDataDb,
    ohlcvDb,
    maxSymbols: parseBoundedInteger(values.get("--max-symbols") ?? "20", 1, 100, "--max-symbols"),
    maxJobsPerCycle: parseBoundedInteger(values.get("--max-jobs-per-cycle") ?? "4", 1, 20, "--max-jobs-per-cycle"),
    maxRowsPerJob: parseBoundedInteger(values.get("--max-rows-per-job") ?? "10000", 1, 100_000, "--max-rows-per-job"),
    intervalMs: parseBoundedInteger(values.get("--interval-ms") ?? "60000", 5_000, 3_600_000, "--interval-ms"),
    commandTimeoutMs: parseBoundedInteger(values.get("--command-timeout-ms") ?? "120000", 5_000, 600_000, "--command-timeout-ms"),
  }
}

export async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv)
  const root = repoRoot()
  const statePath = resolve(root, "tmp/ohlcv-demand-worker/latest-state.json")
  mkdirSync(dirname(statePath), { recursive: true, mode: 0o700 })
  let stopRequested = false
  let currentChild: ReturnType<typeof Bun.spawn> | undefined
  let cancelDelay: (() => void) | undefined
  let cycle = 0
  let consecutiveFailures = 0
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      stopRequested = true
      currentChild?.kill("SIGTERM")
      cancelDelay?.()
    })
  }
  const runJson = async (command: string[]): Promise<Record<string, unknown>> => {
    if (stopRequested) throw new Error("worker stopping")
    const child = Bun.spawn({ cmd: command, cwd: root, stdin: "ignore", stdout: "pipe", stderr: "pipe" })
    currentChild = child
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGTERM")
    }, args.commandTimeoutMs)
    try {
      const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited])
      if (timedOut) throw new Error("owner command timed out")
      if (exitCode !== 0) throw new Error("owner command failed")
      return asRecord(JSON.parse(stdout))
    } finally {
      clearTimeout(timer)
      if (currentChild === child) currentChild = undefined
    }
  }
  try {
    while (!stopRequested) {
      cycle += 1
      const observedAt = new Date().toISOString()
      try {
        const result = await runOhlcvDemandCycle({
          observed_at: observedAt,
          max_jobs: args.maxJobsPerCycle,
          max_rows_per_job: args.maxRowsPerJob,
        }, {
          read_subscription_plan: async () => {
            const response = await runJson([
              process.execPath,
              resolve(root, "modules/market-data-products/market-data-store/src/scripts/main.ts"),
              "--db", args.marketDataDb,
              "--ohlcv-db", args.ohlcvDb,
              "--action", "reconcile_market_data_demands",
              "--json", JSON.stringify({ observed_at: observedAt, max_symbols: args.maxSymbols }),
            ])
            if (response.ok !== true || response.action !== "reconcile_market_data_demands") {
              throw new Error("market data demand owner response identity drifted")
            }
            return compileMarketDataSubscriptionPlan(response.plan)
          },
          audit_coverage: async (target) => {
            const response = await runJson([
              process.execPath,
              resolve(root, "modules/market-data-products/market-data-store/src/scripts/main.ts"),
              "--db", args.marketDataDb,
              "--ohlcv-db", args.ohlcvDb,
              "--action", "audit_candle_coverage",
              "--json", JSON.stringify({
                exchange: "binanceusdm",
                symbol: target.symbol,
                timeframe: target.timeframe,
                start_open_time: target.start_open_time,
                end_open_time: target.end_open_time,
                observed_at: observedAt,
              }),
            ])
            if (response.ok !== true || response.action !== "audit_candle_coverage") {
              throw new Error("OHLCV coverage owner response identity drifted")
            }
            return compileOhlcvCoverageAudit(response.audit)
          },
          fetch_gap: async (job) => {
            try {
              const response = await runJson([
                process.execPath,
                resolve(root, "modules/market-data-products/ohlcv-fetch/src/scripts/main.ts"),
                "--symbol", job.symbol,
                "--timeframes", job.timeframe,
                "--since-ts", String(job.since_ts),
                "--limit", String(job.limit),
                "--market-data-db", args.marketDataDb,
                "--ohlcv-db", args.ohlcvDb,
              ])
              const data = asRecord(response.data)
              const ok = response.ok === true
                && stringField(data.requested_symbol).toUpperCase() === job.symbol
                && asRecord(data.timeframes)[job.timeframe] != null
              return { ok, reason: ok ? "owner_fetch_completed" : "owner_fetch_identity_drifted" }
            } catch (error) {
              return { ok: false, reason: classifyResidentWorkerFailure(error, "public") }
            }
          },
        })
        consecutiveFailures = result.status === "completed" ? 0 : consecutiveFailures + 1
        writeResidentWorkerState(statePath, {
          schema_version: STATE_SCHEMA,
          observed_at: new Date().toISOString(),
          status: result.status === "completed" ? "running" : "degraded",
          cycle,
          consecutive_failures: consecutiveFailures,
          source_plan_hash: result.source_plan_hash,
          sync_plan_hash: result.sync_plan_hash,
          target_count: result.target_count,
          complete_target_count: result.complete_target_count,
          planned_job_count: result.planned_job_count,
          executed_job_count: result.executed_job_count,
          failed_job_count: result.failed_job_count,
          deferred_job_count: result.deferred_job_count,
          lifecycle_authority: "market_data_owner",
        })
      } catch (error) {
        consecutiveFailures += 1
        writeResidentWorkerState(statePath, {
          schema_version: STATE_SCHEMA,
          observed_at: new Date().toISOString(),
          status: "degraded",
          cycle,
          consecutive_failures: consecutiveFailures,
          failure_class: classifyResidentWorkerFailure(error, "public"),
          lifecycle_authority: "market_data_owner",
        })
      }
      if (!stopRequested) {
        await waitForResidentWorkerBackoff(
          args.intervalMs,
          consecutiveFailures,
          (cancel) => { cancelDelay = cancel },
        )
        cancelDelay = undefined
      }
    }
  } finally {
    writeResidentWorkerState(statePath, {
      schema_version: STATE_SCHEMA,
      observed_at: new Date().toISOString(),
      status: "stopped",
      cycle,
      consecutive_failures: consecutiveFailures,
      lifecycle_authority: "market_data_owner",
    })
  }
  return 0
}

if (import.meta.main) process.exit(await main(Bun.argv.slice(2)))
