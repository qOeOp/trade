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
  runStrategyRegistryResidentCycle,
  type StrategyRegistryResidentCycleInput,
  type StrategyRegistryResidentCycleResult,
} from "./strategy-registry-resident-worker"

export interface StrategyRegistryResidentForegroundConfig
  extends StrategyRegistryResidentCycleInput {
  db_path: string
  state_path: string
  interval_ms: number
  max_cycles: number
}

interface Dependencies {
  cycle(input: {
    db_path: string
    config: StrategyRegistryResidentCycleInput
  }): StrategyRegistryResidentCycleResult
  wait(
    intervalMs: number,
    consecutiveFailures: number,
    register: (cancel: () => void) => void,
  ): Promise<void>
  now(): string
}

const DEFAULT_DEPENDENCIES: Dependencies = {
  cycle: runStrategyRegistryResidentCycle,
  wait: waitForResidentWorkerBackoff,
  now: () => new Date().toISOString(),
}

export async function runStrategyRegistryResidentForeground(
  config: StrategyRegistryResidentForegroundConfig,
  signal: AbortSignal,
  dependencies: Dependencies = DEFAULT_DEPENDENCIES,
): Promise<void> {
  assertProjectRuntimePath(config.db_path)
  assertProjectRuntimePath(config.state_path)
  assertProjectRuntimePath(config.candidate_root)
  const statePath = resolveRepoPath(config.state_path)
  mkdirSync(dirname(statePath), { recursive: true, mode: 0o700 })
  let cycles = 0
  let failures = 0
  let last: StrategyRegistryResidentCycleResult | null = null
  write("starting")
  while (!signal.aborted
      && (config.max_cycles === 0 || cycles < config.max_cycles)) {
    write("running")
    const heartbeat = setInterval(
      () => write("running"),
      Math.max(1_000, Math.min(config.interval_ms, 5_000)),
    )
    try {
      last = dependencies.cycle({ db_path: config.db_path, config })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/(?:identity|schema|contract) drift/i.test(message)) throw error
      last = unavailable()
    } finally {
      clearInterval(heartbeat)
    }
    cycles += 1
    failures = last.status === "retrying" ? failures + 1 : 0
    write("running")
    if (signal.aborted
        || (config.max_cycles !== 0 && cycles >= config.max_cycles)) break
    await dependencies.wait(config.interval_ms, failures, (cancel) => {
      if (signal.aborted) cancel()
      else signal.addEventListener("abort", cancel, { once: true })
    })
  }
  write("stopped")

  function write(status: "starting" | "running" | "stopped"): void {
    const observedAt = dependencies.now()
    writeResidentWorkerState(statePath, {
      schema_version: "trade.rd-strategy-registry-resident-state.v1",
      status,
      worker_id: config.worker_id,
      cycles,
      consecutive_failures: failures,
      last_cycle: last,
      updated_at: observedAt,
      observed_at: observedAt,
      release_authority: "candidate_source_only",
      deployment_authority: "none",
      trading_authority: false,
    })
  }
}

function unavailable(): StrategyRegistryResidentCycleResult {
  return {
    schema_version: "trade.rd-strategy-registry-resident-cycle.v1",
    status: "retrying",
    job_id: null,
    decision_id: null,
    draft_id: null,
    strategy_ref: null,
    failure_class: "resident_cycle_unavailable",
    release_authority: "none",
    deployment_authority: "none",
    trading_authority: false,
  }
}
