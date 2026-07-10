import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { Database } from "bun:sqlite"
import { buildAutomationCyclePlan } from "./automation-cycle"
import { appendPlanEvent, ensureSchema } from "./plan-events"
import { createRdProgramState, updateRdProgramState, writeRdProgramState } from "./rd-program-state"

type JSONRecord = Record<string, unknown>

test("automation cycle plan isolates trade db work from R&D artifact jobs", () => {
  const db = new Database(":memory:")
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

    const result = buildAutomationCyclePlan(db, ".agents/skills/trade-flow/data/trade.db", {
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
    assert.equal(jobs.find((job) => job.job_id === "fast_track_guard")?.active, true)
    assert.equal(jobs.find((job) => job.job_id === "rd_forward_shadow_trackers")?.may_write_trade_db, false)
    const review = asRecord(jobs.find((job) => job.job_id === "closed_flow_review_sweep"))
    assert.equal(review.trigger_mode, "event_or_fallback_sweep")
    assert.equal(review.command, undefined)
    assert.deepEqual(review.candidate_chain_ids, ["flow-cycle-1"])
    assert.equal(jobs.find((job) => job.job_id === "catalog_hygiene_scan")?.command, "bun .agents/skills/trade-flow/scripts/main.ts --catalog-scan --catalog-db ./data/data_catalog.db --catalog-root ./data --catalog-root ./tmp")
    assert.deepEqual(asArray(result.dispatch_order).map((stage) => asRecord(stage).stage), [
      "serial_trade_db_guard",
      "parallel_isolated_work",
      "serial_review_closeout",
    ])
  } finally {
    db.close()
  }
})

test("automation cycle plan can disable optional jobs", () => {
  const db = new Database(":memory:")
  try {
    ensureSchema(db)
    const result = buildAutomationCyclePlan(db, ".agents/skills/trade-flow/data/trade.db", {
      now: "2026-07-09T12:15:00Z",
      include_rd_strategy_supervisor: false,
      include_rd_trackers: false,
      include_catalog_hygiene: false,
    })

    const jobs = asArray(result.jobs).map(asRecord)
    assert.equal(jobs.find((job) => job.job_id === "fast_track_guard")?.active, false)
    assert.equal(jobs.find((job) => job.job_id === "rd_strategy_supervisor")?.enabled, false)
    assert.equal(jobs.find((job) => job.job_id === "rd_forward_shadow_trackers")?.enabled, false)
    assert.equal(jobs.find((job) => job.job_id === "catalog_hygiene_scan")?.enabled, false)
  } finally {
    db.close()
  }
})

test("automation cycle plan can dispatch a learning strategy R&D supervisor", () => {
  const db = new Database(":memory:")
  try {
    ensureSchema(db)
    const result = buildAutomationCyclePlan(db, ".agents/skills/trade-flow/data/trade.db", {
      cycle_id: "cycle-rd-supervisor",
      now: "2026-07-09T12:15:00Z",
      rd_learning_memory_ref: "docs/rd-audit.md",
      rd_strategy_goal: {
        objective: "find a shadow-eligible 4H swing strategy",
        budget: {
          max_hypotheses: 3,
          max_trials_total: 18,
          max_locked_holdout_uses: 1,
        },
      },
    })

    const jobs = asArray(result.jobs).map(asRecord)
    const rd = asRecord(jobs.find((job) => job.job_id === "rd_strategy_supervisor"))
    assert.equal(rd.active, true)
    assert.equal(rd.subagent_role, "strategy-rd-supervisor")
    assert.equal(rd.may_write_trade_db, false)
    assert.equal(rd.may_call_binance_write, false)
    const contract = asRecord(rd.research_loop_contract)
    assert.deepEqual(contract.loop_until, ["shadow_candidate_found", "budget_exhausted", "data_or_tool_blocked"])
    assert.equal(asRecord(contract.budget).max_hypotheses, 3)
    assert.deepEqual(asRecord(contract.learning_memory).write_back, [
      "failure_summary",
      "reliability_gate",
      "rejected_mechanisms",
      "universe_lessons",
      "next_hypothesis_queue",
    ])
    const parallel = asRecord(asArray(result.dispatch_order).find((stage) => asRecord(stage).stage === "parallel_isolated_work"))
    assert.ok(asArray(parallel.job_ids).includes("rd_strategy_supervisor"))
  } finally {
    db.close()
  }
})

test("automation cycle plan can drive R&D supervisor from durable program state", () => {
  const dir = mkdtempSync(join(tmpdir(), "automation-rd-state-"))
  const db = new Database(":memory:")
  try {
    ensureSchema(db)
    const statePath = join(dir, "state.json")
    const catalogDb = join(dir, "catalog.db")
    const state = createRdProgramState({
      programId: "rd-program-main",
      objective: "find a shadow-eligible 4H swing strategy",
      now: "2026-07-09T12:00:00Z",
      budget: {
        max_hypotheses: 2,
        max_trials_total: 8,
        max_locked_holdout_uses: 1,
      },
    })
    writeRdProgramState(statePath, state, catalogDb)

    const activeResult = buildAutomationCyclePlan(db, ".agents/skills/trade-flow/data/trade.db", {
      cycle_id: "cycle-rd-state-active",
      now: "2026-07-09T12:15:00Z",
      rd_program_state_path: statePath,
      rd_strategy_goal: {
        objective: "ignored because durable state is the source of truth",
      },
    })

    const activeJobs = asArray(activeResult.jobs).map(asRecord)
    const activeRd = asRecord(activeJobs.find((job) => job.job_id === "rd_strategy_supervisor"))
    assert.equal(activeRd.active, true)
    assert.equal(asRecord(activeRd.goal).objective, "find a shadow-eligible 4H swing strategy")
    assert.equal(activeRd.program_state_status, "active")
    assert.ok(String(activeRd.program_state_ref).endsWith("state.json"))
    const contract = asRecord(activeRd.research_loop_contract)
    assert.equal(asRecord(contract.budget).max_trials_total, 8)
    assert.equal(asRecord(contract.learning_memory).read_ref, statePath)
    assert.ok(asArray(contract.allowed_actions).includes("--rd-program-state action=plan_next"))

    writeRdProgramState(
      statePath,
      updateRdProgramState(state, {
        now: "2026-07-09T13:00:00Z",
        usageDelta: {
          hypotheses_run: 2,
        },
      }),
      catalogDb,
    )
    const stoppedResult = buildAutomationCyclePlan(db, ".agents/skills/trade-flow/data/trade.db", {
      cycle_id: "cycle-rd-state-stopped",
      now: "2026-07-09T13:15:00Z",
      force_jobs: ["rd_strategy_supervisor"],
      rd_program_state_path: statePath,
    })

    const stoppedJobs = asArray(stoppedResult.jobs).map(asRecord)
    const stoppedRd = asRecord(stoppedJobs.find((job) => job.job_id === "rd_strategy_supervisor"))
    assert.equal(stoppedRd.active, false)
    assert.equal(stoppedRd.program_state_status, "budget_exhausted")
    assert.match(String(stoppedRd.reason), /budget_exhausted/)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("automation cycle plan skips slow jobs on fast cadence until due", () => {
  const db = new Database(":memory:")
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

    const result = buildAutomationCyclePlan(db, ".agents/skills/trade-flow/data/trade.db", {
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
    db.close()
  }
})

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}
