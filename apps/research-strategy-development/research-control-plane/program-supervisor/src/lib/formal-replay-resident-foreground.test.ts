import { readFileSync, rmSync } from "node:fs"
import { expect, test } from "bun:test"
import { resolveRepoPath } from "../../../../../contracts/runtime-core/src/paths"
import {
  runFormalReplayResidentForeground,
} from "./formal-replay-resident-foreground"

test("formal Replay foreground publishes bounded lifecycle state", async () => {
  const root = `tmp/formal-replay-foreground-${process.pid}-${Date.now()}`
  const statePath = `${root}/state.json`
  let cycles = 0
  try {
    await runFormalReplayResidentForeground({
      db_path: `${root}/rd.db`,
      environment_id: "test:formal-replay-foreground",
      queue_worker_id: "resident-worker-1",
      queue_lease_duration_ms: 600_000,
      state_path: statePath,
      interval_ms: 100,
      max_cycles: 2,
    }, new AbortController().signal, {
      cycle: () => {
        cycles += 1
        return {
          schema_version: "trade.rd-formal-replay-resident-cycle.v1",
          status: "idle",
          job_id: null,
          lease_generation: null,
          resumed: false,
          replay_status: null,
          result_id: null,
          failure_class: null,
          review_authority: "none",
          deployment_authority: "none",
          trading_authority: false,
        }
      },
      wait: async () => undefined,
      now: () => "2026-07-23T00:00:00.000Z",
    })
    expect(cycles).toBe(2)
    const state = JSON.parse(
      readFileSync(resolveRepoPath(statePath), "utf8"),
    )
    expect(state.status).toBe("stopped")
    expect(state.cycles).toBe(2)
    expect(state.trading_authority).toBe(false)
  } finally {
    rmSync(resolveRepoPath(root), { recursive: true, force: true })
  }
})
