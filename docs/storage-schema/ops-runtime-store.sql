-- owner: orchestration-ops
-- physical target: data/ops_runtime.db
-- mode: append observability; not a source of trading truth

CREATE TABLE IF NOT EXISTS cycle_run (
  cycle_id      TEXT PRIMARY KEY,
  triggered_at  TEXT NOT NULL,
  completed_at  TEXT,
  status        TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed', 'blocked')),
  summary_json  TEXT CHECK(summary_json IS NULL OR json_valid(summary_json))
);

CREATE TABLE IF NOT EXISTS job_run (
  job_run_id    TEXT PRIMARY KEY,
  cycle_id      TEXT NOT NULL,
  ticket_no     TEXT NOT NULL,
  job_id        TEXT NOT NULL,
  target_domain TEXT NOT NULL,
  status        TEXT NOT NULL CHECK(status IN ('planned', 'running', 'completed', 'skipped', 'failed', 'blocked')),
  command_ref   TEXT,
  started_at    TEXT,
  completed_at  TEXT,
  result_ref    TEXT,
  error_json    TEXT CHECK(error_json IS NULL OR json_valid(error_json)),
  FOREIGN KEY (cycle_id) REFERENCES cycle_run(cycle_id)
);

CREATE TABLE IF NOT EXISTS runtime_health (
  health_id     TEXT PRIMARY KEY,
  cycle_id      TEXT,
  status        TEXT NOT NULL CHECK(status IN ('ok', 'degraded', 'safe_mode', 'blocked')),
  checks_json   TEXT NOT NULL CHECK(json_valid(checks_json)),
  observed_at   TEXT NOT NULL,
  FOREIGN KEY (cycle_id) REFERENCES cycle_run(cycle_id)
);

CREATE TABLE IF NOT EXISTS notify_attempt (
  notify_id     TEXT PRIMARY KEY,
  cycle_id      TEXT,
  channel       TEXT NOT NULL,
  status        TEXT NOT NULL CHECK(status IN ('planned', 'sent', 'failed', 'skipped')),
  payload_ref   TEXT,
  result_json   TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
  attempted_at  TEXT NOT NULL,
  FOREIGN KEY (cycle_id) REFERENCES cycle_run(cycle_id)
);

CREATE TABLE IF NOT EXISTS domain_message (
  message_id       TEXT PRIMARY KEY,
  cycle_id         TEXT,
  job_id           TEXT,
  direction        TEXT NOT NULL CHECK(direction IN ('inbox', 'outbox')),
  source_domain    TEXT,
  target_domain    TEXT,
  rail             TEXT NOT NULL,
  payload_ref      TEXT NOT NULL,
  idempotency_key  TEXT,
  status           TEXT NOT NULL CHECK(status IN ('queued', 'published', 'consumed', 'failed')),
  envelope_json    TEXT NOT NULL CHECK(json_valid(envelope_json)),
  created_at       TEXT NOT NULL,
  processed_at     TEXT,
  error_json       TEXT CHECK(error_json IS NULL OR json_valid(error_json)),
  FOREIGN KEY (cycle_id) REFERENCES cycle_run(cycle_id)
);

CREATE TABLE IF NOT EXISTS ops_lock (
  lock_key      TEXT PRIMARY KEY,
  holder_id     TEXT NOT NULL,
  acquired_at   TEXT NOT NULL,
  expires_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_job_run_cycle ON job_run(cycle_id, ticket_no);
CREATE INDEX IF NOT EXISTS idx_runtime_health_time ON runtime_health(observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_domain_message_cycle ON domain_message(cycle_id, job_id, direction);
CREATE INDEX IF NOT EXISTS idx_domain_message_target ON domain_message(target_domain, status, created_at);
