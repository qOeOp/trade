import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"
import { Database } from "bun:sqlite"
import {
  acquireOpsLock,
  ensureOpsRuntimeSchema,
  readOpsLock,
  readRuntimeParityObservations,
} from "../../../../ops-runtime-store/src/lib/ops-runtime-store"
import { ensureSchema } from "../../../../../portfolio-execution-state/event-store/src/lib/event-store"
import type { CommandExecutionResult } from "./job-graph-runner"
import { runProgramShadowSupervisor } from "./program-shadow-supervisor"

test("program shadow supervisor runs stable cadence slots and releases its fenced lease", async () => {
  const fixture = createFixture("program-shadow-supervisor-")
  try {
    let now = new Date("2026-07-23T04:00:00.000Z")
    let executions = 0
    const result = await runProgramShadowSupervisor(
      fixture.tradeDb,
      fixture.tradeDbPath,
      {
        ops_runtime_db: fixture.opsDbPath,
        interval_seconds: 1,
        max_cycles: 2,
      },
      async (command): Promise<CommandExecutionResult> => {
        executions += 1
        return command.cwd === "modules/orchestration-ops/runtime-health-guard"
          ? healthResult()
          : { exit_code: 0, stdout: JSON.stringify({ ok: true }), stderr: "" }
      },
      {
        clock: () => new Date(now),
        holderId: () => "resident-supervisor",
        sleep: async (milliseconds) => {
          now = new Date(now.getTime() + milliseconds)
          return "elapsed"
        },
      },
    )

    assert.equal(result.outcome, "completed")
    assert.equal(result.stop_reason, "max_cycles")
    assert.equal((result.cycles as { attempted: number; executed: number }).attempted, 2)
    assert.equal((result.cycles as { attempted: number; executed: number }).executed, 2)
    assert.equal((result.cycles as { last_cycle_id: string }).last_cycle_id, "program-shadow-2026-07-23T04-00-01-000Z")
    assert.equal((result.lease as { fencing_token: number; released: boolean }).fencing_token, 1)
    assert.equal((result.lease as { fencing_token: number; released: boolean }).released, true)
    assert.equal(executions, 6)

    const opsDb = new Database(fixture.opsDbPath)
    try {
      assert.equal(readOpsLock(opsDb, "program-runtime-shadow-supervisor"), null)
    } finally {
      opsDb.close()
    }
  } finally {
    fixture.close()
  }
})

test("program shadow supervisor records independent Agent/program parity observations", async () => {
  const fixture = createFixture("program-shadow-supervisor-parity-")
  try {
    let executions = 0
    const result = await runProgramShadowSupervisor(
      fixture.tradeDb,
      fixture.tradeDbPath,
      {
        ops_runtime_db: fixture.opsDbPath,
        max_cycles: 1,
        observe_agent_parity: true,
      },
      async (command): Promise<CommandExecutionResult> => {
        executions += 1
        return command.cwd === "modules/orchestration-ops/runtime-health-guard"
          ? healthResult()
          : { exit_code: 0, stdout: JSON.stringify({ ok: true }), stderr: "" }
      },
      {
        clock: () => new Date("2026-07-23T04:03:00.000Z"),
        holderId: () => "parity-supervisor",
      },
    )

    assert.equal(result.outcome, "completed")
    assert.equal(executions, 6)
    assert.deepEqual(result.parity_observation, {
      enabled: true,
      attempted: 1,
      matched: 1,
      mismatched: 0,
      last: (result.parity_observation as { last: unknown }).last,
    })
    const last = (result.parity_observation as { last: { status: string } }).last
    assert.equal(last.status, "match")

    const opsDb = new Database(fixture.opsDbPath)
    try {
      const observations = readRuntimeParityObservations(opsDb)
      assert.equal(observations.length, 1)
      assert.equal(observations[0].status, "match")
      assert.equal(observations[0].program_projection_hash, observations[0].agent_projection_hash)
    } finally {
      opsDb.close()
    }
  } finally {
    fixture.close()
  }
})

test("program shadow supervisor drains its in-flight wakeup after a stop signal", async () => {
  const fixture = createFixture("program-shadow-supervisor-drain-")
  const controller = new AbortController()
  try {
    let executions = 0
    const result = await runProgramShadowSupervisor(
      fixture.tradeDb,
      fixture.tradeDbPath,
      {
        ops_runtime_db: fixture.opsDbPath,
        interval_seconds: 1,
      },
      async (command): Promise<CommandExecutionResult> => {
        executions += 1
        if (executions === 1) controller.abort()
        return command.cwd === "modules/orchestration-ops/runtime-health-guard"
          ? healthResult()
          : { exit_code: 0, stdout: JSON.stringify({ ok: true }), stderr: "" }
      },
      {
        clock: () => new Date("2026-07-23T04:05:00.000Z"),
        holderId: () => "draining-supervisor",
        signal: controller.signal,
      },
    )

    assert.equal(result.outcome, "completed")
    assert.equal(result.stop_reason, "signal")
    assert.equal((result.cycles as { attempted: number }).attempted, 1)
    assert.equal(executions, 3)
    assert.equal((result.lease as { released: boolean }).released, true)
  } finally {
    fixture.close()
  }
})

test("program shadow supervisor duration bounds a longer cadence sleep", async () => {
  const fixture = createFixture("program-shadow-supervisor-duration-")
  try {
    let now = new Date("2026-07-23T04:07:00.000Z")
    const sleeps: number[] = []
    const result = await runProgramShadowSupervisor(
      fixture.tradeDb,
      fixture.tradeDbPath,
      {
        ops_runtime_db: fixture.opsDbPath,
        interval_seconds: 60,
        duration_seconds: 2,
      },
      async (command): Promise<CommandExecutionResult> => command.cwd === "modules/orchestration-ops/runtime-health-guard"
        ? healthResult()
        : { exit_code: 0, stdout: JSON.stringify({ ok: true }), stderr: "" },
      {
        clock: () => new Date(now),
        holderId: () => "duration-supervisor",
        sleep: async (milliseconds) => {
          sleeps.push(milliseconds)
          now = new Date(now.getTime() + milliseconds)
          return "elapsed"
        },
      },
    )

    assert.equal(result.outcome, "completed")
    assert.equal(result.stop_reason, "duration")
    assert.equal((result.cycles as { attempted: number }).attempted, 1)
    assert.deepEqual(sleeps, [2_000])
  } finally {
    fixture.close()
  }
})

test("program shadow supervisor refuses a second active owner", async () => {
  const fixture = createFixture("program-shadow-supervisor-lock-")
  try {
    const opsDb = new Database(fixture.opsDbPath)
    try {
      ensureOpsRuntimeSchema(opsDb)
      assert.equal(acquireOpsLock(opsDb, {
        lock_key: "program-runtime-shadow-supervisor",
        holder_id: "existing-supervisor",
        acquired_at: "2026-07-23T04:10:00.000Z",
        expires_at: "2026-07-23T04:11:00.000Z",
      }).acquired, true)
    } finally {
      opsDb.close()
    }

    const result = await runProgramShadowSupervisor(
      fixture.tradeDb,
      fixture.tradeDbPath,
      { ops_runtime_db: fixture.opsDbPath, max_cycles: 1 },
      undefined,
      {
        clock: () => new Date("2026-07-23T04:10:30.000Z"),
        holderId: () => "contending-supervisor",
      },
    )
    assert.equal(result.outcome, "skipped_lock")
    assert.equal(result.stop_reason, "active_supervisor")
    assert.equal((result.cycles as { attempted: number }).attempted, 0)
  } finally {
    fixture.close()
  }
})

test("program shadow supervisor recovers the expired lease of a crashed owner", async () => {
  const fixture = createFixture("program-shadow-supervisor-crash-recovery-")
  try {
    const opsDb = new Database(fixture.opsDbPath)
    try {
      ensureOpsRuntimeSchema(opsDb)
      const abandoned = acquireOpsLock(opsDb, {
        lock_key: "program-runtime-shadow-supervisor",
        holder_id: "crashed-supervisor",
        acquired_at: "2026-07-23T04:12:00.000Z",
        expires_at: "2026-07-23T04:12:20.000Z",
      })
      assert.equal(abandoned.acquired, true)
      assert.equal(abandoned.lock.fencing_token, 1)
    } finally {
      opsDb.close()
    }

    const result = await runProgramShadowSupervisor(
      fixture.tradeDb,
      fixture.tradeDbPath,
      { ops_runtime_db: fixture.opsDbPath, max_cycles: 1 },
      async (command): Promise<CommandExecutionResult> => command.cwd === "modules/orchestration-ops/runtime-health-guard"
        ? healthResult()
        : { exit_code: 0, stdout: JSON.stringify({ ok: true }), stderr: "" },
      {
        clock: () => new Date("2026-07-23T04:12:21.000Z"),
        holderId: () => "recovery-supervisor",
      },
    )

    assert.equal(result.outcome, "completed")
    assert.equal((result.lease as { fencing_token: number; recovered_stale: boolean }).fencing_token, 2)
    assert.equal((result.lease as { fencing_token: number; recovered_stale: boolean }).recovered_stale, true)
    assert.equal((result.cycles as { attempted: number }).attempted, 1)
  } finally {
    fixture.close()
  }
})

test("program shadow supervisor returns a bounded blocked result while SQLite stays busy", async () => {
  const fixture = createFixture("program-shadow-supervisor-busy-")
  const blocker = new Database(fixture.opsDbPath)
  try {
    ensureOpsRuntimeSchema(blocker)
    blocker.run("BEGIN EXCLUSIVE")
    let executions = 0
    const startedAt = Date.now()
    const result = await runProgramShadowSupervisor(
      fixture.tradeDb,
      fixture.tradeDbPath,
      { ops_runtime_db: fixture.opsDbPath, max_cycles: 1 },
      async (): Promise<CommandExecutionResult> => {
        executions += 1
        return { exit_code: 0, stdout: "{}", stderr: "" }
      },
      {
        clock: () => new Date("2026-07-23T04:15:00.000Z"),
        holderId: () => "busy-supervisor",
      },
    )

    assert.equal(result.outcome, "ops_store_busy")
    assert.equal(result.stop_reason, "ops_store_busy")
    assert.equal((result.cycles as { attempted: number }).attempted, 0)
    assert.equal((result.lease as { acquired: boolean; recovered_stale: boolean }).acquired, false)
    assert.equal((result.lease as { acquired: boolean; recovered_stale: boolean }).recovered_stale, false)
    assert.equal(executions, 0)
    assert.equal(Date.now() - startedAt >= 900, true)
  } finally {
    try {
      blocker.run("ROLLBACK")
    } catch {}
    blocker.close()
    fixture.close()
  }
})

test("program shadow supervisor stops when a newer fencing generation takes over", async () => {
  const fixture = createFixture("program-shadow-supervisor-fenced-")
  let now = new Date("2026-07-23T04:20:00.000Z")
  let tookOver = false
  try {
    const result = await runProgramShadowSupervisor(
      fixture.tradeDb,
      fixture.tradeDbPath,
      { ops_runtime_db: fixture.opsDbPath, interval_seconds: 1 },
      async (command): Promise<CommandExecutionResult> => {
        if (!tookOver) {
          tookOver = true
          now = new Date(now.getTime() + 21_000)
          const contenderDb = new Database(fixture.opsDbPath)
          try {
            ensureOpsRuntimeSchema(contenderDb)
            const takeover = acquireOpsLock(contenderDb, {
              lock_key: "program-runtime-shadow-supervisor",
              holder_id: "newer-supervisor",
              acquired_at: now.toISOString(),
              expires_at: new Date(now.getTime() + 20_000).toISOString(),
            })
            assert.equal(takeover.acquired, true)
            assert.equal(takeover.lock.fencing_token, 2)
          } finally {
            contenderDb.close()
          }
        }
        return command.cwd === "modules/orchestration-ops/runtime-health-guard"
          ? healthResult()
          : { exit_code: 0, stdout: JSON.stringify({ ok: true }), stderr: "" }
      },
      {
        clock: () => new Date(now),
        holderId: () => "stale-supervisor",
      },
    )

    assert.equal(result.outcome, "lease_lost")
    assert.equal(result.stop_reason, "lease_lost")
    assert.equal((result.cycles as { attempted: number }).attempted, 1)
    assert.equal((result.lease as { fencing_token: number; released: boolean }).fencing_token, 1)
    assert.equal((result.lease as { fencing_token: number; released: boolean }).released, false)
    const opsDb = new Database(fixture.opsDbPath)
    try {
      assert.equal(readOpsLock(opsDb, "program-runtime-shadow-supervisor")?.holder_id, "newer-supervisor")
    } finally {
      opsDb.close()
    }
  } finally {
    fixture.close()
  }
})

function healthResult(): CommandExecutionResult {
  return {
    exit_code: 0,
    stdout: JSON.stringify({
      ok: true,
      processor_id: "runtime_health_guard",
      lifecycle_phase: "pre_cycle",
      status: "ok",
      health_ref: "ops_runtime_store:runtime_health/health-supervisor",
      health: {
        checks_json: {
          checks: [
            { name: "l2_service:owner_health", status: "ok" },
            { name: "l2_watch_consumer:owner_health", status: "ok" },
          ],
        },
      },
    }),
    stderr: "",
  }
}

function createFixture(prefix: string): {
  dir: string
  tradeDbPath: string
  opsDbPath: string
  tradeDb: Database
  close: () => void
} {
  const checkRoot = join(process.cwd(), "../../..", "tmp/check")
  mkdirSync(checkRoot, { recursive: true })
  const dir = mkdtempSync(join(checkRoot, prefix))
  const tradeDbPath = join(dir, "trade.db")
  const opsDbPath = join(dir, "ops_runtime.db")
  const tradeDb = new Database(tradeDbPath)
  ensureSchema(tradeDb)
  return {
    dir,
    tradeDbPath,
    opsDbPath,
    tradeDb,
    close: () => {
      tradeDb.close()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}
