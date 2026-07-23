#!/usr/bin/env bun

import { mkdirSync, renameSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { asRecord } from "../../../../contracts/runtime-core/src/json"
import { repoRoot } from "../../../../contracts/runtime-core/src/paths"
import { compileMarketDataSubscriptionPlan } from "../../../../contracts/market-data-demand-contract/src/market-data-demand-contract"
import {
  buildL2MultiSymbolPlan,
  type L2RuntimeAssignment,
} from "../../../l2-order-book-service/src/control/multi-symbol-plan"
import {
  applyL2MultiSymbolPlan,
  type ManagedL2Pair,
  type ManagedProcess,
  type MarketDataManagerDependencies,
} from "../lib/runtime-manager"

interface Args {
  marketDataDb: string
  maxInstances: number
  basePort: number
  reconcileIntervalMs: number
  readinessDeadlineMs: number
}

interface ResidentProcess extends ManagedProcess {
  child: ReturnType<typeof Bun.spawn>
}

const STATE_SCHEMA = "trade.market-data-runtime-manager-state.v1" as const

export function parseArgs(argv: string[]): Args {
  const values = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (name == null || value == null || !name.startsWith("--")) throw new Error(`incomplete argument: ${name ?? "<missing>"}`)
    if (values.has(name)) throw new Error(`duplicate argument: ${name}`)
    if (!new Set([
      "--market-data-db", "--max-instances", "--base-port",
      "--reconcile-interval-ms", "--readiness-deadline-ms",
    ]).has(name)) throw new Error(`unknown argument: ${name}`)
    values.set(name, value)
  }
  const marketDataDb = values.get("--market-data-db") ?? "data/market_data.db"
  if (marketDataDb !== "data/market_data.db") throw new Error("--market-data-db is fixed to data/market_data.db")
  const maxInstances = integer(values.get("--max-instances") ?? "3", 1, 20, "--max-instances")
  const basePort = integer(values.get("--base-port") ?? "51100", 1024, 65_535, "--base-port")
  if (basePort + maxInstances - 1 > 65_535) throw new Error("manager port range exceeds 65535")
  return {
    marketDataDb,
    maxInstances,
    basePort,
    reconcileIntervalMs: integer(
      values.get("--reconcile-interval-ms") ?? "30000",
      1_000,
      300_000,
      "--reconcile-interval-ms",
    ),
    readinessDeadlineMs: integer(
      values.get("--readiness-deadline-ms") ?? "30000",
      5_000,
      120_000,
      "--readiness-deadline-ms",
    ),
  }
}

export async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv)
  const root = repoRoot()
  const statePath = resolve(root, "tmp/market-data-runtime-manager/latest-state.json")
  mkdirSync(dirname(statePath), { recursive: true, mode: 0o700 })
  const active = new Map<string, ManagedL2Pair>()
  let stopRequested = false
  let cycle = 0
  let consecutiveFailures = 0
  let cancelDelay: (() => void) | undefined
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      stopRequested = true
      cancelDelay?.()
    })
  }
  const dependencies = runtimeDependencies(root, args.readinessDeadlineMs)
  try {
    while (!stopRequested) {
      cycle += 1
      await pruneExited(active, dependencies)
      try {
        const source = readSubscriptionPlan(root, args)
        const desired = buildL2MultiSymbolPlan({
          subscription_plan: source,
          current_assignments: assignments(active),
          max_instances: args.maxInstances,
          base_port: args.basePort,
          output_base: "data/l2",
        })
        const applied = await applyL2MultiSymbolPlan({
          root,
          bun_path: process.execPath,
          market_data_db: args.marketDataDb,
          plan: desired,
          active,
          dependencies,
        })
        consecutiveFailures = applied.status === "failed" ? consecutiveFailures + 1 : 0
        writeState(statePath, {
          schema_version: STATE_SCHEMA,
          observed_at: new Date().toISOString(),
          status: applied.status === "completed" ? "running" : "degraded",
          cycle,
          consecutive_failures: consecutiveFailures,
          source_plan_hash: applied.source_plan_hash,
          desired_plan_hash: applied.desired_plan_hash,
          active_service_ids: applied.active_service_ids,
          effect_count: applied.effects.length,
          last_failure_class: applied.failure_class ?? "",
          lifecycle_authority: "market_data_owner",
        })
      } catch {
        consecutiveFailures += 1
        writeState(statePath, {
          schema_version: STATE_SCHEMA,
          observed_at: new Date().toISOString(),
          status: "degraded",
          cycle,
          consecutive_failures: consecutiveFailures,
          source_plan_hash: "",
          desired_plan_hash: "",
          active_service_ids: [...active.keys()].sort(),
          effect_count: 0,
          last_failure_class: "owner_plan_unavailable",
          lifecycle_authority: "market_data_owner",
        })
      }
      if (!stopRequested) {
        const backoffMs = consecutiveFailures === 0
          ? args.reconcileIntervalMs
          : Math.min(args.reconcileIntervalMs, 1_000 * 2 ** Math.min(consecutiveFailures - 1, 5))
        await interruptibleDelay(backoffMs, (cancel) => { cancelDelay = cancel })
        cancelDelay = undefined
      }
    }
  } finally {
    await drainAll(active, dependencies)
    writeState(statePath, {
      schema_version: STATE_SCHEMA,
      observed_at: new Date().toISOString(),
      status: "stopped",
      cycle,
      consecutive_failures: consecutiveFailures,
      source_plan_hash: "",
      desired_plan_hash: "",
      active_service_ids: [],
      effect_count: 0,
      last_failure_class: "",
      lifecycle_authority: "market_data_owner",
    })
  }
  return 0
}

function readSubscriptionPlan(root: string, args: Args) {
  const script = resolve(root, "modules/market-data-products/market-data-store/src/scripts/main.ts")
  const invocation = Bun.spawnSync({
    cmd: [
      process.execPath,
      script,
      "--db", args.marketDataDb,
      "--action", "reconcile_market_data_demands",
      "--json", JSON.stringify({
        observed_at: new Date().toISOString(),
        max_symbols: args.maxInstances,
      }),
    ],
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 10_000,
  })
  if (invocation.exitCode !== 0) throw new Error("market data demand owner is unavailable")
  const response = asRecord(JSON.parse(invocation.stdout.toString()))
  if (response.ok !== true || response.action !== "reconcile_market_data_demands") {
    throw new Error("market data demand owner response identity drifted")
  }
  return compileMarketDataSubscriptionPlan(response.plan)
}

function runtimeDependencies(root: string, readinessDeadlineMs: number): MarketDataManagerDependencies {
  return {
    start_owner: async (command, serviceId) => resident(command, root, serviceId, "owner"),
    wait_owner_ready: async (symbol, managed) => waitReady(
      root,
      managed as ResidentProcess,
      [
        resolve(root, "modules/market-data-products/l2-order-book-service/src/scripts/owner-health.ts"),
        "--symbol", symbol,
      ],
      readinessDeadlineMs,
      (payload) => {
        const health = asRecord(payload.health)
        return payload.ok === true
          && payload.action === "read_active_l2_service_health"
          && health.symbol === symbol
          && asRecord(health.readiness).overall_ready === true
      },
    ),
    start_consumer: async (command, serviceId) => resident(command, root, serviceId, "consumer"),
    wait_consumer_ready: async (symbol, managed) => waitReady(
      root,
      managed as ResidentProcess,
      [
        resolve(root, "modules/orchestration-ops/l2-current-book-probe/src/scripts/consumer-read.ts"),
        "--symbol", symbol,
      ],
      readinessDeadlineMs,
      (payload) => {
        const consumer = asRecord(payload.consumer)
        return payload.ok === true
          && payload.action === "read_active_l2_book_watch_consumer"
          && asRecord(consumer.readiness).overall_ready === true
      },
    ),
    drain: async (managed) => {
      const residentProcess = managed as ResidentProcess
      await drainResident(residentProcess.child, 10_000)
    },
  }
}

async function drainResident(child: ReturnType<typeof Bun.spawn>, graceMs: number): Promise<void> {
  if (child.exitCode != null) return
  child.kill("SIGTERM")
  const graceful = await Promise.race([
    child.exited.then(() => true),
    Bun.sleep(graceMs).then(() => false),
  ])
  if (graceful) return
  child.kill("SIGKILL")
  await child.exited
}

function resident(command: string[], root: string, serviceId: string, role: ManagedProcess["role"]): ResidentProcess {
  const child = Bun.spawn({
    cmd: command,
    cwd: root,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  })
  return { service_id: serviceId, role, child }
}

async function waitReady(
  root: string,
  managed: ResidentProcess,
  args: string[],
  deadlineMs: number,
  accept: (payload: Record<string, unknown>) => boolean,
): Promise<boolean> {
  await Bun.sleep(250)
  const deadline = Date.now() + deadlineMs
  while (Date.now() < deadline) {
    if (managed.child.exitCode != null) return false
    const invocation = Bun.spawnSync({
      cmd: [process.execPath, ...args],
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 5_000,
    })
    if (invocation.exitCode === 0) {
      try {
        if (accept(asRecord(JSON.parse(invocation.stdout.toString())))) return true
      } catch {
        // A malformed readiness projection is retried until the bounded deadline.
      }
    }
    await Bun.sleep(250)
  }
  return false
}

async function pruneExited(
  active: Map<string, ManagedL2Pair>,
  dependencies: MarketDataManagerDependencies,
): Promise<void> {
  for (const [serviceId, pair] of [...active.entries()]) {
    const owner = pair.owner as ResidentProcess
    const consumer = pair.consumer as ResidentProcess
    if (owner.child.exitCode == null && consumer.child.exitCode == null) continue
    try {
      await dependencies.drain(consumer)
    } catch {}
    try {
      await dependencies.drain(owner)
    } catch {}
    active.delete(serviceId)
  }
}

async function drainAll(
  active: Map<string, ManagedL2Pair>,
  dependencies: MarketDataManagerDependencies,
): Promise<void> {
  const pairs = [...active.values()].sort((a, b) => b.assignment.slot - a.assignment.slot)
  for (const pair of pairs) {
    try {
      await dependencies.drain(pair.consumer)
    } catch {}
    try {
      await dependencies.drain(pair.owner)
    } catch {}
  }
  active.clear()
}

function assignments(active: Map<string, ManagedL2Pair>): L2RuntimeAssignment[] {
  return [...active.values()].map(({ assignment }) => ({
    slot: assignment.slot,
    symbol: assignment.symbol,
    service_id: assignment.service_id,
    listen: assignment.listen,
    output_base: assignment.output_base,
  }))
}

function writeState(path: string, value: Record<string, unknown>): void {
  const temporary = `${path}.tmp.${process.pid}`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 })
  renameSync(temporary, path)
}

async function interruptibleDelay(
  milliseconds: number,
  register: (cancel: () => void) => void,
): Promise<void> {
  await new Promise<void>((resolveDelay) => {
    const timer = setTimeout(resolveDelay, milliseconds)
    register(() => {
      clearTimeout(timer)
      resolveDelay()
    })
  })
}

function integer(value: string, minimum: number, maximum: number, field: string): number {
  if (!/^(?:0|[1-9]\d*)$/.test(value)) throw new Error(`${field} must be an integer`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${field} must be between ${minimum} and ${maximum}`)
  }
  return parsed
}

if (import.meta.main) process.exit(await main(Bun.argv.slice(2)))
