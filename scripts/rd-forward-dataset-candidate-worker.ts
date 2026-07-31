#!/usr/bin/env bun

import {
  mkdirSync,
  realpathSync,
} from "node:fs"
import { dirname, resolve } from "node:path"
import { Database } from "bun:sqlite"
import {
  materializeForwardDatasetCandidate,
} from "../apps/research-strategy-development/forward-evidence-plane/runner/src/lib/forward-dataset-candidate-materializer"
import {
  admitForwardDatasetCandidate,
  ensureForwardDatasetCandidateSchema,
  readLatestForwardDatasetCandidate,
} from "../apps/research-strategy-development/research-control-plane/state-store/src/lib/forward-dataset-candidate"
import {
  readForwardDatasetReadinessAssessment,
} from "../apps/research-strategy-development/research-control-plane/state-store/src/lib/forward-dataset-readiness-assessment"
import {
  listForwardObservationCandleSegments,
  readLatestForwardObservationCandleSegment,
} from "../apps/research-strategy-development/research-control-plane/state-store/src/lib/forward-observation-candle-segment"
import {
  listCollectingForwardObservationPrograms,
} from "../apps/research-strategy-development/research-control-plane/state-store/src/lib/forward-observation-program"
import {
  ensureResearchControlPlaneSchema,
} from "../apps/research-strategy-development/research-control-plane/state-store/src/lib/research-control-plane-schema"
import {
  resolveWorkerDataPath,
  workerAbsolutePath,
  workerBoundedInteger,
  workerClearReady,
  workerDelay,
  workerFlagValues,
  workerMarkReady,
  workerRepoPath,
  workerWriteState,
} from "./lib/resident-worker-cli"

async function main(): Promise<void> {
  const input = parseArgs(Bun.argv.slice(2))
  const root = realpathSync(resolve(input.repository_root))
  const researchPath = resolveWorkerDataPath(
    root,
    input.research_db,
    "Forward dataset candidate worker Research DB",
  )
  mkdirSync(dirname(researchPath), { recursive: true, mode: 0o700 })
  const db = new Database(researchPath, { create: true })
  db.exec("PRAGMA journal_mode=WAL")
  db.exec("PRAGMA busy_timeout=5000")
  db.exec("PRAGMA foreign_keys=ON")
  ensureResearchControlPlaneSchema(db)
  ensureForwardDatasetCandidateSchema(db)
  let closing = false
  const close = () => { closing = true }
  process.on("SIGINT", close)
  process.on("SIGTERM", close)
  workerMarkReady(input.ready_file)
  let cycle = 0
  writeState(input, cycle, zeroCounts(), "running")
  try {
    while (!closing) {
      cycle += 1
      const counts = zeroCounts()
      const observedAt = new Date().toISOString()
      try {
        const programs = listCollectingForwardObservationPrograms(db)
        counts.active_program_count = programs.length
        for (const program of programs.slice(
          0,
          input.max_programs_per_cycle,
        )) {
          if (closing) break
          try {
            const segments = listForwardObservationCandleSegments(
              db,
              program.program_id,
              input.max_segments_per_candidate,
            )
            if (segments.length === 0) {
              counts.segment_pending_count += 1
              continue
            }
            const head = segments.at(-1)!
            const completeHead =
              readLatestForwardObservationCandleSegment(
                db,
                program.program_id,
              )
            if (completeHead?.segment_id !== head.segment_id) {
              counts.capacity_pending_count += 1
              continue
            }
            const latest = readLatestForwardDatasetCandidate(
              db,
              program.program_id,
            )
            if (latest) {
              observeReadiness(
                db,
                latest.candidate_id,
                observedAt,
                counts,
              )
            }
            if (latest?.head_segment_id === head.segment_id) {
              counts.unchanged_count += 1
              continue
            }
            const rowCount = segments.reduce(
              (sum, segment) => sum + segment.window.row_count,
              0,
            )
            if (!Number.isSafeInteger(rowCount)
                || rowCount > input.max_candidate_rows) {
              counts.capacity_pending_count += 1
              continue
            }
            const priorWatermark = latest?.window.data_watermark
              ?? program.first_observation_open_time
            if (Date.parse(head.window.data_watermark)
                - Date.parse(priorWatermark)
                < input.minimum_new_span_ms) {
              counts.cadence_pending_count += 1
              continue
            }
            const materialized = materializeForwardDatasetCandidate({
              repository_root: root,
              program,
              segments,
              created_at: observedAt,
            })
            if (admitForwardDatasetCandidate(db, {
              candidate: materialized.candidate,
              verified_bars: materialized.bars,
            }) === "created") {
              counts.candidate_created_count += 1
              if (!latest) {
                observeReadiness(
                  db,
                  materialized.candidate.candidate_id,
                  observedAt,
                  counts,
                )
              }
            } else {
              counts.unchanged_count += 1
            }
          } catch (error) {
            counts.failure_count += 1
            console.error(JSON.stringify({
              schema_version:
                "trade.rd-forward-dataset-candidate-worker-error.v1",
              program_id: program.program_id,
              error_class: error instanceof Error ? error.name : "Error",
            }))
          }
        }
      } catch (error) {
        counts.failure_count += 1
        console.error(JSON.stringify({
          schema_version:
            "trade.rd-forward-dataset-candidate-worker-cycle-error.v1",
          error_class: error instanceof Error ? error.name : "Error",
        }))
      }
      writeState(input, cycle, counts, "running")
      if (input.max_cycles > 0 && cycle >= input.max_cycles) break
      if (!closing) await workerDelay(input.poll_interval_ms)
    }
  } finally {
    workerClearReady(input.ready_file)
    writeState(input, cycle, zeroCounts(), "stopped")
    db.close()
  }
}

function parseArgs(argv: string[]): {
  repository_root: string
  research_db: string
  ready_file: string
  state_file: string
  poll_interval_ms: number
  max_programs_per_cycle: number
  max_segments_per_candidate: number
  max_candidate_rows: number
  minimum_new_span_ms: number
  max_cycles: number
} {
  const allowed = new Set([
    "repository-root",
    "research-db",
    "ready-file",
    "state-file",
    "poll-interval-ms",
    "max-programs-per-cycle",
    "max-segments-per-candidate",
    "max-candidate-rows",
    "minimum-new-span-ms",
    "max-cycles",
  ])
  const values = workerFlagValues(
    argv,
    allowed,
    "Forward dataset candidate worker",
  )
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
    ready_file: workerAbsolutePath(
      values.get("ready-file")
        || "/app/tmp/runtime/forward-dataset-candidate-worker/ready",
      "ready_file",
    ),
    state_file: workerAbsolutePath(
      values.get("state-file")
        || "/app/tmp/runtime/forward-dataset-candidate-worker/state.json",
      "state_file",
    ),
    poll_interval_ms: workerBoundedInteger(
      values.get("poll-interval-ms") ?? "60000",
      5_000,
      3_600_000,
      "poll_interval_ms",
    ),
    max_programs_per_cycle: workerBoundedInteger(
      values.get("max-programs-per-cycle") ?? "20",
      1,
      100,
      "max_programs_per_cycle",
    ),
    max_segments_per_candidate: workerBoundedInteger(
      values.get("max-segments-per-candidate") ?? "100000",
      1,
      100_000,
      "max_segments_per_candidate",
    ),
    max_candidate_rows: workerBoundedInteger(
      values.get("max-candidate-rows") ?? "250000",
      1,
      5_000_000,
      "max_candidate_rows",
    ),
    minimum_new_span_ms: workerBoundedInteger(
      values.get("minimum-new-span-ms") ?? "86400000",
      60_000,
      30 * 86_400_000,
      "minimum_new_span_ms",
    ),
    max_cycles: workerBoundedInteger(
      values.get("max-cycles") ?? "0",
      0,
      1_000_000,
      "max_cycles",
    ),
  }
}

interface Counts {
  active_program_count: number
  candidate_created_count: number
  unchanged_count: number
  segment_pending_count: number
  cadence_pending_count: number
  capacity_pending_count: number
  readiness_pending_count: number
  readiness_failure_count: number
  readiness_blocker_counts: Record<string, number>
  failure_count: number
}

function zeroCounts(): Counts {
  return {
    active_program_count: 0,
    candidate_created_count: 0,
    unchanged_count: 0,
    segment_pending_count: 0,
    cadence_pending_count: 0,
    capacity_pending_count: 0,
    readiness_pending_count: 0,
    readiness_failure_count: 0,
    readiness_blocker_counts: {},
    failure_count: 0,
  }
}

function observeReadiness(
  db: Database,
  candidateId: string,
  assessedAt: string,
  counts: Counts,
): void {
  try {
    const assessment = readForwardDatasetReadinessAssessment(db, {
      candidate_id: candidateId,
      assessed_at: assessedAt,
    })
    counts.readiness_pending_count += 1
    for (const blocker of assessment.blockers) {
      counts.readiness_blocker_counts[blocker] =
        (counts.readiness_blocker_counts[blocker] ?? 0) + 1
    }
  } catch {
    counts.readiness_failure_count += 1
  }
}

function writeState(
  input: ReturnType<typeof parseArgs>,
  cycle: number,
  counts: Counts,
  status: "running" | "stopped",
): void {
  workerWriteState(input.state_file, {
    schema_version:
      "trade.rd-forward-dataset-candidate-worker-state.v1",
    status,
    updated_at: new Date().toISOString(),
    cycle,
    ...counts,
    minimum_new_span_ms: input.minimum_new_span_ms,
    max_candidate_rows: input.max_candidate_rows,
    dataset_candidate_authority: "ohlcv_materialization_only",
    forward_replay_admission_authority: "none",
    deployment_authority: "none",
    trading_authority: false,
  })
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
