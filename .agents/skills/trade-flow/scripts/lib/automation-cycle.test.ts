import assert from "node:assert/strict"
import test from "node:test"
import { Database } from "bun:sqlite"
import { buildAutomationCyclePlan } from "./automation-cycle"
import { appendPlanEvent, ensureSchema } from "./plan-events"

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
      include_rd_trackers: false,
      include_catalog_hygiene: false,
    })

    const jobs = asArray(result.jobs).map(asRecord)
    assert.equal(jobs.find((job) => job.job_id === "fast_track_guard")?.active, false)
    assert.equal(jobs.find((job) => job.job_id === "rd_forward_shadow_trackers")?.enabled, false)
    assert.equal(jobs.find((job) => job.job_id === "catalog_hygiene_scan")?.enabled, false)
  } finally {
    db.close()
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
