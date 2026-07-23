import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import type { AgentHostPort } from "../../../../../contracts/agent-run-contract/src/agent-host-port"
import { displayPath, resolveRepoPath } from "../../../../../contracts/runtime-core/src/paths"
import { memoryArtifacts } from "./agent-artifact-port.test-fixture"
import { runReviewerAgentResidentForeground } from "./reviewer-agent-resident-foreground"

test("Reviewer Agent foreground persists bounded no-trade state", async () => {
  const statePath = `tmp/test-reviewer-agent-foreground-${process.pid}.json`
  const controller = new AbortController()
  await runReviewerAgentResidentForeground({
    config: {
      db_path: "data/rd_state.db",
      state_path: statePath,
      environment_id: "test:reviewer-resident",
      worker_id: "reviewer-worker-test",
      source_revision: "fixture",
      lease_duration_ms: 1_200_000,
      run_duration_ms: 900_000,
      max_attempts: 3,
      poll_interval_ms: 10,
      interval_ms: 10,
      max_cycles: 1,
    },
    host: {} as AgentHostPort,
    artifacts: memoryArtifacts(),
    signal: controller.signal,
    dependencies: {
      cycle: async () => ({
        schema_version: "trade.rd-reviewer-agent-resident-cycle.v1",
        status: "idle",
        job_id: null,
        lease_generation: null,
        reviewer_run_id: null,
        result_id: null,
        decision: null,
        failure_class: null,
        registry_authority: "none",
        deployment_authority: "none",
        trading_authority: false,
      }),
      wait: async () => undefined,
      now: () => "2026-07-23T00:00:00.000Z",
    },
  })
  const state = JSON.parse(
    readFileSync(resolveRepoPath(statePath), "utf8"),
  ) as Record<string, unknown>
  assert.equal(state.status, "stopped")
  assert.equal(state.cycles, 1)
  assert.equal(state.trading_authority, false)
  assert.equal(state.deployment_authority, "none")
  await Bun.$`/usr/bin/trash ${resolveRepoPath(statePath)}`.quiet()
  assert.match(displayPath(resolveRepoPath(statePath)), /^tmp\//)
})
