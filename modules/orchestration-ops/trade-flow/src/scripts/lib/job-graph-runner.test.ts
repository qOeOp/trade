import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"
import { Database } from "bun:sqlite"
import { readCycleSummary, readIncidents } from "../../../../ops-runtime-store/src/lib/ops-runtime-store"
import { appendPlanEvent, ensureSchema } from "../../../../../portfolio-execution-state/event-store/src/lib/event-store"
import { projectJobGraphParity, runAutomationJobGraph, type CommandExecutionResult } from "./job-graph-runner"

test("job graph parity projection ignores attempt identity and detects semantic drift", () => {
  const base = {
    mode: "execute",
    summary: {
      total_jobs: 1,
      total_processors: 1,
      completed: 1,
      skipped: 0,
      failed: 0,
      blocked: 0,
      processors: { completed: 1, skipped: 0, failed: 0, blocked: 0 },
    },
    ops_summary: {
      incidents: { total: 0, open: 0, critical: 0, warning: 0 },
      attention: { needs_human: false, severity: "none" },
    },
    jobs: [{
      ticket_no: "J01",
      job_id: "account_reconcile_guard",
      target_domain: "live-execution-control",
      stage: "serial_account_reconcile",
      status: "completed",
      reason: "command completed",
      result_ref: "ops-runtime://cycle/first/job/J01",
    }],
    lifecycle_processors: [{
      processor_id: "runtime_health_guard",
      lifecycle_phase: "pre_cycle",
      stage: "pre_cycle",
      status: "completed",
      reason: "runtime health status ok",
      result_ref: "ops-runtime://health/first",
      health_checks: { "l2_service:owner_health": "ok" },
    }],
  }
  const first = projectJobGraphParity({ cycle_id: "first", ...base })
  const second = projectJobGraphParity({
    cycle_id: "second",
    ...base,
    jobs: [{ ...base.jobs[0], result_ref: "ops-runtime://cycle/second/job/J01" }],
  })
  const drifted = projectJobGraphParity({
    ...base,
    jobs: [{ ...base.jobs[0], status: "blocked", reason: "dependency blocked" }],
  })

  assert.equal(first.projection_hash, second.projection_hash)
  assert.notEqual(first.projection_hash, drifted.projection_hash)
})

test("job graph runner records dry-run lifecycle into ops runtime store", async () => {
  const dir = makeCheckDir("job-graph-runner-")
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
    const jobs = result.jobs as Array<{ job_id: string; status: string; reason: string; runtime_result?: Record<string, unknown> }>
    const processors = result.lifecycle_processors as Array<{ processor_id: string; status: string; reason: string }>
    assert.equal(opsSummary.counts.total, jobs.length)
    assert.equal(opsSummary.counts.skipped, jobs.length)
    assert.equal(opsSummary.stages.some((stage) => stage.stage === "serial_account_reconcile" && stage.skipped > 0), true)
    assert.equal(opsSummary.messages.inbox, jobs.length)
    assert.equal(opsSummary.messages.outbox, jobs.length)
    assert.equal(opsSummary.attention.needs_human, false)
    assert.equal(opsSummary.attention.severity, "none")
    assert.equal(processors.some((processor) => processor.processor_id === "runtime_health_guard" && processor.status === "skipped" && /dry-run/.test(processor.reason)), true)
    assert.equal(processors.some((processor) => processor.processor_id === "ops_notify_dispatch" && processor.status === "skipped"), true)
    const reconcileResult = jobs.find((job) => job.job_id === "account_reconcile_guard")?.runtime_result
    assert.equal(reconcileResult?.schema_id, "trade.domain-runtime.domain-job-result.v1")
    assert.equal(reconcileResult?.domain, "live-execution-control")
    assert.equal(reconcileResult?.status, "skipped")
    assert.deepEqual(
      ((reconcileResult?.audit as { domain_hooks?: Array<{ hook: string }> })?.domain_hooks ?? []).map((hook) => hook.hook),
      ["pre_accept", "outbox"],
    )

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
      assert.equal(summary.jobs.some((job) => job.job_id === "runtime_health_guard"), false)
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
  const dir = makeCheckDir("job-graph-runner-exec-")
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
      if (command.cwd === "modules/orchestration-ops/runtime-health-guard") {
        return {
          exit_code: 0,
          stdout: JSON.stringify({
            ok: true,
            processor_id: "runtime_health_guard",
            lifecycle_phase: "pre_cycle",
            status: "ok",
            health_ref: "ops_runtime_store:runtime_health/health-exec",
            health: { checks_json: { checks: [{ name: "runtime:default", status: "ok" }] } },
          }),
          stderr: "",
        }
      }
      return { exit_code: 0, stdout: "{\"ok\":true}", stderr: "" }
    })

    assert.equal(result.ok, true)
    assert.deepEqual(executed.map((command) => command.split(":")[0]), [
      "modules/orchestration-ops/runtime-health-guard",
      "modules/orchestration-ops/control-effectiveness-review",
      "modules/orchestration-ops/ops-notify-dispatch",
    ])
    const processors = result.lifecycle_processors as Array<{ processor_id: string; status: string; exit_code?: number }>
    assert.equal(processors.find((processor) => processor.processor_id === "runtime_health_guard")?.status, "completed")
    assert.equal(processors.find((processor) => processor.processor_id === "control_effectiveness_review")?.exit_code, 0)
    assert.equal(processors.find((processor) => processor.processor_id === "ops_notify_dispatch")?.exit_code, 0)
  } finally {
    tradeDb.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("job graph runner blocks only jobs whose declared resident L2 consumer dependency failed", async () => {
  const dir = makeCheckDir("job-graph-runner-l2-health-")
  const tradeDbPath = join(dir, "trade.db")
  const opsDbPath = join(dir, "ops_runtime.db")
  const tradeDb = new Database(tradeDbPath)
  try {
    ensureSchema(tradeDb)
    appendPlanEvent(tradeDb, {
      event_key: "obs-l2-health-block",
      chain_id: "flow-l2-health-block",
      kind: "observe",
      created_at: "2026-07-22T11:45:00Z",
      body_json: { source: "slow_track", symbol: "BTCUSDT", side: "long" },
    })
    const executed: string[] = []
    const result = await runAutomationJobGraph(tradeDb, tradeDbPath, {
      cycle_id: "cycle-l2-health-block",
      now: "2026-07-22T12:00:00Z",
      ops_runtime_db: opsDbPath,
      execute_jobs: true,
      include_account_reconcile: true,
      include_fast_track: true,
      include_slow_track: false,
      include_rd_strategy_supervisor: false,
      include_rd_trackers: false,
      include_catalog_hygiene: false,
      include_closed_flow_review: false,
      include_control_effectiveness_review: false,
      include_ops_notify: false,
      job_health_requirements: {
        fast_track_guard: ["l2_service:owner_health", "l2_watch_consumer:owner_health"],
      },
    }, async (command): Promise<CommandExecutionResult> => {
      executed.push(command.cwd)
      if (command.cwd === "modules/orchestration-ops/runtime-health-guard") {
        return {
          exit_code: 0,
          stdout: JSON.stringify({
            ok: false,
            processor_id: "runtime_health_guard",
            lifecycle_phase: "pre_cycle",
            status: "blocked",
            health_ref: "ops_runtime_store:runtime_health/health-l2-failed",
            health: {
              checks_json: {
                checks: [
                  { name: "l2_service:owner_health", status: "ok" },
                  { name: "l2_watch_consumer:owner_health", status: "fail" },
                ],
              },
            },
          }),
          stderr: "",
        }
      }
      if (command.argv.includes("--cron-recover-from-tools")) {
        return { exit_code: 0, stdout: JSON.stringify({ ok: true, data: { status: "recovered_noop" } }), stderr: "" }
      }
      throw new Error(`unexpected command: ${command.cwd}`)
    })

    const processors = result.lifecycle_processors as Array<{ processor_id: string; status: string; business_status?: string; health_checks?: Record<string, string> }>
    const health = processors.find((processor) => processor.processor_id === "runtime_health_guard")
    assert.equal(health?.status, "blocked")
    assert.equal(health?.business_status, "blocked")
    assert.equal(health?.health_checks?.["l2_service:owner_health"], "ok")
    assert.equal(health?.health_checks?.["l2_watch_consumer:owner_health"], "fail")
    const jobs = result.jobs as Array<{ job_id: string; status: string; reason: string }>
    assert.equal(jobs.find((job) => job.job_id === "account_reconcile_guard")?.status, "completed")
    assert.equal(jobs.find((job) => job.job_id === "fast_track_guard")?.status, "blocked")
    assert.match(jobs.find((job) => job.job_id === "fast_track_guard")?.reason ?? "", /health dependency l2_watch_consumer:owner_health is fail/)
    assert.deepEqual(executed, [
      "modules/orchestration-ops/runtime-health-guard",
      "modules/orchestration-ops/trade-flow",
    ])
  } finally {
    tradeDb.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("job graph runner accepts native J02 domain runtime result from fast-track guard", async () => {
  const dir = makeCheckDir("job-graph-runner-j02-")
  const tradeDbPath = join(dir, "trade.db")
  const opsDbPath = join(dir, "ops_runtime.db")
  const tradeDb = new Database(tradeDbPath)
  try {
    ensureSchema(tradeDb)
    appendPlanEvent(tradeDb, {
      event_key: "obs-j02",
      chain_id: "flow-j02",
      kind: "observe",
      created_at: "2026-07-11T00:00:00Z",
      body_json: { source: "slow_track", symbol: "BTCUSDT", side: "long" },
    })
    const result = await runAutomationJobGraph(tradeDb, tradeDbPath, {
      cycle_id: "cycle-job-graph-j02",
      now: "2026-07-11T00:15:00Z",
      ops_runtime_db: opsDbPath,
      execute_jobs: true,
      include_runtime_health: false,
      include_account_reconcile: true,
      include_fast_track: true,
      include_slow_track: false,
      include_rd_strategy_supervisor: false,
      include_rd_trackers: false,
      include_catalog_hygiene: false,
      include_closed_flow_review: false,
      include_control_effectiveness_review: false,
      include_ops_notify: false,
    }, async (command): Promise<CommandExecutionResult> => ({
      exit_code: 0,
      stdout: command.argv.includes("--cron-recover-from-tools")
        ? JSON.stringify({ ok: true, data: { status: "recovered_noop" } })
        : JSON.stringify({
          ok: true,
          data: {
            runtime_result: {
              schema_id: "trade.domain-runtime.domain-job-result.v1",
              ok: true,
              status: "ok",
              domain: "live-execution-control",
              job_id: "fast_track_guard",
              idempotency_key: "cycle-job-graph-j02:J02",
              input_refs: ["trade_event_store:chain/flow-j02"],
              output_refs: ["tmp/artifacts/trade-flow/fast-track-cycle-job-graph-j02-J02.json"],
              writes: { trade_event_store: true },
              incidents: [],
              audit: { cycle_id: "cycle-job-graph-j02", ticket_no: "J02" },
            },
          },
        }),
      stderr: "",
    }))

    const jobs = result.jobs as Array<{ job_id: string; status: string; result_ref: string; runtime_result: { writes: Record<string, boolean>; audit: { domain_hooks: Array<{ hook: string }> } } }>
    const fast = jobs.find((job) => job.job_id === "fast_track_guard")
    assert.equal(fast?.status, "completed")
    assert.equal(fast?.result_ref, "tmp/artifacts/trade-flow/fast-track-cycle-job-graph-j02-J02.json")
    assert.deepEqual(fast?.runtime_result.writes, { trade_event_store: true })
    assert.deepEqual(fast?.runtime_result.audit.domain_hooks.map((hook) => hook.hook), [
      "pre_accept",
      "pre_handle",
      "handler",
      "post_handle",
      "post_commit",
      "outbox",
    ])
  } finally {
    tradeDb.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("job graph runner accepts native J06 domain runtime result from artifact-knowledge", async () => {
  const dir = makeCheckDir("job-graph-runner-j06-")
  const tradeDbPath = join(dir, "trade.db")
  const opsDbPath = join(dir, "ops_runtime.db")
  const tradeDb = new Database(tradeDbPath)
  try {
    ensureSchema(tradeDb)
    const result = await runAutomationJobGraph(tradeDb, tradeDbPath, {
      cycle_id: "cycle-job-graph-j06",
      now: "2026-07-11T00:15:00Z",
      ops_runtime_db: opsDbPath,
      execute_jobs: true,
      include_runtime_health: false,
      include_account_reconcile: false,
      include_fast_track: false,
      include_slow_track: false,
      include_rd_strategy_supervisor: false,
      include_rd_trackers: false,
      include_closed_flow_review: false,
      include_control_effectiveness_review: false,
      include_ops_notify: false,
      include_catalog_hygiene: true,
    }, async (): Promise<CommandExecutionResult> => ({
      exit_code: 0,
      stdout: JSON.stringify({
        ok: true,
        data: {
          runtime_result: {
            schema_id: "trade.domain-runtime.domain-job-result.v1",
            ok: true,
            status: "ok",
            domain: "artifact-knowledge",
            job_id: "catalog_hygiene_scan",
            idempotency_key: "cycle-job-graph-j06:J06",
            input_refs: ["artifact-root:tmp"],
            output_refs: ["artifact_catalog:scan/cycle-job-graph-j06"],
            writes: { artifact_catalog: true },
            incidents: [],
            audit: { cycle_id: "cycle-job-graph-j06", ticket_no: "J06" },
          },
        },
      }),
      stderr: "",
    }))

    const jobs = result.jobs as Array<{ job_id: string; status: string; result_ref: string; runtime_result: { writes: Record<string, boolean> } }>
    const catalog = jobs.find((job) => job.job_id === "catalog_hygiene_scan")
    assert.equal(catalog?.status, "completed")
    assert.equal(catalog?.result_ref, "artifact_catalog:scan/cycle-job-graph-j06")
    assert.deepEqual(catalog?.runtime_result.writes, { artifact_catalog: true })
  } finally {
    tradeDb.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("job graph runner accepts native J04 domain runtime result from research supervisor", async () => {
  const dir = makeCheckDir("job-graph-runner-j04-")
  const tradeDbPath = join(dir, "trade.db")
  const opsDbPath = join(dir, "ops_runtime.db")
  const tradeDb = new Database(tradeDbPath)
  try {
    ensureSchema(tradeDb)
    const result = await runAutomationJobGraph(tradeDb, tradeDbPath, {
      cycle_id: "cycle-job-graph-j04",
      now: "2026-07-11T00:15:00Z",
      ops_runtime_db: opsDbPath,
      execute_jobs: true,
      include_runtime_health: false,
      include_account_reconcile: false,
      include_fast_track: false,
      include_slow_track: false,
      include_rd_strategy_supervisor: true,
      include_rd_trackers: false,
      include_catalog_hygiene: false,
      include_closed_flow_review: false,
      include_control_effectiveness_review: false,
      include_ops_notify: false,
      rd_strategy_goal: { objective: "find a shadow-eligible 4H swing strategy" },
    }, async (): Promise<CommandExecutionResult> => ({
      exit_code: 0,
      stdout: JSON.stringify({
        ok: true,
        data: {
          runtime_result: {
            schema_id: "trade.domain-runtime.domain-job-result.v1",
            ok: true,
            status: "ok",
            domain: "research-strategy-development",
            job_id: "rd_strategy_supervisor",
            idempotency_key: "cycle-job-graph-j04:J04",
            input_refs: ["research_state_store:rd_program/rd-program"],
            output_refs: ["research_state_store:rd_program/rd-program"],
            writes: { research_state_store: true, artifact_catalog: true },
            incidents: [],
            audit: { cycle_id: "cycle-job-graph-j04", ticket_no: "J04" },
          },
        },
      }),
      stderr: "",
    }))

    const jobs = result.jobs as Array<{ job_id: string; status: string; result_ref: string; runtime_result: { writes: Record<string, boolean> } }>
    const rd = jobs.find((job) => job.job_id === "rd_strategy_supervisor")
    assert.equal(rd?.status, "completed")
    assert.equal(rd?.result_ref, "research_state_store:rd_program/rd-program")
    assert.deepEqual(rd?.runtime_result.writes, { research_state_store: true, artifact_catalog: true })
  } finally {
    tradeDb.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("job graph runner accepts native J05 domain runtime result from research", async () => {
  const dir = makeCheckDir("job-graph-runner-j05-")
  const tradeDbPath = join(dir, "trade.db")
  const opsDbPath = join(dir, "ops_runtime.db")
  const tradeDb = new Database(tradeDbPath)
  try {
    ensureSchema(tradeDb)
    const result = await runAutomationJobGraph(tradeDb, tradeDbPath, {
      cycle_id: "cycle-job-graph-j05",
      now: "2026-07-11T00:15:00Z",
      ops_runtime_db: opsDbPath,
      execute_jobs: true,
      include_runtime_health: false,
      include_account_reconcile: false,
      include_fast_track: false,
      include_slow_track: false,
      include_rd_strategy_supervisor: false,
      include_rd_trackers: true,
      include_catalog_hygiene: false,
      include_closed_flow_review: false,
      include_control_effectiveness_review: false,
      include_ops_notify: false,
      rd_trackers: [{ tracker_id: "alt-shadow", forward_result_path: "tmp/forward.json" }],
    }, async (): Promise<CommandExecutionResult> => ({
      exit_code: 0,
      stdout: JSON.stringify({
        ok: true,
        data: {
          runtime_result: {
            schema_id: "trade.domain-runtime.domain-job-result.v1",
            ok: true,
            status: "ok",
            domain: "research-strategy-development",
            job_id: "rd_forward_shadow_trackers",
            idempotency_key: "cycle-job-graph-j05:J05",
            input_refs: ["artifact:tmp/forward.json"],
            output_refs: ["tmp/artifacts/strategy-rnd/alt-shadow.shadow-tracker.json"],
            writes: { artifact_catalog: true },
            incidents: [],
            audit: { cycle_id: "cycle-job-graph-j05", ticket_no: "J05" },
          },
        },
      }),
      stderr: "",
    }))

    const jobs = result.jobs as Array<{ job_id: string; status: string; result_ref: string; runtime_result: { writes: Record<string, boolean> } }>
    const shadow = jobs.find((job) => job.job_id === "rd_forward_shadow_trackers")
    assert.equal(shadow?.status, "completed")
    assert.equal(shadow?.result_ref, "tmp/artifacts/strategy-rnd/alt-shadow.shadow-tracker.json")
    assert.deepEqual(shadow?.runtime_result.writes, { artifact_catalog: true })
  } finally {
    tradeDb.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("job graph runner accepts native J07 domain runtime result from governance", async () => {
  const dir = makeCheckDir("job-graph-runner-j07-")
  const tradeDbPath = join(dir, "trade.db")
  const opsDbPath = join(dir, "ops_runtime.db")
  const tradeDb = new Database(tradeDbPath)
  try {
    ensureSchema(tradeDb)
    appendPlanEvent(tradeDb, {
      event_key: "obs-j07",
      chain_id: "flow-j07",
      kind: "observe",
      created_at: "2026-07-10T00:00:00Z",
      body_json: { source: "slow_track", symbol: "BTCUSDT", side: "long" },
    })
    const result = await runAutomationJobGraph(tradeDb, tradeDbPath, {
      cycle_id: "cycle-job-graph-j07",
      now: "2026-07-11T00:15:00Z",
      ops_runtime_db: opsDbPath,
      execute_jobs: true,
      include_runtime_health: false,
      include_account_reconcile: false,
      include_fast_track: false,
      include_slow_track: false,
      include_rd_strategy_supervisor: false,
      include_rd_trackers: false,
      include_catalog_hygiene: false,
      include_control_effectiveness_review: false,
      include_ops_notify: false,
      include_closed_flow_review: true,
      force_jobs: ["closed_flow_review_sweep"],
    }, async (): Promise<CommandExecutionResult> => ({
      exit_code: 0,
      stdout: JSON.stringify({
        ok: true,
        runtime_result: {
          schema_id: "trade.domain-runtime.domain-job-result.v1",
          ok: true,
          status: "ok",
          domain: "governance-review-compliance",
          job_id: "closed_flow_review_sweep",
          idempotency_key: "cycle-job-graph-j07:J07",
          input_refs: ["trade_event_store:chain/flow-j07"],
          output_refs: ["governance_ledger:review_batch/batch-j07"],
          writes: { governance_ledger: true },
          incidents: [],
          audit: { cycle_id: "cycle-job-graph-j07", ticket_no: "J07" },
        },
      }),
      stderr: "",
    }))

    const jobs = result.jobs as Array<{ job_id: string; status: string; result_ref: string; runtime_result: { writes: Record<string, boolean> } }>
    const review = jobs.find((job) => job.job_id === "closed_flow_review_sweep")
    assert.equal(review?.status, "completed")
    assert.equal(review?.result_ref, "governance_ledger:review_batch/batch-j07")
    assert.deepEqual(review?.runtime_result.writes, { governance_ledger: true })
  } finally {
    tradeDb.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("job graph runner records incidents for failed domain jobs", async () => {
  const dir = makeCheckDir("job-graph-runner-fail-")
  const tradeDbPath = join(dir, "trade.db")
  const opsDbPath = join(dir, "ops_runtime.db")
  const tradeDb = new Database(tradeDbPath)
  try {
    ensureSchema(tradeDb)
    appendPlanEvent(tradeDb, {
      event_key: "obs-job-graph-fail-1",
      chain_id: "flow-job-graph-fail-1",
      kind: "observe",
      created_at: "2026-07-11T00:00:00Z",
      body_json: {
        source: "slow_track",
        symbol: "BTCUSDT",
        side: "long",
      },
    })
    const result = await runAutomationJobGraph(tradeDb, tradeDbPath, {
      cycle_id: "cycle-job-graph-fail",
      now: "2026-07-11T00:15:00Z",
      ops_runtime_db: opsDbPath,
      execute_jobs: true,
      include_runtime_health: false,
      include_fast_track: false,
      include_slow_track: false,
      include_rd_strategy_supervisor: false,
      include_rd_trackers: false,
      include_closed_flow_review: false,
      include_catalog_hygiene: false,
      include_ops_notify: false,
    }, async (): Promise<CommandExecutionResult> => {
      return { exit_code: 7, stdout: "", stderr: "synthetic failure" }
    })

    assert.equal(result.ok, false)
    const opsDb = new Database(opsDbPath)
    try {
      const incidents = readIncidents(opsDb, { cycle_id: "cycle-job-graph-fail" })
      assert.equal(incidents.some((incident) => incident.source === "job_run" && incident.severity === "critical"), true)
      const summary = readCycleSummary(opsDb, "cycle-job-graph-fail") as {
        ops_summary: { incidents: { open: number }; attention: { needs_human: boolean; reasons: string[] } }
      }
      assert.equal(summary.ops_summary.incidents.open > 0, true)
      assert.equal(summary.ops_summary.attention.needs_human, true)
      assert.equal(summary.ops_summary.attention.reasons.some((reason) => reason.startsWith("incident:")), true)
    } finally {
      opsDb.close()
    }
  } finally {
    tradeDb.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("job graph runner blocks fast guard when reconciliation remains unresolved", async () => {
  const dir = makeCheckDir("job-graph-runner-reconcile-barrier-")
  const tradeDbPath = join(dir, "trade.db")
  const opsDbPath = join(dir, "ops_runtime.db")
  const tradeDb = new Database(tradeDbPath)
  try {
    ensureSchema(tradeDb)
    appendPlanEvent(tradeDb, {
      event_key: "obs-reconcile-barrier",
      chain_id: "flow-reconcile-barrier",
      kind: "observe",
      created_at: "2026-07-11T00:00:00Z",
      body_json: { source: "slow_track", symbol: "BTCUSDT", side: "long" },
    })
    const executed: string[] = []
    const result = await runAutomationJobGraph(tradeDb, tradeDbPath, {
      cycle_id: "cycle-reconcile-barrier",
      now: "2026-07-11T00:15:00Z",
      ops_runtime_db: opsDbPath,
      execute_jobs: true,
      include_runtime_health: false,
      include_account_reconcile: true,
      include_fast_track: true,
      include_slow_track: false,
      include_rd_strategy_supervisor: false,
      include_rd_trackers: false,
      include_closed_flow_review: false,
      include_catalog_hygiene: false,
      include_control_effectiveness_review: false,
      include_ops_notify: false,
    }, async (command): Promise<CommandExecutionResult> => {
      executed.push(command.argv.join(" "))
      return {
        exit_code: 0,
        stdout: JSON.stringify({ ok: true, data: { status: "reconcile_draft_ready" } }),
        stderr: "",
      }
    })

    const jobs = result.jobs as Array<{ job_id: string; status: string; reason: string }>
    const reconcile = jobs.find((job) => job.job_id === "account_reconcile_guard")
    const fast = jobs.find((job) => job.job_id === "fast_track_guard")
    assert.equal(result.ok, false)
    assert.equal(reconcile?.status, "blocked")
    assert.match(reconcile?.reason || "", /reconcile_draft_ready/)
    assert.equal(fast?.status, "blocked")
    assert.match(fast?.reason || "", /dependency account_reconcile_guard/)
    assert.equal(executed.length, 1)
    assert.match(executed[0], /cron-recover-from-tools/)
  } finally {
    tradeDb.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("job graph runner bounds a stalled lifecycle command", async () => {
  const dir = makeCheckDir("job-graph-runner-timeout-")
  const tradeDbPath = join(dir, "trade.db")
  const opsDbPath = join(dir, "ops_runtime.db")
  const tradeDb = new Database(tradeDbPath)
  try {
    ensureSchema(tradeDb)
    const result = await runAutomationJobGraph(tradeDb, tradeDbPath, {
      cycle_id: "cycle-job-graph-timeout",
      now: "2026-07-23T03:00:00Z",
      ops_runtime_db: opsDbPath,
      execute_jobs: true,
      command_timeout_ms: 100,
      include_fast_track: false,
      include_slow_track: false,
      include_rd_strategy_supervisor: false,
      include_rd_trackers: false,
      include_closed_flow_review: false,
      include_catalog_hygiene: false,
      include_control_effectiveness_review: false,
      include_ops_notify: false,
    }, async () => new Promise<CommandExecutionResult>(() => {}))

    assert.equal(result.ok, false)
    const processors = result.lifecycle_processors as Array<{
      processor_id: string
      status: string
      reason: string
      exit_code?: number
      timed_out?: boolean
    }>
    const health = processors.find((processor) => processor.processor_id === "runtime_health_guard")
    assert.equal(health?.status, "failed")
    assert.equal(health?.reason, "command timed out")
    assert.equal(health?.exit_code, 124)
    assert.equal(health?.timed_out, true)
    const opsDb = new Database(opsDbPath)
    try {
      const incidents = readIncidents(opsDb, { cycle_id: "cycle-job-graph-timeout" })
      assert.equal(incidents.some((incident) => incident.source === "lifecycle_processor"), true)
    } finally {
      opsDb.close()
    }
  } finally {
    tradeDb.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

function makeCheckDir(prefix: string): string {
  const checkRoot = join(process.cwd(), "../../..", "tmp/check")
  mkdirSync(checkRoot, { recursive: true })
  return mkdtempSync(join(checkRoot, prefix))
}
