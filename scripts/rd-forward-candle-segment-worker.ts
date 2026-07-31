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
import {
  compileMarketDataSubscriptionPlan,
} from "../apps/contracts/market-data-demand-contract/src/market-data-demand-contract"
import {
  compileOhlcvCoverageAudit,
} from "../apps/contracts/market-data-demand-contract/src/ohlcv-coverage-contract"
import {
  asRecord,
} from "../apps/contracts/runtime-core/src/json"
import {
  createForwardObservationCandleSegment,
  type ForwardCandleSliceRef,
} from "../apps/research-strategy-development/research-control-plane/contracts/src/lib/forward-observation-candle-segment"
import {
  admitForwardObservationCandleSegment,
  ensureForwardObservationCandleSegmentSchema,
  readLatestForwardObservationCandleSegment,
} from "../apps/research-strategy-development/research-control-plane/state-store/src/lib/forward-observation-candle-segment"
import {
  listCollectingForwardObservationPrograms,
  readLatestForwardMarketDataDemandDelivery,
} from "../apps/research-strategy-development/research-control-plane/state-store/src/lib/forward-observation-program"
import {
  ensureResearchControlPlaneSchema,
} from "../apps/research-strategy-development/research-control-plane/state-store/src/lib/research-control-plane-schema"
import {
  nextForwardCandleSegmentWindow,
} from "./lib/rd-forward-observation-candle-segment"
import {
  resolveWorkerDataPath,
  workerBoundedInteger,
  workerDelay,
  workerFlagValues,
  workerMarketDataOwnerCommand,
  workerResearchMarketDataPaths,
} from "./lib/resident-worker-cli"

const SLICE_ROOT = "data/artifacts/market-data/candle-slices"

async function main(): Promise<void> {
  const input = parseArgs(Bun.argv.slice(2))
  const root = realpathSync(resolve(input.repository_root))
  const researchPath = resolveWorkerDataPath(
    root,
    input.research_db,
    "Forward candle segment worker Research DB",
  )
  mkdirSync(dirname(researchPath), { recursive: true, mode: 0o700 })
  const db = new Database(researchPath, { create: true })
  db.exec("PRAGMA journal_mode=WAL")
  db.exec("PRAGMA busy_timeout=5000")
  db.exec("PRAGMA foreign_keys=ON")
  ensureResearchControlPlaneSchema(db)
  ensureForwardObservationCandleSegmentSchema(db)
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
    segment_created_count: 0,
    coverage_pending_count: 0,
    failure_count: 0,
  })
  try {
    while (!closing) {
      cycle += 1
      const observedAt = new Date().toISOString()
      let activeProgramCount = 0
      let segmentCreatedCount = 0
      let coveragePendingCount = 0
      let failureCount = 0
      try {
        const programs = listCollectingForwardObservationPrograms(db)
        activeProgramCount = programs.length
        let attemptedCount = 0
        for (const program of programs) {
          if (closing || attemptedCount >= input.max_programs_per_cycle) {
            break
          }
          try {
            const delivery = readLatestForwardMarketDataDemandDelivery(
              db,
              program.program_id,
            )
            if (!delivery
                || Date.parse(delivery.demand.lease.expires_at)
                  < Date.parse(observedAt)) {
              coveragePendingCount += 1
              continue
            }
            const latest = readLatestForwardObservationCandleSegment(
              db,
              program.program_id,
            )
            const window = nextForwardCandleSegmentWindow(
              program,
              latest,
              observedAt,
              input.max_rows_per_segment,
            )
            if (!window) continue
            attemptedCount += 1
            const planResponse = await ownerCommand(
              root,
              input,
              "reconcile_market_data_demands",
              {
                observed_at: observedAt,
                max_symbols: input.max_symbols,
              },
              (child) => { currentChild = child },
            )
            const plan = compileMarketDataSubscriptionPlan(
              planResponse.plan,
            )
            const auditResponse = await ownerCommand(
              root,
              input,
              "audit_candle_coverage",
              {
                exchange: "binanceusdm",
                symbol: program.symbol,
                timeframe: program.timeframe,
                start_open_time: window.start_open_time,
                end_open_time: window.end_open_time,
                observed_at: observedAt,
              },
              (child) => { currentChild = child },
            )
            const audit = compileOhlcvCoverageAudit(auditResponse.audit)
            if (!audit.complete) {
              coveragePendingCount += 1
              continue
            }
            const exportResponse = await ownerCommand(
              root,
              input,
              "export_candle_slice",
              {
                exchange: "binanceusdm",
                symbol: program.symbol,
                timeframe: program.timeframe,
                since_ts: window.start_open_time,
                until_ts: window.end_open_time,
                limit: window.row_count,
                output_root: SLICE_ROOT,
                generated_at: observedAt,
              },
              (child) => { currentChild = child },
            )
            const segment = createForwardObservationCandleSegment({
              program,
              previous_segment: latest == null
                ? null
                : {
                    segment_id: latest.segment_id,
                    segment_hash: latest.segment_hash,
                    end_open_time: latest.window.end_open_time,
                  },
              demand: delivery.demand,
              demand_accepted_at: delivery.accepted_at,
              subscription_plan: plan,
              coverage_audit: audit,
              candle_slice: asRecord(
                exportResponse.export,
              ) as unknown as ForwardCandleSliceRef,
              created_at: observedAt,
            })
            if (admitForwardObservationCandleSegment(db, segment)
                === "created") {
              segmentCreatedCount += 1
            }
          } catch (error) {
            failureCount += 1
            console.error(JSON.stringify({
              schema_version:
                "trade.rd-forward-candle-segment-worker-error.v1",
              program_id: program.program_id,
              error_class: error instanceof Error ? error.name : "Error",
            }))
          } finally {
            currentChild = undefined
          }
        }
      } catch (error) {
        failureCount += 1
        console.error(JSON.stringify({
          schema_version:
            "trade.rd-forward-candle-segment-worker-cycle-error.v1",
          error_class: error instanceof Error ? error.name : "Error",
        }))
      }
      writeState(input.state_file, {
        status: "running",
        updated_at: new Date().toISOString(),
        cycle,
        active_program_count: activeProgramCount,
        segment_created_count: segmentCreatedCount,
        coverage_pending_count: coveragePendingCount,
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
      segment_created_count: 0,
      coverage_pending_count: 0,
      failure_count: 0,
    })
    db.close()
  }
}

async function ownerCommand(
  root: string,
  input: ReturnType<typeof parseArgs>,
  action: string,
  json: Record<string, unknown>,
  setChild: (child: ReturnType<typeof Bun.spawn>) => void,
): Promise<Record<string, unknown>> {
  return workerMarketDataOwnerCommand({
    root,
    market_data_db: input.market_data_db,
    ohlcv_db: input.ohlcv_db,
    action,
    json,
    timeout_ms: input.command_timeout_ms,
    set_child: setChild,
  })
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
  max_programs_per_cycle: number
  max_rows_per_segment: number
  max_symbols: number
} {
  const allowed = new Set([
    "repository-root",
    "research-db",
    "market-data-db",
    "ohlcv-db",
    "ready-file",
    "state-file",
    "poll-interval-ms",
    "command-timeout-ms",
    "max-programs-per-cycle",
    "max-rows-per-segment",
    "max-symbols",
  ])
  const values = workerFlagValues(
    argv,
    allowed,
    "Forward candle segment worker",
  )
  return {
    ...workerResearchMarketDataPaths(
      values,
      "forward-candle-segment-worker",
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
    max_programs_per_cycle: workerBoundedInteger(
      values.get("max-programs-per-cycle") ?? "20",
      1,
      100,
      "max_programs_per_cycle",
    ),
    max_rows_per_segment: workerBoundedInteger(
      values.get("max-rows-per-segment") ?? "10000",
      1,
      1_000_000,
      "max_rows_per_segment",
    ),
    max_symbols: workerBoundedInteger(
      values.get("max-symbols") ?? "20",
      1,
      100,
      "max_symbols",
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
    segment_created_count: number
    coverage_pending_count: number
    failure_count: number
  },
): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify({
    schema_version:
      "trade.rd-forward-candle-segment-worker-state.v1",
    ...value,
    forward_dataset_materialization_authority: "segment_only",
    forward_replay_admission_authority: "none",
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
