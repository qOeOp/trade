-- owner: research-strategy-development/rd-program-state
-- physical target: data/rd_state.db
-- mode: state upsert plus immutable trial/holdout ledger

CREATE TABLE IF NOT EXISTS rd_program (
  program_id    TEXT PRIMARY KEY,
  objective     TEXT NOT NULL,
  status        TEXT NOT NULL,
  state_json    TEXT NOT NULL CHECK(json_valid(state_json)),
  updated_at    TEXT NOT NULL
);

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
);

CREATE TABLE IF NOT EXISTS rd_trial (
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
);

CREATE TABLE IF NOT EXISTS rd_holdout_use (
  holdout_key   TEXT PRIMARY KEY,
  program_id    TEXT NOT NULL,
  trial_id      TEXT NOT NULL,
  used_at       TEXT NOT NULL,
  FOREIGN KEY (program_id) REFERENCES rd_program(program_id),
  FOREIGN KEY (trial_id) REFERENCES rd_trial(trial_id)
);

CREATE TABLE IF NOT EXISTS rd_lesson (
  lesson_id     TEXT PRIMARY KEY,
  program_id    TEXT NOT NULL,
  hypothesis_id TEXT,
  lesson_kind   TEXT NOT NULL,
  body_json     TEXT NOT NULL CHECK(json_valid(body_json)),
  created_at    TEXT NOT NULL,
  FOREIGN KEY (program_id) REFERENCES rd_program(program_id)
);

CREATE INDEX IF NOT EXISTS idx_rd_hypothesis_program_status ON rd_hypothesis(program_id, status);
CREATE INDEX IF NOT EXISTS idx_rd_trial_program_time ON rd_trial(program_id, created_at DESC);
