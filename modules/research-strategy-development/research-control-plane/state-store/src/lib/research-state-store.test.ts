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
    assert.equal((db.query("SELECT COUNT(*) AS count FROM rd_program_trial").get() as { count: number }).count, 1)
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

test("research state store migrates the legacy rd_trial ledger without data loss", () => {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE rd_program (
      program_id TEXT PRIMARY KEY,
      objective TEXT NOT NULL,
      status TEXT NOT NULL,
      state_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE rd_trial (
      trial_id TEXT PRIMARY KEY,
      program_id TEXT NOT NULL,
      hypothesis_id TEXT,
      run_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      result_ref TEXT NOT NULL,
      trial_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      result_json TEXT
    );
    INSERT INTO rd_program VALUES ('program-1', 'legacy', 'active', '{}', '2026-07-14T00:00:00Z');
    INSERT INTO rd_trial VALUES (
      'legacy-trial', 'program-1', NULL, 'legacy-run', 'accepted',
      'artifact://legacy', 1, '2026-07-14T00:00:00Z', '{}'
    );
  `)
  try {
    ensureResearchStateSchema(db)
    assert.equal((db.query("SELECT COUNT(*) AS count FROM rd_program_trial").get() as { count: number }).count, 1)
    const controlColumns = db.query("PRAGMA table_info(rd_trial)").all() as Array<{ name: string }>
    assert.equal(controlColumns.some((column) => column.name === "experiment_id"), true)
  } finally {
    db.close()
  }
})
