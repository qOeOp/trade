import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import {
  waitForResidentWorkerBackoff,
  writeResidentWorkerState,
} from "../../../../../contracts/runtime-core/src/resident-worker"
import {
  assertProjectRuntimePath,
  resolveRepoPath,
} from "../../../../../contracts/runtime-core/src/paths"
import {
  runFormalReplayResidentCycle,
  type FormalReplayResidentCycleInput,
  type FormalReplayResidentCycleResult,
} from "./formal-replay-resident-worker"

export interface FormalReplayResidentForegroundConfig
  extends FormalReplayResidentCycleInput {
  db_path: string
  state_path: string
  interval_ms: number
  max_cycles: number
}

interface Dependencies {
  cycle(
    dbPath: string,
    input: FormalReplayResidentCycleInput,
  ): FormalReplayResidentCycleResult | Promise<FormalReplayResidentCycleResult>
  wait(
    intervalMs: number,
    consecutiveFailures: number,
    register: (cancel: () => void) => void,
  ): Promise<void>
  now(): string
}

const DEFAULT_DEPENDENCIES: Dependencies = {
  cycle: runFormalReplayResidentCycle,
  wait: waitForResidentWorkerBackoff,
  now: () => new Date().toISOString(),
}

export async function runFormalReplayResidentForeground(
  config: FormalReplayResidentForegroundConfig,
  signal: AbortSignal,
  dependencies: Dependencies = DEFAULT_DEPENDENCIES,
): Promise<void> {
  assertProjectRuntimePath(config.db_path)
  assertProjectRuntimePath(config.state_path)
  const statePath = resolveRepoPath(config.state_path)
  mkdirSync(dirname(statePath), { recursive: true, mode: 0o700 })
  let cycles = 0
  let failures = 0
  let last: FormalReplayResidentCycleResult | null = null
  write("starting")
  while (!signal.aborted
      && (config.max_cycles === 0 || cycles < config.max_cycles)) {
    write("running")
    const heartbeat = setInterval(
      () => write("running"),
      Math.max(1_000, Math.min(config.interval_ms, 5_000)),
    )
    try {
      last = await dependencies.cycle(config.db_path, {
        environment_id: config.environment_id,
        queue_worker_id: config.queue_worker_id,
        queue_lease_duration_ms: config.queue_lease_duration_ms,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/(?:identity|schema|contract) drift/i.test(message)) throw error
      last = {
        schema_version: "trade.rd-formal-replay-resident-cycle.v1",
        status: "retrying",
        job_id: null,
        lease_generation: null,
        resumed: false,
        replay_status: null,
        result_id: null,
        failure_class: "resident_cycle_unavailable",
        review_authority: "none",
        deployment_authority: "none",
        trading_authority: false,
      }
    } finally {
      clearInterval(heartbeat)
    }
    cycles += 1
    failures = last.status === "retrying" ? failures + 1 : 0
    write("running")
    if (signal.aborted
        || (config.max_cycles !== 0 && cycles >= config.max_cycles)) {
      break
    }
    await dependencies.wait(config.interval_ms, failures, (cancel) => {
      if (signal.aborted) cancel()
      else signal.addEventListener("abort", cancel, { once: true })
    })
  }
  write("stopped")

  function write(status: "starting" | "running" | "stopped"): void {
    const observedAt = dependencies.now()
    writeResidentWorkerState(statePath, {
      schema_version: "trade.rd-formal-replay-resident-state.v1",
      status,
      worker_id: config.queue_worker_id,
      cycles,
      consecutive_failures: failures,
      last_cycle: last,
      updated_at: observedAt,
      observed_at: observedAt,
      trading_authority: false,
    })
  }
}
