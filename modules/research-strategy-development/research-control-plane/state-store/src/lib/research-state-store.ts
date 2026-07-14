import { Database } from "bun:sqlite"
import { asRecord, numberField, stringField, type JSONRecord } from "../../../../../contracts/runtime-core/src/json"
import { ensureResearchControlPlaneSchema } from "./research-control-plane-schema"

export interface RdProgram {
  program_id: string
  objective: string
  status: string
  state_json: JSONRecord
  updated_at: string
}

export interface RdHypothesis {
  hypothesis_id: string
  program_id: string
  status: string
  mechanism?: string
  priority?: number
  created_at: string
  updated_at: string
  summary_json?: JSONRecord
}

export interface RdTrial {
  trial_id: string
  program_id: string
  hypothesis_id?: string
  run_id: string
  status: string
  result_ref: string
  trial_count: number
  created_at: string
  result_json?: JSONRecord
}

export interface RdHoldoutUse {
  holdout_key: string
  program_id: string
  trial_id: string
  used_at: string
}

export interface RdLesson {
  lesson_id: string
  program_id: string
  hypothesis_id?: string
  lesson_kind: string
  body_json: JSONRecord
  created_at: string
}

export function ensureResearchStateSchema(db: Database): void {
  db.run("PRAGMA foreign_keys = ON")
  migrateLegacyTrialTable(db)
  db.run(`
    CREATE TABLE IF NOT EXISTS rd_program (
      program_id    TEXT PRIMARY KEY,
      objective     TEXT NOT NULL,
      status        TEXT NOT NULL,
      state_json    TEXT NOT NULL CHECK(json_valid(state_json)),
      updated_at    TEXT NOT NULL
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS rd_hypothesis (
      hypothesis_id TEXT PRIMARY KEY,
      program_id    TEXT NOT NULL,
      status        TEXT NOT NULL,
      mechanism     TEXT,
      priority      INTEGER,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      summary_json  TEXT CHECK(summary_json IS NULL OR json_valid(summary_json)),
      FOREIGN KEY (program_id) REFERENCES rd_program(program_id)
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS rd_program_trial (
      trial_id      TEXT PRIMARY KEY,
      program_id    TEXT NOT NULL,
      hypothesis_id TEXT,
      run_id        TEXT NOT NULL UNIQUE,
      status        TEXT NOT NULL,
      result_ref    TEXT NOT NULL,
      trial_count   INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL,
      result_json   TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
      FOREIGN KEY (program_id) REFERENCES rd_program(program_id)
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS rd_holdout_use (
      holdout_key   TEXT PRIMARY KEY,
      program_id    TEXT NOT NULL,
      trial_id      TEXT NOT NULL,
      used_at       TEXT NOT NULL,
      FOREIGN KEY (program_id) REFERENCES rd_program(program_id),
      FOREIGN KEY (trial_id) REFERENCES rd_program_trial(trial_id)
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS rd_lesson (
      lesson_id     TEXT PRIMARY KEY,
      program_id    TEXT NOT NULL,
      hypothesis_id TEXT,
      lesson_kind   TEXT NOT NULL,
      body_json     TEXT NOT NULL CHECK(json_valid(body_json)),
      created_at    TEXT NOT NULL,
      FOREIGN KEY (program_id) REFERENCES rd_program(program_id)
    )
  `)
  db.run("CREATE INDEX IF NOT EXISTS idx_rd_hypothesis_program_status ON rd_hypothesis(program_id, status)")
  db.run("CREATE INDEX IF NOT EXISTS idx_rd_program_trial_program_time ON rd_program_trial(program_id, created_at DESC)")
  ensureResearchControlPlaneSchema(db)
}

export function upsertRdProgram(db: Database, program: RdProgram): void {
  validateRdProgram(program)
  db.query(`
    INSERT INTO rd_program(program_id, objective, status, state_json, updated_at)
    VALUES ($program_id, $objective, $status, $state_json, $updated_at)
    ON CONFLICT(program_id) DO UPDATE SET
      objective = excluded.objective,
      status = excluded.status,
      state_json = excluded.state_json,
      updated_at = excluded.updated_at
  `).run({
    $program_id: program.program_id,
    $objective: program.objective,
    $status: program.status,
    $state_json: JSON.stringify(program.state_json),
    $updated_at: program.updated_at,
  })
}

export function upsertRdHypothesis(db: Database, hypothesis: RdHypothesis): void {
  validateRdHypothesis(hypothesis)
  db.query(`
    INSERT INTO rd_hypothesis(hypothesis_id, program_id, status, mechanism, priority, created_at, updated_at, summary_json)
    VALUES ($hypothesis_id, $program_id, $status, $mechanism, $priority, $created_at, $updated_at, $summary_json)
    ON CONFLICT(hypothesis_id) DO UPDATE SET
      program_id = excluded.program_id,
      status = excluded.status,
      mechanism = excluded.mechanism,
      priority = excluded.priority,
      updated_at = excluded.updated_at,
      summary_json = excluded.summary_json
  `).run({
    $hypothesis_id: hypothesis.hypothesis_id,
    $program_id: hypothesis.program_id,
    $status: hypothesis.status,
    $mechanism: hypothesis.mechanism ?? null,
    $priority: hypothesis.priority ?? null,
    $created_at: hypothesis.created_at,
    $updated_at: hypothesis.updated_at,
    $summary_json: hypothesis.summary_json ? JSON.stringify(hypothesis.summary_json) : null,
  })
}

export function recordRdTrial(db: Database, trial: RdTrial): void {
  validateRdTrial(trial)
  db.query(`
    INSERT INTO rd_program_trial(trial_id, program_id, hypothesis_id, run_id, status, result_ref, trial_count, created_at, result_json)
    VALUES ($trial_id, $program_id, $hypothesis_id, $run_id, $status, $result_ref, $trial_count, $created_at, $result_json)
  `).run({
    $trial_id: trial.trial_id,
    $program_id: trial.program_id,
    $hypothesis_id: trial.hypothesis_id ?? null,
    $run_id: trial.run_id,
    $status: trial.status,
    $result_ref: trial.result_ref,
    $trial_count: trial.trial_count,
    $created_at: trial.created_at,
    $result_json: trial.result_json ? JSON.stringify(trial.result_json) : null,
  })
}

function migrateLegacyTrialTable(db: Database): void {
  const legacyColumns = db.query("PRAGMA table_info(rd_trial)").all() as Array<{ name: string }>
  if (legacyColumns.length === 0) {
    return
  }
  const names = new Set(legacyColumns.map((column) => column.name))
  if (!names.has("program_id") || names.has("experiment_id")) {
    return
  }
  const migratedTable = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='rd_program_trial'").get()
  if (migratedTable) {
    throw new Error("cannot migrate legacy rd_trial: rd_program_trial already exists")
  }
  db.run("ALTER TABLE rd_trial RENAME TO rd_program_trial")
}

export function recordRdHoldoutUse(db: Database, use: RdHoldoutUse): void {
  validateRdHoldoutUse(use)
  db.query(`
    INSERT INTO rd_holdout_use(holdout_key, program_id, trial_id, used_at)
    VALUES ($holdout_key, $program_id, $trial_id, $used_at)
  `).run({
    $holdout_key: use.holdout_key,
    $program_id: use.program_id,
    $trial_id: use.trial_id,
    $used_at: use.used_at,
  })
}

export function recordRdLesson(db: Database, lesson: RdLesson): void {
  validateRdLesson(lesson)
  db.query(`
    INSERT INTO rd_lesson(lesson_id, program_id, hypothesis_id, lesson_kind, body_json, created_at)
    VALUES ($lesson_id, $program_id, $hypothesis_id, $lesson_kind, $body_json, $created_at)
  `).run({
    $lesson_id: lesson.lesson_id,
    $program_id: lesson.program_id,
    $hypothesis_id: lesson.hypothesis_id ?? null,
    $lesson_kind: lesson.lesson_kind,
    $body_json: JSON.stringify(lesson.body_json),
    $created_at: lesson.created_at,
  })
}

export function readRdProgram(db: Database, programId: string): RdProgram | null {
  const row = db.query("SELECT program_id, objective, status, state_json, updated_at FROM rd_program WHERE program_id=$program_id")
    .get({ $program_id: programId }) as RdProgramRow | null
  return row ? rdProgramFromRow(row) : null
}

export function buildRdProgram(input: JSONRecord): RdProgram {
  const now = stringField(input.updated_at) || stringField(input.now) || new Date().toISOString()
  return {
    program_id: stringField(input.program_id),
    objective: stringField(input.objective),
    status: stringField(input.status) || "active",
    state_json: asRecord(input.state_json ?? input.state),
    updated_at: now,
  }
}

export function buildRdHypothesis(input: JSONRecord): RdHypothesis {
  const now = stringField(input.updated_at) || stringField(input.now) || new Date().toISOString()
  return {
    hypothesis_id: stringField(input.hypothesis_id),
    program_id: stringField(input.program_id),
    status: stringField(input.status),
    mechanism: stringField(input.mechanism) || undefined,
    priority: optionalNumber(input.priority),
    created_at: stringField(input.created_at) || now,
    updated_at: now,
    summary_json: optionalRecord(input.summary_json ?? input.summary),
  }
}

export function buildRdTrial(input: JSONRecord): RdTrial {
  const now = stringField(input.created_at) || stringField(input.now) || new Date().toISOString()
  return {
    trial_id: stringField(input.trial_id),
    program_id: stringField(input.program_id),
    hypothesis_id: stringField(input.hypothesis_id) || undefined,
    run_id: stringField(input.run_id),
    status: stringField(input.status),
    result_ref: stringField(input.result_ref),
    trial_count: numberField(input.trial_count),
    created_at: now,
    result_json: optionalRecord(input.result_json ?? input.result),
  }
}

export function buildRdHoldoutUse(input: JSONRecord): RdHoldoutUse {
  return {
    holdout_key: stringField(input.holdout_key),
    program_id: stringField(input.program_id),
    trial_id: stringField(input.trial_id),
    used_at: stringField(input.used_at) || stringField(input.now) || new Date().toISOString(),
  }
}

export function buildRdLesson(input: JSONRecord): RdLesson {
  return {
    lesson_id: stringField(input.lesson_id),
    program_id: stringField(input.program_id),
    hypothesis_id: stringField(input.hypothesis_id) || undefined,
    lesson_kind: stringField(input.lesson_kind),
    body_json: asRecord(input.body_json ?? input.body),
    created_at: stringField(input.created_at) || stringField(input.now) || new Date().toISOString(),
  }
}

function validateRdProgram(program: RdProgram): void {
  if (!program.program_id || !program.objective || !program.status || !program.updated_at) {
    throw new Error("program_id, objective, status, and updated_at are required")
  }
}

function validateRdHypothesis(hypothesis: RdHypothesis): void {
  if (!hypothesis.hypothesis_id || !hypothesis.program_id || !hypothesis.status || !hypothesis.created_at || !hypothesis.updated_at) {
    throw new Error("hypothesis_id, program_id, status, created_at, and updated_at are required")
  }
}

function validateRdTrial(trial: RdTrial): void {
  if (!trial.trial_id || !trial.program_id || !trial.run_id || !trial.status || !trial.result_ref || !trial.created_at) {
    throw new Error("trial_id, program_id, run_id, status, result_ref, and created_at are required")
  }
}

function validateRdHoldoutUse(use: RdHoldoutUse): void {
  if (!use.holdout_key || !use.program_id || !use.trial_id || !use.used_at) {
    throw new Error("holdout_key, program_id, trial_id, and used_at are required")
  }
}

function validateRdLesson(lesson: RdLesson): void {
  if (!lesson.lesson_id || !lesson.program_id || !lesson.lesson_kind || !lesson.created_at) {
    throw new Error("lesson_id, program_id, lesson_kind, and created_at are required")
  }
}

function optionalNumber(value: unknown): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function optionalRecord(value: unknown): JSONRecord | undefined {
  const record = asRecord(value)
  return Object.keys(record).length > 0 ? record : undefined
}

interface RdProgramRow {
  program_id: string
  objective: string
  status: string
  state_json: string
  updated_at: string
}

function rdProgramFromRow(row: RdProgramRow): RdProgram {
  return {
    program_id: row.program_id,
    objective: row.objective,
    status: row.status,
    state_json: JSON.parse(row.state_json) as JSONRecord,
    updated_at: row.updated_at,
  }
}
