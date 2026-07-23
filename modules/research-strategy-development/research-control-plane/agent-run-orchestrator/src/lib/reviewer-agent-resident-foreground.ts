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
import type { AgentHostPort } from "../../../../../contracts/agent-run-contract/src/agent-host-port"
import type { AgentArtifactPort } from "./planner-agent-run"
import {
  runReviewerAgentResidentCycle,
  type ReviewerAgentResidentCycleInput,
  type ReviewerAgentResidentCycleResult,
} from "./reviewer-agent-resident-worker"

export interface ReviewerAgentResidentForegroundConfig
  extends ReviewerAgentResidentCycleInput {
  db_path: string
  state_path: string
  interval_ms: number
  max_cycles: number
}

interface Dependencies {
  cycle(input: {
    db_path: string
    config: ReviewerAgentResidentCycleInput
    host: AgentHostPort
    artifacts: AgentArtifactPort
    signal?: AbortSignal
  }): Promise<ReviewerAgentResidentCycleResult>
  wait(
    intervalMs: number,
    consecutiveFailures: number,
    register: (cancel: () => void) => void,
  ): Promise<void>
  now(): string
}

const DEFAULT_DEPENDENCIES: Dependencies = {
  cycle: runReviewerAgentResidentCycle,
  wait: waitForResidentWorkerBackoff,
  now: () => new Date().toISOString(),
}

export async function runReviewerAgentResidentForeground(input: {
  config: ReviewerAgentResidentForegroundConfig
  host: AgentHostPort
  artifacts: AgentArtifactPort
  signal: AbortSignal
  dependencies?: Dependencies
}): Promise<void> {
  const { config } = input
  assertProjectRuntimePath(config.db_path)
  assertProjectRuntimePath(config.state_path)
  const statePath = resolveRepoPath(config.state_path)
  mkdirSync(dirname(statePath), { recursive: true, mode: 0o700 })
  const dependencies = input.dependencies ?? DEFAULT_DEPENDENCIES
  let cycles = 0
  let failures = 0
  let last: ReviewerAgentResidentCycleResult | null = null
  write("starting")
  while (!input.signal.aborted
      && (config.max_cycles === 0 || cycles < config.max_cycles)) {
    write("running")
    const heartbeat = setInterval(
      () => write("running"),
      Math.max(1_000, Math.min(config.interval_ms, 5_000)),
    )
    try {
      last = await dependencies.cycle({
        db_path: config.db_path,
        config,
        host: input.host,
        artifacts: input.artifacts,
        signal: input.signal,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/(?:identity|schema|contract) drift/i.test(message)) throw error
      last = retryingUnavailable()
    } finally {
      clearInterval(heartbeat)
    }
    cycles += 1
    failures = last.status === "retrying" ? failures + 1 : 0
    write("running")
    if (input.signal.aborted
        || (config.max_cycles !== 0 && cycles >= config.max_cycles)) break
    await dependencies.wait(config.interval_ms, failures, (cancel) => {
      if (input.signal.aborted) cancel()
      else input.signal.addEventListener("abort", cancel, { once: true })
    })
  }
  write("stopped")

  function write(status: "starting" | "running" | "stopped"): void {
    const observedAt = dependencies.now()
    writeResidentWorkerState(statePath, {
      schema_version: "trade.rd-reviewer-agent-resident-state.v1",
      status,
      worker_id: config.worker_id,
      cycles,
      consecutive_failures: failures,
      last_cycle: last,
      updated_at: observedAt,
      observed_at: observedAt,
      registry_authority: "review_decision_only",
      deployment_authority: "none",
      trading_authority: false,
    })
  }
}

function retryingUnavailable(): ReviewerAgentResidentCycleResult {
  return {
    schema_version: "trade.rd-reviewer-agent-resident-cycle.v1",
    status: "retrying",
    job_id: null,
    lease_generation: null,
    reviewer_run_id: null,
    result_id: null,
    decision: null,
    failure_class: "resident_cycle_unavailable",
    registry_authority: "none",
    deployment_authority: "none",
    trading_authority: false,
  }
}
