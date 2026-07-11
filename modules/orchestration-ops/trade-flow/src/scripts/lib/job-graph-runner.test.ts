import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { Database } from "bun:sqlite"
import { readCycleSummary } from "../../../../ops-runtime-store/src/lib/ops-runtime-store"
import { appendPlanEvent, ensureSchema } from "../../../../../portfolio-execution-state/event-store/src/lib/event-store"
import { runAutomationJobGraph, type CommandExecutionResult } from "./job-graph-runner"

test("job graph runner records dry-run lifecycle into ops runtime store", async () => {
  const dir = mkdtempSync(join(tmpdir(), "job-graph-runner-"))
  const tradeDbPath = join(dir, "trade.db")
  const opsDbPath = join(dir, "ops_runtime.db")
  const tradeDb = new Database(tradeDbPath)
  try {
    ensureSchema(tradeDb)
    appendPlanEvent(tradeDb, {
      event_key: "obs-job-graph-1",
      chain_id: "flow-job-graph-1",
      kind: "observe",
      created_at: "2026-07-11T00:00:00Z",
      body_json: {
        source: "slow_track",
        symbol: "BTCUSDT",
        side: "long",
      },
    })

    const result = await runAutomationJobGraph(tradeDb, tradeDbPath, {
      cycle_id: "cycle-job-graph-dry",
      now: "2026-07-11T00:15:00Z",
      ops_runtime_db: opsDbPath,
      execute_jobs: false,
      include_rd_strategy_supervisor: false,
      include_rd_trackers: false,
      include_catalog_hygiene: false,
    })

    assert.equal(result.ok, true)
    assert.equal(result.mode, "dry_run")
    assert.equal(result.ops_runtime_db, opsDbPath)
    const opsSummary = result.ops_summary as {
      counts: { total: number; skipped: number }
      stages: Array<{ stage: string; skipped: number }>
      messages: { inbox: number; outbox: number }
      attention: { needs_human: boolean; severity: string }
    }
    const jobs = result.jobs as Array<{ job_id: string; status: string; reason: string }>
    assert.equal(opsSummary.counts.total, jobs.length)
    assert.equal(opsSummary.counts.skipped, jobs.length)
    assert.equal(opsSummary.stages.some((stage) => stage.stage === "serial_runtime_guard" && stage.skipped > 0), true)
    assert.equal(opsSummary.messages.inbox, jobs.length)
    assert.equal(opsSummary.messages.outbox, jobs.length)
    assert.equal(opsSummary.attention.needs_human, false)
    assert.equal(opsSummary.attention.severity, "none")
    assert.equal(jobs.some((job) => job.job_id === "runtime_health_guard" && job.status === "skipped" && /dry-run/.test(job.reason)), true)
    assert.equal(jobs.some((job) => job.job_id === "ops_notify_dispatch" && job.status === "skipped"), true)

    const opsDb = new Database(opsDbPath)
    try {
      const summary = readCycleSummary(opsDb, "cycle-job-graph-dry") as {
        cycle: { status: string; summary_json: { mode: string; skipped: number } }
        jobs: Array<{ job_id: string; status: string }>
        messages: Array<{ direction: string; job_id: string }>
        ops_summary: { counts: { total: number }; attention: { needs_human: boolean } }
      }
      assert.equal(summary.cycle.status, "completed")
      assert.equal(summary.cycle.summary_json.mode, "dry_run")
      assert.equal(summary.ops_summary.counts.total, jobs.length)
      assert.equal(summary.ops_summary.attention.needs_human, false)
      assert.equal(summary.jobs.length, jobs.length)
      assert.equal(summary.jobs.some((job) => job.job_id === "runtime_health_guard"), true)
      assert.equal(summary.messages.length, jobs.length * 2)
      assert.equal(summary.messages.filter((message) => message.direction === "inbox").length, jobs.length)
      assert.equal(summary.messages.filter((message) => message.direction === "outbox").length, jobs.length)
    } finally {
      opsDb.close()
    }
  } finally {
    tradeDb.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("job graph runner executes command specs through injected executor", async () => {
  const dir = mkdtempSync(join(tmpdir(), "job-graph-runner-exec-"))
  const tradeDbPath = join(dir, "trade.db")
  const opsDbPath = join(dir, "ops_runtime.db")
  const tradeDb = new Database(tradeDbPath)
  try {
    ensureSchema(tradeDb)
    const executed: string[] = []
    const result = await runAutomationJobGraph(tradeDb, tradeDbPath, {
      cycle_id: "cycle-job-graph-exec",
      now: "2026-07-11T00:15:00Z",
      ops_runtime_db: opsDbPath,
      execute_jobs: true,
      include_fast_track: false,
      include_slow_track: false,
      include_rd_strategy_supervisor: false,
      include_rd_trackers: false,
      include_closed_flow_review: false,
      include_catalog_hygiene: false,
    }, async (command): Promise<CommandExecutionResult> => {
      executed.push(`${command.cwd}:${command.argv.join(" ")}`)
      return { exit_code: 0, stdout: "{\"ok\":true}", stderr: "" }
    })

    assert.equal(result.ok, true)
    assert.deepEqual(executed.map((command) => command.split(":")[0]), [
      "modules/orchestration-ops/runtime-health-guard",
      "modules/orchestration-ops/ops-notify-dispatch",
    ])
    const jobs = result.jobs as Array<{ job_id: string; status: string; exit_code?: number }>
    assert.equal(jobs.find((job) => job.job_id === "runtime_health_guard")?.status, "completed")
    assert.equal(jobs.find((job) => job.job_id === "ops_notify_dispatch")?.exit_code, 0)
  } finally {
    tradeDb.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
