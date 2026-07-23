import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"
import { Database } from "bun:sqlite"
import { buildAutomationCyclePlan } from "./automation-cycle"
import { appendPlanEvent, ensureSchema } from "../../../../../portfolio-execution-state/event-store/src/lib/event-store"

type JSONRecord = Record<string, unknown>

test("automation cycle plan isolates trade db work from R&D artifact jobs", () => {
  const dir = makeCheckDir("automation-cycle-")
  const dbPath = join(dir, "trade.db")
  const db = new Database(dbPath)
  try {
    ensureSchema(db)
    appendPlanEvent(db, {
      event_key: "obs-cycle-1",
      chain_id: "flow-cycle-1",
      kind: "observe",
      created_at: "2026-07-09T12:00:00Z",
      body_json: {
        source: "slow_track",
        symbol: "BTCUSDT",
        side: "long",
        strategy_ref: "S-BTC",
      },
    })
    db.close()

    const result = buildAutomationCyclePlan(db, dbPath, {
      cycle_id: "cycle-test-1",
      now: "2026-07-09T12:15:00Z",
      rd_trackers: [{ tracker_id: "high-beta-alt-be-fresh", artifact_scope: "data/artifacts/strategy-rnd" }],
      catalog_roots: ["./data", "./tmp"],
    })

    assert.equal(result.schema_version, "trade-flow.automation-cycle-plan.v1")
    assert.equal(result.cycle_id, "cycle-test-1")
    assert.equal(result.executable, false)
    assert.equal(result.active_flow_count, 1)
    const jobs = asArray(result.jobs).map(asRecord)
    const processors = asArray(result.lifecycle_processors).map(asRecord)
    const health = asRecord(processors.find((processor) => processor.processor_id === "runtime_health_guard"))
    assert.equal(health.active, true)
    assert.equal(health.subagent_role, "ops-runtime-operator")
    assert.equal(asRecord(health.processor_spec).tool_id, "ops.runtime-health-guard")
    assert.equal(asRecord(asRecord(health.processor_spec).command_spec).cwd, "modules/orchestration-ops/runtime-health-guard")
    const reconcileToolJob = asRecord(asRecord(jobs.find((job) => job.job_id === "account_reconcile_guard")).tool_job)
    assert.equal(reconcileToolJob.tool_id, "trade-flow.recovery")
    assert.equal(reconcileToolJob.ticket_no, "J01")
    assert.equal(reconcileToolJob.target_domain, "live-execution-control")
    assert.equal(jobs.find((job) => job.job_id === "fast_track_guard")?.active, true)
    const fast = asRecord(jobs.find((job) => job.job_id === "fast_track_guard"))
    const fastToolJob = asRecord(fast.tool_job)
    assert.equal(fastToolJob.tool_id, "execution.fast-track-guard")
    assert.equal(fastToolJob.ticket_no, "J02")
    assert.equal(fastToolJob.target_domain, "live-execution-control")
    assert.equal(asRecord(fastToolJob.writes).trade_db, true)
    assert.deepEqual(fast.allowed_runtime_writes, ["trade_event_store"])
    assert.equal(asRecord(fastToolJob.command_spec).cwd, "modules/live-execution-control/fast-track-guard")
    assert.deepEqual(asArray(asRecord(fastToolJob.command_spec).argv).slice(0, 5), ["bun", "src/scripts/main.ts", "--fast-guard-job", "--db", String(result.trade_db_path)])
    const slow = asRecord(jobs.find((job) => job.job_id === "slow_track_market_watch"))
    const slowToolJob = asRecord(slow.tool_job)
    assert.equal(slowToolJob.tool_id, "decision.slow-track-plan")
    assert.equal(slowToolJob.ticket_no, "J03")
    assert.equal(slowToolJob.target_domain, "live-decision-planning")
    assert.equal(slow.may_write_trade_db, false)
    assert.deepEqual(slow.allowed_runtime_writes, [])
    assert.equal(asRecord(slowToolJob.command_spec).cwd, "modules/live-decision-planning/slow-track-plan")
    const shadow = asRecord(jobs.find((job) => job.job_id === "rd_forward_shadow_trackers"))
    assert.equal(shadow.may_write_trade_db, false)
    assert.match(String(shadow.command), /--shadow-tracker-job/)
    assert.deepEqual(shadow.allowed_runtime_writes, ["artifact_catalog"])
    const shadowToolJob = asRecord(shadow.tool_job)
    assert.equal(shadowToolJob.tool_id, "research.rd-shadow-tracker")
    assert.equal(shadowToolJob.ticket_no, "J05")
    assert.equal(shadowToolJob.target_domain, "research-strategy-development")
    assert.equal(asRecord(shadow.command_spec).cwd, "modules/research-strategy-development/forward-evidence-plane/paper-tracker")
    assert.deepEqual(asArray(asRecord(shadow.command_spec).argv).slice(0, 4), ["bun", "src/scripts/main.ts", "--shadow-tracker-job", "--catalog-db"])
    const review = asRecord(jobs.find((job) => job.job_id === "closed_flow_review_sweep"))
    assert.equal(review.trigger_mode, "event_or_fallback_sweep")
    assert.equal(asRecord(review.tool_job).tool_id, "governance.closed-flow-review-sweep")
    assert.equal(asRecord(review.tool_job).ticket_no, "J07")
    assert.equal(asRecord(review.command_spec).cwd, "modules/governance-review-compliance/closed-flow-review-sweep")
    assert.deepEqual(review.allowed_runtime_writes, ["governance_ledger"])
    assert.equal(review.may_write_trade_db, false)
    assert.deepEqual(review.candidate_chain_ids, ["flow-cycle-1"])
    assert.match(String(jobs.find((job) => job.job_id === "catalog_hygiene_scan")?.command), /--catalog-hygiene-job/)
    const catalogToolJob = asRecord(asRecord(jobs.find((job) => job.job_id === "catalog_hygiene_scan")).tool_job)
    assert.equal(catalogToolJob.tool_id, "artifact-catalog")
    assert.equal(catalogToolJob.ticket_no, "J06")
    assert.equal(catalogToolJob.target_domain, "artifact-knowledge")
    assert.equal(asRecord(catalogToolJob.writes).catalog, true)
    assert.deepEqual(asArray(asRecord(catalogToolJob.command_spec).argv).slice(0, 4), ["bun", "src/scripts/main.ts", "--catalog-hygiene-job", "--catalog-db"])
    assert.deepEqual(asArray(asRecord(catalogToolJob.payload).catalog_roots), ["./data", "./tmp"])
    assert.deepEqual(jobs.find((job) => job.job_id === "catalog_hygiene_scan")?.allowed_runtime_writes, ["artifact_catalog"])
    const notify = asRecord(processors.find((processor) => processor.processor_id === "ops_notify_dispatch"))
    assert.equal(notify.active, true)
    assert.equal(asRecord(notify.processor_spec).tool_id, "ops.notify-dispatch")
    const controlReview = asRecord(processors.find((processor) => processor.processor_id === "control_effectiveness_review"))
    assert.equal(controlReview.active, true)
    assert.equal(asRecord(controlReview.processor_spec).tool_id, "ops.control-effectiveness-review")
    assert.deepEqual(asArray(result.dispatch_order).map((stage) => asRecord(stage).stage), [
      "pre_cycle",
      "serial_account_reconcile",
      "serial_fast_guard",
      "parallel_isolated_work",
      "serial_review_closeout",
      "post_cycle_review",
      "post_cycle_notify",
    ])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("automation cycle plan can disable optional jobs", () => {
  const dir = makeCheckDir("automation-cycle-disable-")
  const dbPath = join(dir, "trade.db")
  const db = new Database(dbPath)
  try {
    ensureSchema(db)
    db.close()
    const result = buildAutomationCyclePlan(db, dbPath, {
      now: "2026-07-09T12:15:00Z",
      include_rd_strategy_supervisor: false,
      include_rd_trackers: false,
      include_catalog_hygiene: false,
    })

    const jobs = asArray(result.jobs).map(asRecord)
    const processors = asArray(result.lifecycle_processors).map(asRecord)
    assert.equal(jobs.find((job) => job.job_id === "fast_track_guard")?.active, false)
    assert.equal(processors.find((processor) => processor.processor_id === "runtime_health_guard")?.enabled, true)
    assert.equal(processors.find((processor) => processor.processor_id === "control_effectiveness_review")?.enabled, true)
    assert.equal(processors.find((processor) => processor.processor_id === "ops_notify_dispatch")?.enabled, true)
    assert.equal(jobs.find((job) => job.job_id === "rd_strategy_supervisor")?.enabled, false)
    assert.equal(jobs.find((job) => job.job_id === "rd_forward_shadow_trackers")?.enabled, false)
    assert.equal(jobs.find((job) => job.job_id === "catalog_hygiene_scan")?.enabled, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("automation cycle plan can explicitly require L2 owner readiness in pre-cycle health", () => {
  const dir = makeCheckDir("automation-cycle-l2-health-")
  const dbPath = join(dir, "trade.db")
  const db = new Database(dbPath)
  try {
    ensureSchema(db)
    db.close()
    const result = buildAutomationCyclePlan(db, dbPath, {
      cycle_id: "cycle-l2-health",
      now: "2026-07-22T12:00:00Z",
      runtime_health: { require_l2_ready: true },
    })

    const processors = asArray(result.lifecycle_processors).map(asRecord)
    const health = asRecord(processors.find((processor) => processor.processor_id === "runtime_health_guard"))
    const spec = asRecord(health.processor_spec)
    const payload = asRecord(spec.payload)
    const healthInput = asRecord(payload.json)
    assert.equal(healthInput.require_l2_ready, true)
    assert.equal(spec.tool_id, "ops.runtime-health-guard")
    assert.equal(health.active, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("automation cycle plan derives L2 owner and resident-consumer checks from explicit job dependencies", () => {
  const dir = makeCheckDir("automation-cycle-l2-dependency-")
  const dbPath = join(dir, "trade.db")
  const db = new Database(dbPath)
  try {
    ensureSchema(db)
    db.close()
    const result = buildAutomationCyclePlan(db, dbPath, {
      cycle_id: "cycle-l2-dependency",
      now: "2026-07-22T12:00:00Z",
      job_health_requirements: {
        slow_track_market_watch: ["l2_service:owner_health", "l2_watch_consumer:owner_health"],
      },
    })

    const processors = asArray(result.lifecycle_processors).map(asRecord)
    const health = asRecord(processors.find((processor) => processor.processor_id === "runtime_health_guard"))
    const healthSpec = asRecord(health.processor_spec)
    const healthInput = asRecord(asRecord(healthSpec.payload).json)
    assert.equal(healthInput.require_l2_ready, true)
    assert.equal(healthInput.require_l2_watch_consumer_ready, true)
    assert.equal(asArray(asRecord(healthSpec.command_spec).argv)[3], "../../../data/ops_runtime.db")
    const jobs = asArray(result.jobs).map(asRecord)
    assert.deepEqual(jobs.find((job) => job.job_id === "slow_track_market_watch")?.required_health_checks, [
      "l2_service:owner_health",
      "l2_watch_consumer:owner_health",
    ])
    assert.equal(Object.hasOwn(jobs.find((job) => job.job_id === "account_reconcile_guard") ?? {}, "required_health_checks"), false)

    assert.throws(() => buildAutomationCyclePlan(db, dbPath, {
      job_health_requirements: { account_reconcile_guard: ["l2_service:owner_health"] },
    }), /defense job cannot require runtime health/)
    assert.throws(() => buildAutomationCyclePlan(db, dbPath, {
      job_health_requirements: { slow_track_market_watch: ["unknown:health"] },
    }), /unsupported health dependency/)
    assert.throws(() => buildAutomationCyclePlan(db, dbPath, {
      runtime_health: { require_l2_watch_consumer_ready: false },
      job_health_requirements: { slow_track_market_watch: ["l2_watch_consumer:owner_health"] },
    }), /L2-watch-dependent jobs require runtime_health.require_l2_watch_consumer_ready=true/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("automation cycle plan can dispatch a learning strategy R&D supervisor", () => {
  const dir = makeCheckDir("automation-cycle-rd-")
  const dbPath = join(dir, "trade.db")
  const db = new Database(dbPath)
  try {
    ensureSchema(db)
    db.close()
    const result = buildAutomationCyclePlan(db, dbPath, {
      cycle_id: "cycle-rd-supervisor",
      now: "2026-07-09T12:15:00Z",
      rd_learning_memory_ref: "docs/research/reliability/rd-audit.md",
      rd_strategy_goal: {
        objective: "find a shadow-eligible 4H swing strategy",
        budget: {
          max_hypotheses: 3,
          max_trials_total: 18,
          max_locked_holdout_uses: 0,
        },
      },
    })

    const jobs = asArray(result.jobs).map(asRecord)
    const rd = asRecord(jobs.find((job) => job.job_id === "rd_strategy_supervisor"))
    assert.equal(rd.active, true)
    assert.equal(rd.subagent_role, "rd-autonomy-cycle")
    assert.equal(rd.may_write_trade_db, false)
    assert.equal(rd.may_call_binance_write, false)
    const contract = asRecord(rd.research_loop_contract)
    assert.deepEqual(contract.loop_until, ["strategy_draft_created", "budget_exhausted", "data_or_tool_blocked"])
    assert.equal(asRecord(contract.budget).max_hypotheses, 3)
    assert.equal(asRecord(contract.budget).max_locked_holdout_uses, 0)
    assert.deepEqual(asRecord(contract.learning_memory).write_back, [
      "failure_summary",
      "reliability_gate",
      "rejected_mechanisms",
      "universe_lessons",
      "next_hypothesis_queue",
    ])
    assert.equal(asRecord(contract.budget).max_trials_total, 18)
    const sidecars = asArray(contract.sidecar_subagents).map(asRecord)
    assert.deepEqual(sidecars.map((sidecar) => sidecar.role), ["rd-history-scout", "rd-data-scout", "rd-edge-scout"])
    assert.equal(sidecars.every((sidecar) => sidecar.may_write_state === false), true)
    assert.match(String(contract.single_writer_rule), /CAS a ready queue proposal/)
    assert.match(String(rd.command), /--profile/)
    assert.deepEqual(rd.allowed_runtime_writes, ["research_state_store", "artifact_catalog"])
    const rdToolJob = asRecord(rd.tool_job)
    assert.equal(rdToolJob.tool_id, "research.rd-autonomy-cycle")
    assert.equal(rdToolJob.ticket_no, "J04")
    assert.equal(rdToolJob.target_domain, "research-strategy-development")
    assert.equal(asRecord(rdToolJob.command_spec).cwd, "modules/research-strategy-development/research-control-plane/autonomy-cycle")
    const commandSpec = asRecord(rd.command_spec)
    assert.deepEqual(asArray(commandSpec.argv).slice(0, 5), [
      "bun",
      "src/scripts/main.ts",
      "--db",
      "./data/rd_state.db",
      "--catalog-db"
    ])
    const argv = asArray(commandSpec.argv)
    const jobPayload = JSON.parse(String(argv[argv.length - 1])) as { goal: { budget: { max_hypotheses: number; max_trials_total: number; max_locked_holdout_uses: number } } }
    assert.equal(jobPayload.goal.budget.max_hypotheses, 3)
    assert.equal(jobPayload.goal.budget.max_trials_total, 18)
    assert.equal(jobPayload.goal.budget.max_locked_holdout_uses, 0)
    const parallel = asRecord(asArray(result.dispatch_order).find((stage) => asRecord(stage).stage === "parallel_isolated_work"))
    assert.ok(asArray(parallel.job_ids).includes("rd_strategy_supervisor"))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("automation cycle plan can drive R&D supervisor from durable program state", () => {
  const dir = makeCheckDir("automation-rd-state-")
  const dbPath = join(dir, "trade.db")
  const db = new Database(dbPath)
  try {
    ensureSchema(db)
    db.close()
    const rdStateDb = join(dir, "rd_state.db")
    const rdProgramId = "rd-program-main"
    const rdProgramRef = `research_state_store:rd_program/${rdProgramId}`
    const state = rdProgramStateFixture({
      program_id: rdProgramId,
      objective: "find a shadow-eligible 4H swing strategy",
      updated_at: "2026-07-09T12:00:00Z",
      budget: {
        max_hypotheses: 2,
        max_trials_total: 8,
        max_locked_holdout_uses: 1,
      },
    })
    upsertRdProgramState(rdStateDb, rdProgramId, state)

    const activeResult = buildAutomationCyclePlan(db, dbPath, {
      cycle_id: "cycle-rd-state-active",
      now: "2026-07-09T12:15:00Z",
      rd_state_db: rdStateDb,
      rd_program_id: rdProgramId,
      rd_strategy_goal: {
        objective: "ignored because durable state is the source of truth",
      },
    })

    const activeJobs = asArray(activeResult.jobs).map(asRecord)
    const activeRd = asRecord(activeJobs.find((job) => job.job_id === "rd_strategy_supervisor"))
    assert.equal(activeRd.active, true)
    assert.equal(asRecord(activeRd.goal).objective, "find a shadow-eligible 4H swing strategy")
    assert.equal(activeRd.program_state_status, "active")
    assert.equal(activeRd.program_state_ref, rdProgramRef)
    assert.match(String(activeRd.command), /modules\/research-strategy-development\/research-control-plane\/autonomy-cycle\/src\/scripts\/main.ts/)
    const rdToolJob = asRecord(activeRd.tool_job)
    assert.equal(rdToolJob.tool_id, "research.rd-autonomy-cycle")
    assert.equal(rdToolJob.ticket_no, "J04")
    assert.equal(rdToolJob.target_domain, "research-strategy-development")
    assert.equal(asRecord(rdToolJob.command_spec).cwd, "modules/research-strategy-development/research-control-plane/autonomy-cycle")
    assert.equal(asRecord(rdToolJob.payload).state_ref, String(activeRd.program_state_ref))
    assert.equal(asRecord(rdToolJob.payload).db_path, rdStateDb)
    assert.deepEqual(activeRd.allowed_runtime_writes, ["research_state_store", "artifact_catalog"])
    const commandSpec = asRecord(activeRd.command_spec)
    assert.equal(commandSpec.executable, true)
    assert.deepEqual(asArray(commandSpec.argv).slice(0, 5), [
      "bun",
      "src/scripts/main.ts",
      "--db",
      rdStateDb,
      "--catalog-db",
    ])
    const contract = asRecord(activeRd.research_loop_contract)
    assert.equal(asRecord(contract.budget).max_trials_total, 8)
    assert.equal(asRecord(contract.learning_memory).read_ref, rdProgramRef)
    assert.ok(asArray(contract.allowed_actions).includes("research.rd-program-state action=plan_next"))
    const argv = asArray(commandSpec.argv)
    const supervisorPayload = JSON.parse(String(argv[argv.length - 1])) as { supervisor: { max_iterations: number } }
    assert.equal(supervisorPayload.supervisor.max_iterations, 20)

    upsertRdProgramState(rdStateDb, rdProgramId, {
      ...state,
      status: "budget_exhausted",
      updated_at: "2026-07-09T13:00:00Z",
      usage: {
        ...asRecord(state.usage),
        hypotheses_run: 2,
      },
    })
    const stoppedResult = buildAutomationCyclePlan(db, dbPath, {
      cycle_id: "cycle-rd-state-stopped",
      now: "2026-07-09T13:15:00Z",
      force_jobs: ["rd_strategy_supervisor"],
      rd_state_db: rdStateDb,
      rd_program_id: rdProgramId,
    })

    const stoppedJobs = asArray(stoppedResult.jobs).map(asRecord)
    const stoppedRd = asRecord(stoppedJobs.find((job) => job.job_id === "rd_strategy_supervisor"))
    assert.equal(stoppedRd.active, false)
    assert.equal(stoppedRd.program_state_status, "budget_exhausted")
    assert.match(String(stoppedRd.reason), /budget_exhausted/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("automation cycle plan skips slow jobs on fast cadence until due", () => {
  const dir = makeCheckDir("automation-cycle-cadence-")
  const dbPath = join(dir, "trade.db")
  const db = new Database(dbPath)
  try {
    ensureSchema(db)
    appendPlanEvent(db, {
      event_key: "obs-cycle-cadence-1",
      chain_id: "flow-cycle-cadence-1",
      kind: "observe",
      created_at: "2026-07-09T12:00:00Z",
      body_json: {
        source: "slow_track",
        symbol: "BTCUSDT",
        side: "long",
        strategy_ref: "S-BTC",
      },
    })
    db.close()

    const result = buildAutomationCyclePlan(db, dbPath, {
      now: "2026-07-09T12:15:00Z",
      last_runs: {
        fast: "2026-07-09T11:59:00Z",
        slow: "2026-07-09T11:45:00Z",
      },
    })

    const jobs = asArray(result.jobs).map(asRecord)
    const fast = asRecord(jobs.find((job) => job.job_id === "fast_track_guard"))
    const slow = asRecord(jobs.find((job) => job.job_id === "slow_track_market_watch"))
    assert.equal(fast.active, true)
    assert.equal(asRecord(fast.cadence).reason, "interval_elapsed")
    assert.equal(slow.active, false)
    assert.equal(asRecord(slow.cadence).reason, "cadence_not_due")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

function makeCheckDir(prefix: string): string {
  const checkRoot = join(process.cwd(), "../../..", "tmp/check")
  mkdirSync(checkRoot, { recursive: true })
  return mkdtempSync(join(checkRoot, prefix))
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

function upsertRdProgramState(dbPath: string, programId: string, state: JSONRecord): void {
  const db = new Database(dbPath)
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS rd_program (
        program_id TEXT PRIMARY KEY,
        objective TEXT NOT NULL,
        status TEXT NOT NULL,
        state_json TEXT NOT NULL CHECK(json_valid(state_json)),
        updated_at TEXT NOT NULL
      )
    `)
    db.query(`
      INSERT INTO rd_program(program_id, objective, status, state_json, updated_at)
      VALUES ($program_id, $objective, $status, $state_json, $updated_at)
      ON CONFLICT(program_id) DO UPDATE SET
        objective = excluded.objective,
        status = excluded.status,
        state_json = excluded.state_json,
        updated_at = excluded.updated_at
    `).run({
      $program_id: programId,
      $objective: String(state.objective || ""),
      $status: String(state.status || "active"),
      $state_json: JSON.stringify(state),
      $updated_at: String(state.updated_at || new Date(0).toISOString()),
    })
  } finally {
    db.close()
  }
}

function rdProgramStateFixture(overrides: JSONRecord): JSONRecord {
  return {
    schema_version: "trade-flow.rd-program-state.v1",
    program_id: "rd-program",
    objective: "find a shadow-eligible 4H swing strategy",
    status: "active",
    created_at: "2026-07-09T12:00:00Z",
    updated_at: "2026-07-09T12:00:00Z",
    budget: {
      max_hypotheses: 20,
      max_trials_total: 80,
      max_locked_holdout_uses: 1,
    },
    usage: {
      hypotheses_run: 0,
      trials_run: 0,
      locked_holdout_uses: 0,
    },
    stop_conditions: {},
    rejected_mechanisms: [],
    universe_lessons: [],
    next_hypothesis_queue: [],
    artifact_refs: [],
    ...overrides,
  }
}
