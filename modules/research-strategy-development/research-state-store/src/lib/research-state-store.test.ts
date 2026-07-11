import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import test from "node:test"
import {
  buildRdHoldoutUse,
  buildRdHypothesis,
  buildRdLesson,
  buildRdProgram,
  buildRdTrial,
  ensureResearchStateSchema,
  readRdProgram,
  recordRdHoldoutUse,
  recordRdLesson,
  recordRdTrial,
  upsertRdHypothesis,
  upsertRdProgram,
} from "./research-state-store"

test("research state store records program, hypotheses, trials, holdouts, and lessons", () => {
  const db = new Database(":memory:")
  ensureResearchStateSchema(db)
  try {
    upsertRdProgram(db, buildRdProgram({
      program_id: "rd-main",
      objective: "find a robust 4H swing edge",
      state: { usage: { trials_run: 1 } },
      now: "2026-07-11T00:00:00Z",
    }))
    upsertRdHypothesis(db, buildRdHypothesis({
      hypothesis_id: "h1",
      program_id: "rd-main",
      status: "active",
      mechanism: "trend continuation",
      priority: 1,
      summary: { reason: "candidate queue" },
    }))
    recordRdTrial(db, buildRdTrial({
      trial_id: "trial-1",
      program_id: "rd-main",
      hypothesis_id: "h1",
      run_id: "run-1",
      status: "accepted",
      result_ref: "artifact://runs/run-1.json",
      trial_count: 3,
      result: { r_multiple: 1.2 },
    }))
    recordRdHoldoutUse(db, buildRdHoldoutUse({
      holdout_key: "holdout:btc:2026",
      program_id: "rd-main",
      trial_id: "trial-1",
    }))
    recordRdLesson(db, buildRdLesson({
      lesson_id: "lesson-1",
      program_id: "rd-main",
      hypothesis_id: "h1",
      lesson_kind: "negative_control",
      body: { action: "avoid correlated factor copy" },
    }))

    assert.equal(readRdProgram(db, "rd-main")?.state_json.usage && "ok", "ok")
    assert.equal((db.query("SELECT COUNT(*) AS count FROM rd_hypothesis").get() as { count: number }).count, 1)
    assert.equal((db.query("SELECT COUNT(*) AS count FROM rd_trial").get() as { count: number }).count, 1)
    assert.equal((db.query("SELECT COUNT(*) AS count FROM rd_holdout_use").get() as { count: number }).count, 1)
    assert.equal((db.query("SELECT COUNT(*) AS count FROM rd_lesson").get() as { count: number }).count, 1)
  } finally {
    db.close()
  }
})

test("research state store enforces unique trial run ids", () => {
  const db = new Database(":memory:")
  ensureResearchStateSchema(db)
  try {
    upsertRdProgram(db, buildRdProgram({
      program_id: "rd-main",
      objective: "test",
      state: { ok: true },
    }))
    const trial = {
      program_id: "rd-main",
      run_id: "dup-run",
      status: "rejected",
      result_ref: "artifact://run.json",
    }
    recordRdTrial(db, buildRdTrial({ ...trial, trial_id: "trial-a" }))
    assert.throws(() => recordRdTrial(db, buildRdTrial({ ...trial, trial_id: "trial-b" })), /UNIQUE/)
  } finally {
    db.close()
  }
})

