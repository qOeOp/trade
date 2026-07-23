#!/usr/bin/env bun

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { canonicalJson } from "../../../../contracts/runtime-core/src/canonical-json"
import { asRecord, stringField } from "../../../../contracts/runtime-core/src/json"
import { displayPath, repoRoot } from "../../../../contracts/runtime-core/src/paths"
import {
  classifyResidentWorkerFailure,
  parseBoundedInteger,
  waitForResidentWorkerBackoff,
  writeResidentWorkerState,
} from "../../../../contracts/runtime-core/src/resident-worker"
import { compileMarketDataSubscriptionPlan } from "../../../../contracts/market-data-demand-contract/src/market-data-demand-contract"
import { compileOhlcvCoverageAudit } from "../../../../contracts/market-data-demand-contract/src/ohlcv-coverage-contract"
import {
  compileIndicatorFeatureArtifact,
} from "../../../../contracts/market-data-demand-contract/src/indicator-feature-contract"
import { runIndicatorDemandCycle } from "../lib/worker-cycle"

interface Args {
  marketDataDb: "data/market_data.db"
  ohlcvDb: "data/ohlcv.db"
  maxSymbols: number
  maxJobsPerCycle: number
  maxBars: number
  intervalMs: number
  commandTimeoutMs: number
}

const STATE_SCHEMA = "trade.indicator-demand-worker-state.v1" as const

export function indicatorProviderCommand(
  root: string,
  manifestPath: string,
  providerArgs: string[],
): { command: string[]; cwd: string } {
  const providerRoot = resolve(root, "modules/market-data-products/tech-indicators")
  const catalogPath = resolve(providerRoot, "src/scripts/indicator_catalog.json")
  const compiledProvider = resolve(providerRoot, "target/release/tech-indicators")
  return {
    command: existsSync(compiledProvider)
      ? [
          compiledProvider,
          "--manifest", manifestPath,
          "--catalog", catalogPath,
          ...providerArgs,
        ]
      : [
          "go", "run", "./src/scripts",
          "--manifest", manifestPath,
          "--catalog", catalogPath,
          ...providerArgs,
        ],
    cwd: providerRoot,
  }
}

export function parseArgs(argv: string[]): Args {
  const values = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (name == null || value == null || !name.startsWith("--")) throw new Error(`incomplete argument: ${name ?? "<missing>"}`)
    if (values.has(name)) throw new Error(`duplicate argument: ${name}`)
    if (!new Set([
      "--market-data-db", "--ohlcv-db", "--max-symbols", "--max-jobs-per-cycle",
      "--max-bars", "--interval-ms", "--command-timeout-ms",
    ]).has(name)) throw new Error(`unknown argument: ${name}`)
    values.set(name, value)
  }
  const marketDataDb = values.get("--market-data-db") ?? "data/market_data.db"
  const ohlcvDb = values.get("--ohlcv-db") ?? "data/ohlcv.db"
  if (marketDataDb !== "data/market_data.db" || ohlcvDb !== "data/ohlcv.db") {
    throw new Error("indicator worker database paths are fixed")
  }
  return {
    marketDataDb,
    ohlcvDb,
    maxSymbols: parseBoundedInteger(values.get("--max-symbols") ?? "20", 1, 100, "--max-symbols"),
    maxJobsPerCycle: parseBoundedInteger(values.get("--max-jobs-per-cycle") ?? "2", 1, 20, "--max-jobs-per-cycle"),
    maxBars: parseBoundedInteger(values.get("--max-bars") ?? "50000", 1, 50_000, "--max-bars"),
    intervalMs: parseBoundedInteger(values.get("--interval-ms") ?? "60000", 5_000, 3_600_000, "--interval-ms"),
    commandTimeoutMs: parseBoundedInteger(values.get("--command-timeout-ms") ?? "300000", 5_000, 900_000, "--command-timeout-ms"),
  }
}

export async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv)
  const root = repoRoot()
  const statePath = resolve(root, "tmp/indicator-demand-worker/latest-state.json")
  const sliceRoot = "data/artifacts/market-data/candle-slices"
  const featureRoot = resolve(root, "data/artifacts/market-features")
  mkdirSync(dirname(statePath), { recursive: true, mode: 0o700 })
  mkdirSync(featureRoot, { recursive: true, mode: 0o700 })
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
  const runJson = async (command: string[], cwd: string = root): Promise<Record<string, unknown>> => {
    if (stopRequested) throw new Error("worker stopping")
    const child = Bun.spawn({ cmd: command, cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" })
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
  const storeCommand = (action: string, payload: Record<string, unknown>) => runJson([
    process.execPath,
    resolve(root, "modules/market-data-products/market-data-store/src/scripts/main.ts"),
    "--db", args.marketDataDb,
    "--ohlcv-db", args.ohlcvDb,
    "--action", action,
    "--json", JSON.stringify(payload),
  ])
  try {
    while (!stopRequested) {
      cycle += 1
      const observedAt = new Date().toISOString()
      try {
        const result = await runIndicatorDemandCycle({
          observed_at: observedAt,
          max_jobs: args.maxJobsPerCycle,
          max_bars: args.maxBars,
        }, {
          read_subscription_plan: async () => {
            const response = await storeCommand("reconcile_market_data_demands", {
              observed_at: observedAt,
              max_symbols: args.maxSymbols,
            })
            if (response.ok !== true || response.action !== "reconcile_market_data_demands") {
              throw new Error("market data demand owner response identity drifted")
            }
            return compileMarketDataSubscriptionPlan(response.plan)
          },
          audit_coverage: async (target) => {
            const response = await storeCommand("audit_candle_coverage", {
              exchange: "binanceusdm",
              symbol: target.symbol,
              timeframe: target.timeframe,
              start_open_time: target.start_open_time,
              end_open_time: target.end_open_time,
              observed_at: observedAt,
            })
            if (response.ok !== true || response.action !== "audit_candle_coverage") {
              throw new Error("OHLCV coverage owner response identity drifted")
            }
            return compileOhlcvCoverageAudit(response.audit)
          },
          export_slice: async (target) => {
            const response = await storeCommand("export_candle_slice", {
              exchange: "binanceusdm",
              symbol: target.symbol,
              timeframe: target.timeframe,
              since_ts: target.start_open_time,
              until_ts: target.end_open_time,
              limit: args.maxBars,
              output_root: sliceRoot,
              generated_at: observedAt,
            })
            if (response.ok !== true || response.action !== "export_candle_slice") {
              throw new Error("indicator source slice owner response identity drifted")
            }
            const exported = asRecord(response.export)
            return {
              slice_ref: stringField(exported.slice_ref),
              content_sha256: stringField(exported.content_sha256),
              symbol: target.symbol,
              timeframe: target.timeframe,
              first_open_time: Number(exported.first_open_ts),
              last_open_time: Number(exported.last_open_ts),
              manifest_path: stringField(exported.manifest_path),
            }
          },
          read_existing_feature: async (target, source) => {
            const response = await storeCommand("list_feature_manifests", {
              symbol: target.symbol,
              timeframe: target.timeframe,
              feature_set_id: target.feature_set_ref,
              limit: 100,
            })
            if (response.ok !== true || response.action !== "list_feature_manifests") {
              throw new Error("feature manifest owner response identity drifted")
            }
            const manifests = Array.isArray(response.manifests) ? response.manifests.map(asRecord) : []
            const existing = manifests.find((manifest) => manifest.source_manifest_id === source.slice_ref)
            return existing == null ? null : {
              content_hash: stringField(existing.content_hash),
              source_ref: `market-feature://${stringField(existing.feature_manifest_id)}`,
            }
          },
          run_provider: async (_target, source, providerArgs) => {
            const manifestPath = resolve(root, source.manifest_path)
            const provider = indicatorProviderCommand(root, manifestPath, providerArgs)
            const response = await runJson(provider.command, provider.cwd)
            if (response.ok !== true) throw new Error("indicator provider returned failure")
            return asRecord(response.data)
          },
          admit_artifact: async (target, source, artifactValue, generatedAt) => {
            const artifact = compileIndicatorFeatureArtifact(artifactValue)
            const artifactPath = resolve(featureRoot, `${artifact.content_hash}.json`)
            writeImmutable(artifactPath, `${canonicalJson(artifact)}\n`)
            const response = await storeCommand("admit_feature_manifest", {
              feature_manifest_id: `indicator-feature:${artifact.content_hash}`,
              source_manifest_id: source.slice_ref,
              feature_set_id: target.feature_set_ref,
              symbol: target.symbol,
              timeframe: target.timeframe,
              content_hash: artifact.content_hash,
              manifest_path: displayPath(artifactPath, root),
              generated_at: generatedAt,
            })
            const manifest = asRecord(response.manifest)
            const commitStatus = stringField(response.commit_status)
            if (response.ok !== true || response.action !== "admit_feature_manifest"
              || manifest.content_hash !== artifact.content_hash
              || !new Set(["created", "existing"]).has(commitStatus)) {
              throw new Error("feature artifact owner admission drifted")
            }
            return commitStatus as "created" | "existing"
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
          cycle_plan_hash: result.cycle_plan_hash,
          target_count: result.target_count,
          source_incomplete_count: result.source_incomplete_count,
          computed_count: result.computed_count,
          existing_count: result.existing_count,
          failed_count: result.failed_count,
          deferred_count: result.deferred_count,
          fact_count: result.facts.length,
          failure_classes: [...new Set(
            result.outcomes
              .filter((outcome) => outcome.status === "failed" || outcome.status === "source_incomplete")
              .map((outcome) => outcome.reason),
          )].sort(),
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
          failure_class: classifyResidentWorkerFailure(error, "compute"),
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

function writeImmutable(path: string, content: string): void {
  if (existsSync(path)) {
    if (readFileSync(path, "utf8") !== content) throw new Error("feature artifact content-address collision")
    return
  }
  writeFileSync(path, content, { flag: "wx", mode: 0o600 })
}

if (import.meta.main) process.exit(await main(Bun.argv.slice(2)))
