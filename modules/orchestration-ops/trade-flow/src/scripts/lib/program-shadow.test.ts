import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"
import test from "node:test"
import { Database } from "bun:sqlite"
import {
  acquireOpsLock,
  buildCycleRun,
  ensureOpsRuntimeSchema,
  readCycleSummary,
  readOpsLock,
  upsertCycleRun,
} from "../../../../ops-runtime-store/src/lib/ops-runtime-store"
import { buildDatabaseIdentity, ensureDatabaseIdentity } from "../../../../../contracts/runtime-core/src/database-identity"
import { ensureSchema } from "../../../../../portfolio-execution-state/event-store/src/lib/event-store"
import { repoRoot } from "../../../../../contracts/runtime-core/src/paths"
import { runAutomationJobGraph, type CommandExecutionResult } from "./job-graph-runner"
import { runProgramShadowWakeup } from "./program-shadow"

const FIXED_CLOCK = new Date("2026-07-23T01:02:30.000Z")

test("program shadow executes only the fixed ops lifecycle profile", async () => {
  const fixture = createFixture("program-shadow-exec-")
  try {
    const executed: Array<{ cwd: string; argv: string[] }> = []
    const result = await runProgramShadowWakeup(
      fixture.tradeDb,
      fixture.tradeDbPath,
      {
        cycle_id: "shadow-cycle-exec",
        now: "2026-07-23T01:02:00Z",
        ops_runtime_db: fixture.opsDbPath,
        runtime_health: {
          require_l2_ready: false,
          require_l2_watch_consumer_ready: false,
          health_id: "caller-controlled-health",
          observed_at: "2000-01-01T00:00:00Z",
        },
      },
      async (command): Promise<CommandExecutionResult> => {
        executed.push({ cwd: command.cwd, argv: command.argv })
        if (command.cwd === "modules/orchestration-ops/runtime-health-guard") {
          return healthResult()
        }
        return { exit_code: 0, stdout: JSON.stringify({ ok: true }), stderr: "" }
      },
      fixedDependencies("holder-exec"),
    )

    assert.equal(result.schema_version, "trade-flow.program-shadow-wakeup-result.v1")
    assert.equal(result.runtime_profile, "shadow_program")
    assert.equal(result.outcome, "executed")
    assert.equal((result.lease as { fencing_token: number }).fencing_token, 1)
    assert.deepEqual(executed.map((item) => item.cwd), [
      "modules/orchestration-ops/runtime-health-guard",
      "modules/orchestration-ops/control-effectiveness-review",
      "modules/orchestration-ops/ops-notify-dispatch",
    ])

    const graph = result.job_graph as {
      jobs: Array<{ job_id: string; status: string }>
      lifecycle_processors: Array<{ processor_id: string; status: string }>
      plan: {
        jobs: Array<{ enabled: boolean }>
        dispatch_model: Record<string, unknown>
        lifecycle_processors: Array<{ processor_id: string; command_spec: { argv: string[] } }>
      }
    }
    assert.equal(graph.jobs.length, 7)
    assert.equal(graph.jobs.every((job) => job.status === "skipped"), true)
    assert.equal(graph.plan.jobs.every((job) => job.enabled === false), true)
    assert.equal(graph.plan.dispatch_model.agent_fallback, "available")
    assert.equal(Object.hasOwn(graph.plan.dispatch_model, "subagent_fanout"), false)
    assert.equal(graph.lifecycle_processors.every((processor) => processor.status === "completed"), true)

    const healthProcessor = graph.plan.lifecycle_processors.find((item) => item.processor_id === "runtime_health_guard")
    const healthPayload = jsonArg(healthProcessor?.command_spec.argv ?? [])
    assert.equal(healthPayload.require_l2_ready, true)
    assert.equal(healthPayload.require_l2_watch_consumer_ready, true)
    assert.equal(healthPayload.health_id, "health-shadow-cycle-exec-holder-exec")
    assert.equal(healthPayload.observed_at, FIXED_CLOCK.toISOString())
    const notifyProcessor = graph.plan.lifecycle_processors.find((item) => item.processor_id === "ops_notify_dispatch")
    const notifyPayload = jsonArg(notifyProcessor?.command_spec.argv ?? [])
    assert.equal(notifyPayload.dry_run, true)
    assert.equal(notifyPayload.notify_id, "notify-shadow-cycle-exec-holder-exec")
    assert.equal(notifyPayload.attempted_at, FIXED_CLOCK.toISOString())
    const reviewProcessor = graph.plan.lifecycle_processors.find((item) => item.processor_id === "control_effectiveness_review")
    const reviewPayload = jsonArg(reviewProcessor?.command_spec.argv ?? [])
    assert.equal(reviewPayload.review_id, "control-review-shadow-cycle-exec-holder-exec")
    assert.equal(reviewPayload.now, FIXED_CLOCK.toISOString())

    const opsDb = new Database(fixture.opsDbPath)
    try {
      const summary = readCycleSummary(opsDb, "shadow-cycle-exec") as { cycle: { status: string } }
      assert.equal(summary.cycle.status, "completed")
      assert.equal(readOpsLock(opsDb, "program-runtime-shadow"), null)
    } finally {
      opsDb.close()
    }
  } finally {
    fixture.close()
  }
})

test("demand-driven shadow leaves per-symbol L2 readiness to the market-data demand owner", async () => {
  const fixture = createFixture("program-demand-driven-shadow-")
  try {
    const executed: Array<{ cwd: string; argv: string[] }> = []
    const result = await runProgramShadowWakeup(
      fixture.tradeDb,
      fixture.tradeDbPath,
      {
        cycle_id: "demand-driven-shadow-cycle",
        now: "2026-07-23T01:02:00Z",
        ops_runtime_db: fixture.opsDbPath,
        runtime_profile: "demand_driven_shadow",
      },
      async (command): Promise<CommandExecutionResult> => {
        executed.push({ cwd: command.cwd, argv: command.argv })
        return command.cwd === "modules/orchestration-ops/runtime-health-guard"
          ? healthResult()
          : { exit_code: 0, stdout: JSON.stringify({ ok: true }), stderr: "" }
      },
      fixedDependencies("holder-demand-driven"),
    )
    const graph = result.job_graph as {
      plan: { lifecycle_processors: Array<{ processor_id: string; command_spec: { argv: string[] } }> }
    }
    const healthProcessor = graph.plan.lifecycle_processors.find((item) => item.processor_id === "runtime_health_guard")
    const healthPayload = jsonArg(healthProcessor?.command_spec.argv ?? [])
    assert.equal(result.runtime_profile, "demand_driven_shadow")
    assert.equal(result.business_status, "completed")
    assert.equal(healthPayload.require_l2_ready, false)
    assert.equal(healthPayload.require_l2_watch_consumer_ready, false)
    assert.deepEqual(result.safety, {
      domain_jobs_enabled: false,
      enabled_domain_jobs: [],
      allowed_domain_writes: [],
      live_writes_allowed: false,
      notify_dry_run: true,
      l2_owner_health_required: false,
      l2_consumer_health_required: false,
    })
    assert.deepEqual(executed.map((item) => item.cwd), [
      "modules/orchestration-ops/runtime-health-guard",
      "modules/orchestration-ops/control-effectiveness-review",
      "modules/orchestration-ops/ops-notify-dispatch",
    ])
  } finally {
    fixture.close()
  }
})

test("program catalog hygiene canary enables only J06 without GC or live writes", async () => {
  const fixture = createFixture("program-shadow-j06-canary-")
  try {
    const executed: Array<{ cwd: string; argv: string[]; timeout_ms?: number }> = []
    const result = await runProgramShadowWakeup(
      fixture.tradeDb,
      fixture.tradeDbPath,
      {
        cycle_id: "shadow-cycle-j06-canary",
        now: "2026-07-23T01:03:00Z",
        ops_runtime_db: fixture.opsDbPath,
        runtime_profile: "catalog_hygiene_canary",
      },
      async (command, options): Promise<CommandExecutionResult> => {
        executed.push({ cwd: command.cwd, argv: command.argv, timeout_ms: options?.timeoutMs })
        if (command.cwd === "modules/orchestration-ops/runtime-health-guard") return healthResult()
        if (command.cwd === "modules/artifact-knowledge/artifact-catalog") {
          return {
            exit_code: 0,
            stdout: JSON.stringify({
              runtime_result: {
                schema_id: "trade.domain-runtime.domain-job-result.v1",
                ok: true,
                status: "ok",
                domain: "artifact-knowledge",
                job_id: "catalog_hygiene_scan",
                idempotency_key: "shadow-cycle-j06-canary:J06",
                input_refs: ["artifact-root:data", "artifact-root:tmp"],
                output_refs: ["artifact_catalog:scan/shadow-cycle-j06-canary"],
                writes: { artifact_catalog: true },
                incidents: [],
                audit: { cycle_id: "shadow-cycle-j06-canary", ticket_no: "J06" },
              },
            }),
            stderr: "",
          }
        }
        return { exit_code: 0, stdout: JSON.stringify({ ok: true }), stderr: "" }
      },
      fixedDependencies("holder-j06-canary"),
    )

    assert.equal(result.runtime_profile, "catalog_hygiene_canary")
    assert.equal(result.outcome, "executed")
    assert.equal(result.business_status, "completed")
    assert.deepEqual(result.safety, {
      domain_jobs_enabled: true,
      enabled_domain_jobs: ["catalog_hygiene_scan"],
      allowed_domain_writes: ["artifact_catalog"],
      live_writes_allowed: false,
      notify_dry_run: true,
      l2_owner_health_required: true,
      l2_consumer_health_required: true,
    })
    const graph = result.job_graph as {
      jobs: Array<{ job_id: string; status: string; runtime_result: { writes: Record<string, boolean> } }>
    }
    const completed = graph.jobs.filter((job) => job.status === "completed")
    assert.equal(completed.length, 1)
    assert.equal(completed[0].job_id, "catalog_hygiene_scan")
    assert.deepEqual(completed[0].runtime_result.writes, { artifact_catalog: true })

    const catalogCommands = executed.filter((item) => item.cwd === "modules/artifact-knowledge/artifact-catalog")
    assert.equal(catalogCommands.length, 1)
    assert.equal(catalogCommands[0].argv.includes("--catalog-hygiene-job"), true)
    assert.equal(catalogCommands[0].argv.includes("--catalog-gc"), false)
    assert.equal(catalogCommands[0].argv.includes("--artifact-gc"), false)
    assert.equal(catalogCommands[0].argv.includes("--yes"), false)
    assert.equal(executed.every((command) => command.timeout_ms === 90_000), true)
  } finally {
    fixture.close()
  }
})

test("program full shadow enables the fixed J01-J07 graph without live commands", async () => {
  const fixture = createFixture("program-full-shadow-")
  try {
    const executed: Array<{ cwd: string; argv: string[] }> = []
    const result = await runProgramShadowWakeup(
      fixture.tradeDb,
      fixture.tradeDbPath,
      {
        cycle_id: "full-shadow-cycle-1",
        now: "2026-07-23T01:04:00Z",
        ops_runtime_db: fixture.opsDbPath,
        runtime_profile: "full_shadow",
        rd_trackers: [{ tracker_id: "tracker-fixture-1" }],
      },
      async (command): Promise<CommandExecutionResult> => {
        executed.push({ cwd: command.cwd, argv: command.argv })
        return command.cwd === "modules/orchestration-ops/runtime-health-guard"
          ? healthResult()
          : { exit_code: 0, stdout: JSON.stringify({ ok: true }), stderr: "" }
      },
      fixedDependencies("holder-full-shadow"),
    )

    assert.equal(result.runtime_profile, "full_shadow")
    assert.equal(result.outcome, "executed")
    const safety = result.safety as {
      domain_jobs_enabled: boolean
      enabled_domain_jobs: string[]
      allowed_domain_writes: string[]
      live_writes_allowed: boolean
      notify_dry_run: boolean
    }
    assert.equal(safety.domain_jobs_enabled, true)
    assert.equal(safety.enabled_domain_jobs.length, 7)
    assert.deepEqual(safety.allowed_domain_writes, [
      "trade_event_store", "research_state_store", "artifact_catalog", "governance_ledger",
    ])
    assert.equal(safety.live_writes_allowed, false)
    assert.equal(safety.notify_dry_run, true)
    const graph = result.job_graph as {
      jobs: Array<{ job_id: string; status: string }>
      plan: { jobs: Array<{ job_id: string; enabled: boolean }>; cadence: Record<string, { due: boolean }> }
    }
    assert.equal(graph.jobs.length, 7)
    assert.equal(graph.plan.jobs.every((job) => job.enabled), true)
    assert.equal(Object.values(graph.plan.cadence).every((cadence) => cadence.due), true)
    assert.equal(executed.some((command) => command.argv.includes("--run-live-small")), false)
    assert.equal(executed.some((command) => command.argv.some((part) => part.includes("binance-write"))), false)
    assert.equal(executed.some((command) => command.argv.includes("--yes")), false)
  } finally {
    fixture.close()
  }
})

test("program shadow skips a terminal cycle without executing it twice", async () => {
  const fixture = createFixture("program-shadow-terminal-")
  try {
    let executions = 0
    const executor = async (command: { cwd: string }): Promise<CommandExecutionResult> => {
      executions += 1
      return command.cwd === "modules/orchestration-ops/runtime-health-guard"
        ? healthResult()
        : { exit_code: 0, stdout: JSON.stringify({ ok: true }), stderr: "" }
    }
    const input = {
      cycle_id: "shadow-cycle-terminal",
      now: "2026-07-23T01:02:00Z",
      ops_runtime_db: fixture.opsDbPath,
    }
    const first = await runProgramShadowWakeup(
      fixture.tradeDb,
      fixture.tradeDbPath,
      input,
      executor,
      fixedDependencies("holder-first"),
    )
    const second = await runProgramShadowWakeup(
      fixture.tradeDb,
      fixture.tradeDbPath,
      input,
      executor,
      fixedDependencies("holder-second"),
    )

    assert.equal(first.outcome, "executed")
    assert.equal(second.outcome, "skipped_terminal")
    assert.equal(second.prior_status, "completed")
    assert.equal(executions, 3)
  } finally {
    fixture.close()
  }
})

test("program shadow skips an active lease", async () => {
  const fixture = createFixture("program-shadow-lock-")
  try {
    const opsDb = new Database(fixture.opsDbPath)
    try {
      ensureOpsSchema(opsDb)
      const lock = acquireOpsLock(opsDb, {
        lock_key: "program-runtime-shadow",
        holder_id: "other-runtime",
        acquired_at: "2026-07-23T01:02:00Z",
        expires_at: "2026-07-23T01:08:00Z",
      })
      assert.equal(lock.acquired, true)
    } finally {
      opsDb.close()
    }

    let executions = 0
    const result = await runProgramShadowWakeup(
      fixture.tradeDb,
      fixture.tradeDbPath,
      {
        cycle_id: "shadow-cycle-lock",
        ops_runtime_db: fixture.opsDbPath,
      },
      async (): Promise<CommandExecutionResult> => {
        executions += 1
        return { exit_code: 0, stdout: "{}", stderr: "" }
      },
      fixedDependencies("contender"),
    )

    assert.equal(result.outcome, "skipped_lock")
    assert.equal((result.lease as { acquired: boolean }).acquired, false)
    assert.equal(executions, 0)
  } finally {
    fixture.close()
  }
})

test("program shadow recovers a running cycle after a stale lease", async () => {
  const fixture = createFixture("program-shadow-recover-")
  try {
    const opsDb = new Database(fixture.opsDbPath)
    try {
      ensureOpsSchema(opsDb)
      upsertCycleRun(opsDb, buildCycleRun({
        cycle_id: "shadow-cycle-recover",
        now: "2026-07-23T00:50:00Z",
        status: "running",
      }))
      acquireOpsLock(opsDb, {
        lock_key: "program-runtime-shadow",
        holder_id: "crashed-runtime",
        acquired_at: "2026-07-23T00:50:00Z",
        expires_at: "2026-07-23T00:55:00Z",
      })
    } finally {
      opsDb.close()
    }

    const executed: Array<{ cwd: string; argv: string[] }> = []
    const result = await runProgramShadowWakeup(
      fixture.tradeDb,
      fixture.tradeDbPath,
      {
        cycle_id: "shadow-cycle-recover",
        now: "2026-07-23T01:02:00Z",
        ops_runtime_db: fixture.opsDbPath,
      },
      async (command): Promise<CommandExecutionResult> => {
        executed.push({ cwd: command.cwd, argv: command.argv })
        return command.cwd === "modules/orchestration-ops/runtime-health-guard"
          ? healthResult()
          : { exit_code: 0, stdout: JSON.stringify({ ok: true }), stderr: "" }
      },
      fixedDependencies("recovery-runtime"),
    )

    assert.equal(result.outcome, "recovered_running")
    assert.equal((result.lease as { released: boolean }).released, true)
    assert.equal((result.lease as { fencing_token: number }).fencing_token, 2)
    const health = executed.find((item) => item.cwd === "modules/orchestration-ops/runtime-health-guard")
    assert.equal(jsonArg(health?.argv ?? []).health_id, "health-shadow-cycle-recover-recovery-runtime")
    const notify = executed.find((item) => item.cwd === "modules/orchestration-ops/ops-notify-dispatch")
    assert.equal(jsonArg(notify?.argv ?? []).notify_id, "notify-shadow-cycle-recover-recovery-runtime")
  } finally {
    fixture.close()
  }
})

test("program shadow rejects caller attempts to widen its write scope", async () => {
  const fixture = createFixture("program-shadow-input-")
  try {
    await assert.rejects(
      runProgramShadowWakeup(
        fixture.tradeDb,
        fixture.tradeDbPath,
        {
          ops_runtime_db: fixture.opsDbPath,
          allow_live_writes: true,
        },
      ),
      /program shadow input does not allow: allow_live_writes/,
    )
    await assert.rejects(
      runProgramShadowWakeup(
        fixture.tradeDb,
        fixture.tradeDbPath,
        {
          ops_runtime_db: fixture.opsDbPath,
          runtime_profile: "all_domain_jobs",
        },
      ),
      /runtime_profile must be shadow_program, demand_driven_shadow, catalog_hygiene_canary, or full_shadow/,
    )
    await assert.rejects(
      runProgramShadowWakeup(
        fixture.tradeDb,
        fixture.tradeDbPath,
        { ops_runtime_db: fixture.opsDbPath, rd_trackers: [] },
      ),
      /domain job configuration is allowed only for runtime_profile=full_shadow/,
    )
  } finally {
    fixture.close()
  }
})

test("program and Agent job-graph entries expose the same semantic parity projection", async () => {
  const fixture = createFixture("program-shadow-parity-")
  try {
    const executor = async (command: { cwd: string }): Promise<CommandExecutionResult> => command.cwd === "modules/orchestration-ops/runtime-health-guard"
      ? healthResult()
      : { exit_code: 0, stdout: JSON.stringify({ ok: true }), stderr: "" }
    const program = await runProgramShadowWakeup(
      fixture.tradeDb,
      fixture.tradeDbPath,
      {
        cycle_id: "shadow-cycle-parity-program",
        now: "2026-07-23T01:02:00Z",
        ops_runtime_db: fixture.opsDbPath,
      },
      executor,
      fixedDependencies("parity-program"),
    )
    const agentGraph = await runAutomationJobGraph(
      fixture.tradeDb,
      fixture.tradeDbPath,
      {
        cycle_id: "shadow-cycle-parity-agent",
        now: "2026-07-23T01:02:00Z",
        ops_runtime_db: join(dirname(fixture.opsDbPath), "agent_ops_runtime.db"),
        command_timeout_ms: 30_000,
        execute_jobs: true,
        allow_live_writes: false,
        include_runtime_health: true,
        include_account_reconcile: false,
        include_fast_track: false,
        include_slow_track: false,
        include_rd_strategy_supervisor: false,
        include_rd_trackers: false,
        include_closed_flow_review: false,
        include_catalog_hygiene: false,
        include_control_effectiveness_review: true,
        include_ops_notify: true,
        runtime_health: {
          require_l2_ready: true,
          require_l2_watch_consumer_ready: true,
          health_id: "health-shadow-cycle-parity-agent",
          observed_at: FIXED_CLOCK.toISOString(),
        },
        control_effectiveness_review: {
          review_id: "control-review-shadow-cycle-parity-agent",
          now: FIXED_CLOCK.toISOString(),
        },
        ops_notify: {
          dry_run: true,
          notify_id: "notify-shadow-cycle-parity-agent",
          attempted_at: FIXED_CLOCK.toISOString(),
        },
      },
      executor,
    )

    const programParity = (program.job_graph as { parity_projection: Record<string, unknown> }).parity_projection
    const agentParity = agentGraph.parity_projection as Record<string, unknown>
    assert.equal(programParity.schema_version, "trade-flow.job-graph-parity-projection.v1")
    assert.equal(programParity.projection_hash, agentParity.projection_hash)
    assert.deepEqual(programParity.jobs, agentParity.jobs)
    assert.deepEqual(programParity.incidents, agentParity.incidents)
  } finally {
    fixture.close()
  }
})

test("program shadow returns a bounded result while the ops store stays busy", async () => {
  const fixture = createFixture("program-shadow-busy-")
  const blocker = new Database(fixture.opsDbPath)
  try {
    ensureOpsSchema(blocker)
    blocker.run("BEGIN EXCLUSIVE")
    const startedAt = Date.now()
    const result = await runProgramShadowWakeup(
      fixture.tradeDb,
      fixture.tradeDbPath,
      {
        cycle_id: "shadow-cycle-busy",
        ops_runtime_db: fixture.opsDbPath,
      },
      undefined,
      fixedDependencies("busy-contender"),
    )

    assert.equal(result.outcome, "ops_store_busy")
    assert.match(String(result.reason), /remained busy after 1000ms/)
    assert.equal((result.lease as { acquired: boolean }).acquired, false)
    assert.equal(Date.now() - startedAt >= 900, true)
  } finally {
    try {
      blocker.run("ROLLBACK")
    } catch {}
    blocker.close()
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
      health_ref: "ops_runtime_store:runtime_health/health-shadow",
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

function fixedDependencies(holderId: string): { clock: () => Date; holderId: () => string } {
  return {
    clock: () => FIXED_CLOCK,
    holderId: () => holderId,
  }
}

function ensureOpsSchema(db: Database): void {
  ensureDatabaseIdentity(db, buildDatabaseIdentity("local:local", "ops_runtime_store"))
  ensureOpsRuntimeSchema(db)
}

function createFixture(prefix: string): {
  tradeDb: Database
  tradeDbPath: string
  opsDbPath: string
  close: () => void
} {
  const root = join(repoRoot(), "tmp", "check")
  mkdirSync(root, { recursive: true })
  const dir = mkdtempSync(join(root, prefix))
  const tradeDbPath = join(dir, "trade.db")
  const opsDbPath = join(dir, "ops_runtime.db")
  const tradeDb = new Database(tradeDbPath)
  ensureDatabaseIdentity(tradeDb, buildDatabaseIdentity("local:local", "trade_event_store"))
  ensureSchema(tradeDb)
  return {
    tradeDb,
    tradeDbPath,
    opsDbPath,
    close: () => {
      tradeDb.close()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

function jsonArg(argv: string[]): Record<string, unknown> {
  const index = argv.indexOf("--json")
  assert.notEqual(index, -1)
  return JSON.parse(argv[index + 1] ?? "{}") as Record<string, unknown>
}
