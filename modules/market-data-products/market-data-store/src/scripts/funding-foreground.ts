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
import { compileFundingCoverageAudit } from "../../../../contracts/market-data-demand-contract/src/funding-coverage-contract"
import type { FundingCoverageResolution, FundingCoverageTarget } from "../lib/funding-demand-plan"
import { runFundingDemandCycle } from "../lib/funding-demand-worker"

interface Args {
  marketDataDb: "data/market_data.db"
  maxSymbols: number
  maxJobsPerCycle: number
  intervalMs: number
  commandTimeoutMs: number
  requestTimeoutMs: number
}

interface FetchResponse {
  ok: boolean
  status: number
  text: () => Promise<string>
}

type Fetcher = (input: string, init: { signal: AbortSignal }) => Promise<FetchResponse>

const STATE_SCHEMA = "trade.funding-demand-worker-state.v1" as const
const FUNDING_ENDPOINT = "https://fapi.binance.com/fapi/v1/fundingRate"

export function parseArgs(argv: string[]): Args {
  const values = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (name == null || value == null || !name.startsWith("--")) throw new Error(`incomplete argument: ${name ?? "<missing>"}`)
    if (values.has(name)) throw new Error(`duplicate argument: ${name}`)
    if (!new Set([
      "--market-data-db", "--max-symbols", "--max-jobs-per-cycle", "--interval-ms",
      "--command-timeout-ms", "--request-timeout-ms",
    ]).has(name)) throw new Error(`unknown argument: ${name}`)
    values.set(name, value)
  }
  const marketDataDb = values.get("--market-data-db") ?? "data/market_data.db"
  if (marketDataDb !== "data/market_data.db") throw new Error("funding worker database path is fixed")
  return {
    marketDataDb,
    maxSymbols: parseBoundedInteger(values.get("--max-symbols") ?? "20", 1, 100, "--max-symbols"),
    maxJobsPerCycle: parseBoundedInteger(values.get("--max-jobs-per-cycle") ?? "2", 1, 20, "--max-jobs-per-cycle"),
    intervalMs: parseBoundedInteger(values.get("--interval-ms") ?? "60000", 5_000, 3_600_000, "--interval-ms"),
    commandTimeoutMs: parseBoundedInteger(values.get("--command-timeout-ms") ?? "120000", 5_000, 600_000, "--command-timeout-ms"),
    requestTimeoutMs: parseBoundedInteger(values.get("--request-timeout-ms") ?? "30000", 1_000, 120_000, "--request-timeout-ms"),
  }
}

export async function fetchFundingWindow(
  target: FundingCoverageTarget,
  requestTimeoutMs: number,
  fetcher: Fetcher = fetch,
): Promise<Array<{ requested_start_ms: number; requested_end_ms: number; response_body: string }>> {
  const endInclusive = Date.parse(target.coverage_end) - 1
  let cursor = Date.parse(target.coverage_start)
  const pages: Array<{ requested_start_ms: number; requested_end_ms: number; response_body: string }> = []
  for (let ordinal = 0; ordinal < 10_000; ordinal += 1) {
    if (cursor > endInclusive) throw new Error("funding pagination advanced beyond the exact window without closure")
    const url = new URL(FUNDING_ENDPOINT)
    url.searchParams.set("symbol", target.symbol)
    url.searchParams.set("startTime", String(cursor))
    url.searchParams.set("endTime", String(endInclusive))
    url.searchParams.set("limit", "1000")
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs)
    let response: FetchResponse
    try {
      response = await fetcher(url.toString(), { signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }
    const body = await response.text()
    if (!response.ok) throw new Error(`funding provider HTTP ${response.status}`)
    if (body.length > 2_000_000) throw new Error("funding provider response exceeds bounds")
    const rows = JSON.parse(body) as unknown
    if (!Array.isArray(rows) || rows.length > 1_000) throw new Error("funding provider response is not a bounded array")
    pages.push({
      requested_start_ms: cursor,
      requested_end_ms: endInclusive,
      response_body: body,
    })
    if (rows.length < 1_000) return pages
    const last = asRecord(rows.at(-1))
    const lastTime = Number(last.fundingTime)
    if (!Number.isSafeInteger(lastTime) || lastTime < cursor || lastTime > endInclusive) {
      throw new Error("funding provider pagination did not advance")
    }
    if (lastTime === endInclusive) return pages
    cursor = lastTime + 1
  }
  throw new Error("funding provider pagination exceeds bounds")
}

export async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv)
  const root = repoRoot()
  const statePath = resolve(root, "tmp/funding-demand-worker/latest-state.json")
  mkdirSync(dirname(statePath), { recursive: true, mode: 0o700 })
  const control = new FundingWorkerProcessControl(root, args.commandTimeoutMs)
  control.installSignalHandlers()
  let cycle = 0
  let consecutiveFailures = 0
  try {
    while (!control.stopping) {
      cycle += 1
      const observedAt = new Date().toISOString()
      try {
        const result = await runFundingDemandCycle({
          observed_at: observedAt,
          max_jobs: args.maxJobsPerCycle,
        }, {
          read_subscription_plan: async () => {
            const response = await control.runJson([
              process.execPath,
              resolve(root, "modules/market-data-products/market-data-store/src/scripts/main.ts"),
              "--db", args.marketDataDb,
              "--action", "reconcile_market_data_demands",
              "--json", JSON.stringify({ observed_at: observedAt, max_symbols: args.maxSymbols }),
            ])
            if (response.ok !== true || response.action !== "reconcile_market_data_demands") {
              throw new Error("market data demand owner response identity drifted")
            }
            return compileMarketDataSubscriptionPlan(response.plan)
          },
          resolve_coverage: async (target): Promise<FundingCoverageResolution> => {
            const response = await control.runJson([
              process.execPath,
              resolve(root, "modules/market-data-products/market-data-store/src/scripts/main.ts"),
              "--db", args.marketDataDb,
              "--action", "resolve_funding_coverage",
              "--json", JSON.stringify({
                symbol: target.symbol,
                coverage_start: target.coverage_start,
                coverage_end: target.coverage_end,
              }),
            ])
            if (response.ok !== true || response.action !== "resolve_funding_coverage") {
              throw new Error("funding coverage owner response identity drifted")
            }
            const resolution = asRecord(response.resolution)
            const candidateIds = Array.isArray(resolution.candidate_archive_ids)
              ? resolution.candidate_archive_ids.map(stringField)
              : []
            return {
              status: fundingResolutionStatus(resolution.status),
              audit: resolution.audit == null ? null : compileFundingCoverageAudit(resolution.audit),
              candidate_archive_ids: candidateIds,
            }
          },
          fetch_window: async (job) => {
            try {
              const pages = await fetchFundingWindow(job.target, args.requestTimeoutMs)
              const response = await control.runJson([
                process.execPath,
                resolve(root, "modules/market-data-products/market-data-store/src/scripts/main.ts"),
                "--db", args.marketDataDb,
                "--action", "commit_funding_acquisition",
                "--json", JSON.stringify({
                  symbol: job.target.symbol,
                  coverage_start: job.target.coverage_start,
                  coverage_end: job.target.coverage_end,
                  pages,
                  acquired_at: new Date().toISOString(),
                }),
              ])
              const ok = response.ok === true
                && response.action === "commit_funding_acquisition"
                && ["created", "existing"].includes(stringField(response.commit_status))
                && stringField(response.archive_id).startsWith(`funding-archive:${job.target.symbol}:`)
              return { ok, reason: ok ? "owner_commit_completed" : "owner_commit_identity_drifted" }
            } catch (error) {
              return { ok: false, reason: classifyResidentWorkerFailure(error, "public") }
            }
          },
        })
        consecutiveFailures = result.status === "completed" ? 0 : consecutiveFailures + 1
        writeFundingWorkerState(statePath, {
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
          conflict_target_count: result.conflict_target_count,
          deferred_job_count: result.deferred_job_count,
        })
      } catch (error) {
        consecutiveFailures += 1
        writeFundingWorkerState(statePath, {
          status: "degraded",
          cycle,
          consecutive_failures: consecutiveFailures,
          failure_class: classifyResidentWorkerFailure(error, "public"),
        })
      }
      await control.wait(args.intervalMs, consecutiveFailures)
    }
  } finally {
    writeFundingWorkerState(statePath, {
      status: "stopped",
      cycle,
      consecutive_failures: consecutiveFailures,
    })
  }
  return 0
}

class FundingWorkerProcessControl {
  stopping = false
  private child: ReturnType<typeof Bun.spawn> | undefined
  private cancelDelay: (() => void) | undefined

  constructor(
    private readonly root: string,
    private readonly commandTimeoutMs: number,
  ) {}

  installSignalHandlers(): void {
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      process.on(signal, () => {
        this.stopping = true
        this.child?.kill("SIGTERM")
        this.cancelDelay?.()
      })
    }
  }

  async runJson(command: string[]): Promise<Record<string, unknown>> {
    if (this.stopping) throw new Error("worker stopping")
    const child = Bun.spawn({
      cmd: command,
      cwd: this.root,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    })
    this.child = child
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGTERM")
    }, this.commandTimeoutMs)
    try {
      const [stdout, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        child.exited,
      ])
      if (timedOut) throw new Error("owner command timed out")
      if (exitCode !== 0) throw new Error("owner command failed")
      return asRecord(JSON.parse(stdout))
    } finally {
      clearTimeout(timer)
      if (this.child === child) this.child = undefined
    }
  }

  async wait(intervalMs: number, consecutiveFailures: number): Promise<void> {
    if (this.stopping) return
    await waitForResidentWorkerBackoff(
      intervalMs,
      consecutiveFailures,
      (cancel) => { this.cancelDelay = cancel },
    )
    this.cancelDelay = undefined
  }
}

function writeFundingWorkerState(
  path: string,
  state: Record<string, unknown>,
): void {
  writeResidentWorkerState(path, {
    schema_version: STATE_SCHEMA,
    observed_at: new Date().toISOString(),
    ...state,
    lifecycle_authority: "market_data_owner",
  })
}

function fundingResolutionStatus(value: unknown): FundingCoverageResolution["status"] {
  if (value !== "missing" && value !== "ready" && value !== "conflict") {
    throw new Error("funding coverage resolution status drifted")
  }
  return value
}

if (import.meta.main) process.exit(await main(Bun.argv.slice(2)))
