#!/usr/bin/env bun

import {
  existsSync,
  mkdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { dirname, resolve } from "node:path"
import { Database } from "bun:sqlite"
import { asRecord, stringField } from "../modules/contracts/runtime-core/src/json"
import {
  buildForwardObservationMarketDataDemand,
} from "../modules/research-strategy-development/research-control-plane/contracts/src/lib/forward-observation-program"
import {
  ensureForwardObservationProgramSchema,
  listCollectingForwardObservationPrograms,
  readLatestForwardMarketDataDemandDelivery,
  recordForwardMarketDataDemandDelivery,
} from "../modules/research-strategy-development/research-control-plane/state-store/src/lib/forward-observation-program"
import {
  ensureResearchControlPlaneSchema,
} from "../modules/research-strategy-development/research-control-plane/state-store/src/lib/research-control-plane-schema"
import {
  reconcileForwardObservationPrograms,
  shouldRenewForwardMarketDataDemand,
} from "./lib/rd-forward-observation-program"
import {
  resolveWorkerDataPath,
  workerAbsolutePath,
  workerBoundedInteger,
  workerDelay,
  workerRepoPath,
} from "./lib/resident-worker-cli"

async function main(): Promise<void> {
  const input = parseArgs(Bun.argv.slice(2))
  const root = realpathSync(resolve(input.repository_root))
  const researchPath = resolveWorkerDataPath(
    root,
    input.research_db,
    "Forward market-data worker Research DB",
  )
  mkdirSync(dirname(researchPath), { recursive: true, mode: 0o700 })
  const db = new Database(researchPath, { create: true })
  db.exec("PRAGMA journal_mode=WAL")
  db.exec("PRAGMA busy_timeout=5000")
  db.exec("PRAGMA foreign_keys=ON")
  ensureResearchControlPlaneSchema(db)
  ensureForwardObservationProgramSchema(db)
  let closing = false
  let currentChild: ReturnType<typeof Bun.spawn> | undefined
  const close = () => {
    closing = true
    currentChild?.kill("SIGTERM")
  }
  process.on("SIGINT", close)
  process.on("SIGTERM", close)
  mkdirSync(dirname(input.ready_file), { recursive: true, mode: 0o700 })
  if (existsSync(input.ready_file)) rmSync(input.ready_file)
  writeFileSync(input.ready_file, "ready\n", { flag: "wx", mode: 0o600 })
  let cycle = 0
  writeState(input.state_file, {
    status: "running",
    updated_at: new Date().toISOString(),
    cycle,
    active_program_count: 0,
    program_created_count: 0,
    demand_accepted_count: 0,
    failure_count: 0,
  })
  try {
    while (!closing) {
      cycle += 1
      const observedAt = new Date().toISOString()
      let programCreatedCount = 0
      let demandAcceptedCount = 0
      let activeProgramCount = 0
      let failureCount = 0
      try {
        const programs = reconcileForwardObservationPrograms(db, {
          observed_at: observedAt,
        })
        programCreatedCount = programs.created.length
        failureCount += programs.failures.length
        for (const failure of programs.failures) {
          console.error(JSON.stringify({
            schema_version:
              "trade.rd-forward-market-data-program-error.v1",
            source_admission_id: failure.source_admission_id,
            failure_code: failure.failure_code,
          }))
        }
        const collecting = listCollectingForwardObservationPrograms(db)
        activeProgramCount = collecting.length
        let attemptedDemandCount = 0
        for (const program of collecting) {
          if (closing) break
          try {
            const latest = readLatestForwardMarketDataDemandDelivery(
              db,
              program.program_id,
            )
            if (!shouldRenewForwardMarketDataDemand(
              latest?.demand.lease.expires_at,
              observedAt,
              input.renew_before_ms,
            )) continue
            if (attemptedDemandCount >= input.max_programs_per_cycle) {
              continue
            }
            attemptedDemandCount += 1
            const demand = buildForwardObservationMarketDataDemand(program, {
              issued_at: observedAt,
              lease_duration_ms: input.lease_duration_ms,
            })
            const response = await ownerCommand(root, input, demand, (child) => {
              currentChild = child
            })
            currentChild = undefined
            const commitStatus = stringField(response.commit_status)
            if (response.ok !== true
                || response.action !== "put_market_data_demand"
                || response.demand_id !== demand.demand_id
                || response.demand_hash !== demand.demand_hash
                || !["created", "renewed", "existing"].includes(commitStatus)) {
              throw new Error("market-data owner response identity drifted")
            }
            recordForwardMarketDataDemandDelivery(db, {
              program_id: program.program_id,
              demand,
              owner_commit_status: commitStatus as
                "created" | "renewed" | "existing",
              accepted_at: new Date().toISOString(),
            })
            demandAcceptedCount += 1
          } catch (error) {
            currentChild = undefined
            failureCount += 1
            console.error(JSON.stringify({
              schema_version:
                "trade.rd-forward-market-data-worker-error.v1",
              program_id: program.program_id,
              error_class: error instanceof Error ? error.name : "Error",
            }))
          }
        }
      } catch (error) {
        failureCount += 1
        console.error(JSON.stringify({
          schema_version:
            "trade.rd-forward-market-data-worker-cycle-error.v1",
          error_class: error instanceof Error ? error.name : "Error",
        }))
      }
      writeState(input.state_file, {
        status: "running",
        updated_at: new Date().toISOString(),
        cycle,
        active_program_count: activeProgramCount,
        program_created_count: programCreatedCount,
        demand_accepted_count: demandAcceptedCount,
        failure_count: failureCount,
      })
      if (!closing) await workerDelay(input.poll_interval_ms)
    }
  } finally {
    currentChild?.kill("SIGTERM")
    if (existsSync(input.ready_file)) rmSync(input.ready_file)
    writeState(input.state_file, {
      status: "stopped",
      updated_at: new Date().toISOString(),
      cycle,
      active_program_count: 0,
      program_created_count: 0,
      demand_accepted_count: 0,
      failure_count: 0,
    })
    db.close()
  }
}

async function ownerCommand(
  root: string,
  input: ReturnType<typeof parseArgs>,
  demand: ReturnType<typeof buildForwardObservationMarketDataDemand>,
  setChild: (child: ReturnType<typeof Bun.spawn>) => void,
): Promise<Record<string, unknown>> {
  const child = Bun.spawn({
    cmd: [
      process.execPath,
      resolve(
        root,
        "modules/market-data-products/market-data-store/src/scripts/main.ts",
      ),
      "--db",
      input.market_data_db,
      "--ohlcv-db",
      input.ohlcv_db,
      "--action",
      "put_market_data_demand",
      "--json",
      JSON.stringify({
        demand,
        committed_at: new Date().toISOString(),
      }),
    ],
    cwd: root,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  setChild(child)
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    child.kill("SIGTERM")
  }, input.command_timeout_ms)
  try {
    const [stdout, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      child.exited,
    ])
    if (timedOut) throw new Error("market-data owner command timed out")
    if (exitCode !== 0) throw new Error("market-data owner command failed")
    return asRecord(JSON.parse(stdout))
  } finally {
    clearTimeout(timer)
  }
}

function parseArgs(argv: string[]): {
  repository_root: string
  research_db: string
  market_data_db: string
  ohlcv_db: string
  ready_file: string
  state_file: string
  poll_interval_ms: number
  command_timeout_ms: number
  lease_duration_ms: number
  renew_before_ms: number
  max_programs_per_cycle: number
} {
  const values = new Map<string, string>()
  const allowed = new Set([
    "repository-root",
    "research-db",
    "market-data-db",
    "ohlcv-db",
    "ready-file",
    "state-file",
    "poll-interval-ms",
    "command-timeout-ms",
    "lease-duration-ms",
    "renew-before-ms",
    "max-programs-per-cycle",
  ])
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (!flag?.startsWith("--") || value == null) {
      throw new Error(
        "Forward market-data worker arguments must be --key value pairs",
      )
    }
    const key = flag.slice(2)
    if (!allowed.has(key)) throw new Error(`unknown argument: ${flag}`)
    if (values.has(key)) throw new Error(`duplicate argument: ${flag}`)
    values.set(key, value)
  }
  return {
    repository_root: values.get("repository-root")
      || process.env.TRADE_REPO_ROOT
      || process.cwd(),
    research_db: workerRepoPath(
      values.get("research-db")
        || process.env.TRADE_RD_STATE_DB
        || "data/rd_state.db",
      "research_db",
    ),
    market_data_db: workerRepoPath(
      values.get("market-data-db")
        || process.env.TRADE_MARKET_DATA_DB
        || "data/market_data.db",
      "market_data_db",
    ),
    ohlcv_db: workerRepoPath(
      values.get("ohlcv-db")
        || process.env.TRADE_OHLCV_DB
        || "data/ohlcv.db",
      "ohlcv_db",
    ),
    ready_file: workerAbsolutePath(
      values.get("ready-file")
        || "/app/tmp/runtime/forward-market-data-worker/ready",
      "ready_file",
    ),
    state_file: workerAbsolutePath(
      values.get("state-file")
        || "/app/tmp/runtime/forward-market-data-worker/state.json",
      "state_file",
    ),
    poll_interval_ms: workerBoundedInteger(
      values.get("poll-interval-ms") ?? "60000",
      5_000,
      3_600_000,
      "poll_interval_ms",
    ),
    command_timeout_ms: workerBoundedInteger(
      values.get("command-timeout-ms") ?? "30000",
      5_000,
      300_000,
      "command_timeout_ms",
    ),
    lease_duration_ms: workerBoundedInteger(
      values.get("lease-duration-ms") ?? "86400000",
      60_000,
      30 * 86_400_000,
      "lease_duration_ms",
    ),
    renew_before_ms: workerBoundedInteger(
      values.get("renew-before-ms") ?? "21600000",
      60_000,
      29 * 86_400_000,
      "renew_before_ms",
    ),
    max_programs_per_cycle: workerBoundedInteger(
      values.get("max-programs-per-cycle") ?? "20",
      1,
      100,
      "max_programs_per_cycle",
    ),
  }
}

function writeState(
  path: string,
  value: {
    status: "running" | "stopped"
    updated_at: string
    cycle: number
    active_program_count: number
    program_created_count: number
    demand_accepted_count: number
    failure_count: number
  },
): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify({
    schema_version:
      "trade.rd-forward-market-data-worker-state.v1",
    ...value,
    market_data_demand_authority: "request_only",
    forward_session_authority: "none",
    deployment_authority: "none",
    trading_authority: false,
  })}\n`, { mode: 0o600 })
  renameSync(temporary, path)
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }))
    process.exit(1)
  })
}
