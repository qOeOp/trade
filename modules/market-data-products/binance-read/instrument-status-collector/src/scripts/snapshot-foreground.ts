#!/usr/bin/env bun

import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { asRecord, stringField } from "../../../../../contracts/runtime-core/src/json"
import { repoRoot } from "../../../../../contracts/runtime-core/src/paths"
import {
  classifyResidentWorkerFailure,
  parseBoundedInteger,
  waitForResidentWorkerBackoff,
  writeResidentWorkerState,
} from "../../../../../contracts/runtime-core/src/resident-worker"
import {
  compileMarketDataSubscriptionPlan,
  type MarketDataSubscriptionPlan,
} from "../../../../../contracts/market-data-demand-contract/src/market-data-demand-contract"

interface Args {
  marketDataDb: "data/market_data.db"
  maxSymbols: number
  maxJobsPerCycle: number
  refreshIntervalMs: number
  intervalMs: number
  commandTimeoutMs: number
  requestTimeoutMs: number
}

const STATE_SCHEMA = "trade.instrument-snapshot-worker-state.v1" as const

export function parseArgs(argv: string[]): Args {
  const values = new Map<string, string>()
  const allowed = new Set([
    "--market-data-db",
    "--max-symbols",
    "--max-jobs-per-cycle",
    "--refresh-interval-ms",
    "--interval-ms",
    "--command-timeout-ms",
    "--request-timeout-ms",
  ])
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (name == null || value == null || !name.startsWith("--")) {
      throw new Error(`incomplete argument: ${name ?? "<missing>"}`)
    }
    if (!allowed.has(name)) throw new Error(`unknown argument: ${name}`)
    if (values.has(name)) throw new Error(`duplicate argument: ${name}`)
    values.set(name, value)
  }
  const marketDataDb =
    values.get("--market-data-db") ?? "data/market_data.db"
  if (marketDataDb !== "data/market_data.db") {
    throw new Error("instrument snapshot worker database path is fixed")
  }
  return {
    marketDataDb,
    maxSymbols: parseBoundedInteger(
      values.get("--max-symbols") ?? "20",
      1, 100, "--max-symbols",
    ),
    maxJobsPerCycle: parseBoundedInteger(
      values.get("--max-jobs-per-cycle") ?? "4",
      1, 20, "--max-jobs-per-cycle",
    ),
    refreshIntervalMs: parseBoundedInteger(
      values.get("--refresh-interval-ms") ?? "900000",
      60_000, 1_200_000, "--refresh-interval-ms",
    ),
    intervalMs: parseBoundedInteger(
      values.get("--interval-ms") ?? "60000",
      5_000, 3_600_000, "--interval-ms",
    ),
    commandTimeoutMs: parseBoundedInteger(
      values.get("--command-timeout-ms") ?? "120000",
      5_000, 600_000, "--command-timeout-ms",
    ),
    requestTimeoutMs: parseBoundedInteger(
      values.get("--request-timeout-ms") ?? "10000",
      1_000, 60_000, "--request-timeout-ms",
    ),
  }
}

export function instrumentSnapshotJobs(
  plan: MarketDataSubscriptionPlan,
  recentlyObservedSymbols: Set<string>,
  maxJobs: number,
): string[] {
  if (plan.status !== "ready") return []
  return plan.selected_symbols
    .filter((symbol) => !recentlyObservedSymbols.has(symbol))
    .slice(0, maxJobs)
}

export async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv)
  const root = repoRoot()
  const statePath = resolve(
    root,
    "tmp/instrument-snapshot-worker/latest-state.json",
  )
  mkdirSync(dirname(statePath), { recursive: true, mode: 0o700 })
  let stopping = false
  let activeChild: ReturnType<typeof Bun.spawn> | undefined
  let cancelDelay: (() => void) | undefined
  let cycle = 0
  let consecutiveFailures = 0
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      stopping = true
      activeChild?.kill("SIGTERM")
      cancelDelay?.()
    })
  }
  const runJson = async (command: string[]) => {
    if (stopping) throw new Error("worker stopping")
    const child = Bun.spawn({
      cmd: command,
      cwd: root,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    })
    activeChild = child
    const stderrPromise = new Response(child.stderr).text()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGTERM")
    }, args.commandTimeoutMs)
    try {
      const [stdout, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        child.exited,
        stderrPromise,
      ])
      if (timedOut) throw new Error("instrument snapshot command timed out")
      if (exitCode !== 0) throw new Error("instrument snapshot command failed")
      return asRecord(JSON.parse(stdout))
    } finally {
      clearTimeout(timer)
      if (activeChild === child) activeChild = undefined
    }
  }
  try {
    while (!stopping) {
      cycle += 1
      const observedAt = new Date().toISOString()
      let targetCount = 0
      let freshCount = 0
      let executedCount = 0
      let failureCount = 0
      try {
        const planResponse = await runJson([
          process.execPath,
          resolve(
            root,
            "modules/market-data-products/market-data-store/src/scripts/main.ts",
          ),
          "--db", args.marketDataDb,
          "--action", "reconcile_market_data_demands",
          "--json", JSON.stringify({
            observed_at: observedAt,
            max_symbols: args.maxSymbols,
          }),
        ])
        if (planResponse.ok !== true
            || planResponse.action !== "reconcile_market_data_demands") {
          throw new Error("market data demand owner response identity drifted")
        }
        const plan = compileMarketDataSubscriptionPlan(planResponse.plan)
        targetCount = plan.selected_symbols.length
        const recent = new Set<string>()
        const lowerBound = new Date(
          Date.parse(observedAt) - args.refreshIntervalMs,
        ).toISOString()
        for (const symbol of plan.selected_symbols) {
          const response = await runJson([
            process.execPath,
            resolve(
              root,
              "modules/market-data-products/market-data-store/src/scripts/main.ts",
            ),
            "--db", args.marketDataDb,
            "--action", "resolve_current_instrument_snapshot",
            "--json", JSON.stringify({
              symbol,
              completed_at_gte: lowerBound,
              completed_at_lte: observedAt,
            }),
          ])
          if (response.ok !== true
              || response.action !== "resolve_current_instrument_snapshot") {
            throw new Error("current instrument owner response identity drifted")
          }
          if (response.receipt !== null) recent.add(symbol)
        }
        freshCount = recent.size
        const jobs = instrumentSnapshotJobs(
          plan,
          recent,
          args.maxJobsPerCycle,
        )
        const bucket = Math.floor(
          Date.parse(observedAt) / args.refreshIntervalMs,
        )
        for (const symbol of jobs) {
          try {
            const response = await runJson([
              process.execPath,
              resolve(
                root,
                "modules/market-data-products/binance-read/instrument-status-collector/src/scripts/main.ts",
              ),
              "--symbol", symbol,
              "--db", args.marketDataDb,
              "--acquisition-id",
              `demand-instrument-snapshot:${symbol}:${bucket}`,
              "--timeout-ms", String(args.requestTimeoutMs),
              "--max-attempts", "3",
            ])
            const data = asRecord(response.data)
            if (response.ok !== true
                || stringField(asRecord(data.receipt).symbol) !== symbol) {
              throw new Error("instrument snapshot collector identity drifted")
            }
            executedCount += 1
          } catch {
            failureCount += 1
          }
        }
        consecutiveFailures = failureCount === 0
          ? 0
          : consecutiveFailures + 1
        writeResidentWorkerState(statePath, {
          schema_version: STATE_SCHEMA,
          observed_at: new Date().toISOString(),
          status: failureCount === 0 ? "running" : "degraded",
          cycle,
          consecutive_failures: consecutiveFailures,
          source_plan_hash: plan.plan_hash,
          target_count: targetCount,
          fresh_target_count: freshCount,
          executed_job_count: executedCount,
          failed_job_count: failureCount,
          evidence_authority: "raw_current_snapshot_only",
          lifecycle_authority: "market_data_owner",
          trading_authority: false,
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
          target_count: targetCount,
          fresh_target_count: freshCount,
          executed_job_count: executedCount,
          failed_job_count: failureCount,
          evidence_authority: "raw_current_snapshot_only",
          lifecycle_authority: "market_data_owner",
          trading_authority: false,
        })
      }
      if (!stopping) {
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
      evidence_authority: "raw_current_snapshot_only",
      lifecycle_authority: "market_data_owner",
      trading_authority: false,
    })
  }
  return 0
}

if (import.meta.main) process.exit(await main(Bun.argv.slice(2)))
