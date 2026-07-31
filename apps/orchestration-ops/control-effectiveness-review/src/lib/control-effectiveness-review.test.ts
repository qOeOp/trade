import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import test from "node:test"
import {
  buildCycleRun,
  buildIncident,
  buildJobRun,
  ensureOpsRuntimeSchema,
  readControlReviews,
  recordIncident,
  recordNotifyAttempt,
  upsertCycleRun,
  upsertJobRun,
} from "../../../ops-runtime-store/src/lib/ops-runtime-store"
import { runControlEffectivenessReview } from "./control-effectiveness-review"

test("control effectiveness review persists improvement items and next-cycle constraints", () => {
  const db = new Database(":memory:")
  ensureOpsRuntimeSchema(db)
  try {
    upsertCycleRun(db, buildCycleRun({ cycle_id: "cycle-control-1", now: "2026-07-11T00:00:00Z" }))
    recordIncident(db, buildIncident({
      incident_id: "incident-rail-rejected-1",
      cycle_id: "cycle-control-1",
      source: "domain_bus",
      severity: "critical",
      title: "domain bus rail route rejected",
      refs: ["ops-runtime://cycle/cycle-control-1/message/msg-1"],
      first_seen_at: "2026-07-11T00:00:01Z",
    }))
    upsertJobRun(db, buildJobRun({
      job_run_id: "job-run-fast-a",
      cycle_id: "cycle-control-1",
      ticket_no: "J02",
      job_id: "fast_track_guard",
      target_domain: "live-execution-control",
      status: "blocked",
      result_ref: "ops-runtime://cycle/cycle-control-1/job/J02/a",
    }))
    upsertJobRun(db, buildJobRun({
      job_run_id: "job-run-fast-b",
      cycle_id: "cycle-control-1",
      ticket_no: "J02",
      job_id: "fast_track_guard",
      target_domain: "live-execution-control",
      status: "failed",
      result_ref: "ops-runtime://cycle/cycle-control-1/job/J02/b",
    }))
    recordNotifyAttempt(db, {
      notify_id: "notify-failed-1",
      cycle_id: "cycle-control-1",
      channel: "stdout",
      status: "failed",
      attempted_at: "2026-07-11T00:01:00Z",
      result_json: { error: "sink unavailable" },
    })

    const result = runControlEffectivenessReview(db, {
      cycle_id: "cycle-control-1",
      now: "2026-07-11T00:02:00Z",
      repeated_threshold: 2,
    })

    assert.equal(result.ok, true)
    assert.equal(result.processor_id, "control_effectiveness_review")
    assert.equal(result.review.status, "needs_attention")
    assert.equal(result.items.some((item) => item.item_id === "control-item-critical-incident-rail-rejected-1"), true)
    assert.equal(result.items.some((item) => item.item_id === "control-item-repeated-job-fast_track_guard"), true)
    assert.equal(result.items.some((item) => item.item_id === "control-item-notify-notify-failed-1"), true)
    assert.equal(result.next_cycle_constraints.some((constraint) => constraint.type === "review_repeated_job_before_dispatch"), true)

    const reviews = readControlReviews(db, { cycle_id: "cycle-control-1" })
    assert.equal(reviews.length, 1)
    assert.equal(reviews[0].status, "needs_attention")
    assert.equal(reviews[0].items_json.length, result.items.length)
  } finally {
    db.close()
  }
})

test("control effectiveness review reports ok when no control problems are found", () => {
  const db = new Database(":memory:")
  ensureOpsRuntimeSchema(db)
  try {
    upsertCycleRun(db, buildCycleRun({ cycle_id: "cycle-control-ok", now: "2026-07-11T00:00:00Z" }))
    const result = runControlEffectivenessReview(db, {
      cycle_id: "cycle-control-ok",
      now: "2026-07-11T00:02:00Z",
    })
    assert.equal(result.review.status, "ok")
    assert.equal(result.items.length, 0)
    assert.equal(result.next_cycle_constraints.length, 0)
  } finally {
    db.close()
  }
})
