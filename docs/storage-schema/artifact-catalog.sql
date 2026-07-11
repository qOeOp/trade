-- owner: artifact-knowledge/artifact-catalog
-- physical: data/data_catalog.db
-- mode: upsert index only; large payload stays in files/artifacts

CREATE TABLE IF NOT EXISTS schema_migration (
  component  TEXT PRIMARY KEY,
  version    INTEGER NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS run (
  run_id       TEXT PRIMARY KEY,
  kind         TEXT NOT NULL,
  status       TEXT NOT NULL,
  started_at   TEXT NOT NULL,
  ended_at     TEXT,
  input_hash   TEXT,
  summary_json TEXT CHECK(summary_json IS NULL OR json_valid(summary_json))
);

CREATE TABLE IF NOT EXISTS dataset (
  dataset_id    TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,
  symbol        TEXT,
  timeframe     TEXT,
  source        TEXT,
  first_ts      INTEGER,
  last_ts       INTEGER,
  rows          INTEGER,
  content_hash  TEXT,
  manifest_path TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artifact (
  artifact_id     TEXT PRIMARY KEY,
  path            TEXT NOT NULL UNIQUE,
  type            TEXT NOT NULL,
  bytes           INTEGER NOT NULL,
  content_hash    TEXT,
  schema_id       TEXT,
  retention_class TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  summary_json    TEXT CHECK(summary_json IS NULL OR json_valid(summary_json))
);

CREATE TABLE IF NOT EXISTS artifact_ref (
  referrer_type TEXT NOT NULL,
  referrer_id   TEXT NOT NULL,
  artifact_id   TEXT NOT NULL,
  role          TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (referrer_type, referrer_id, artifact_id, role),
  FOREIGN KEY (artifact_id) REFERENCES artifact(artifact_id)
);

CREATE TABLE IF NOT EXISTS strategy_rnd_run (
  run_id       TEXT PRIMARY KEY,
  strategy_id  TEXT,
  candidate_id TEXT,
  family       TEXT,
  stage        TEXT,
  accepted     INTEGER NOT NULL CHECK(accepted IN (0, 1)),
  holdout_key  TEXT,
  artifact_id  TEXT,
  record_json  TEXT CHECK(record_json IS NULL OR json_valid(record_json)),
  FOREIGN KEY (run_id) REFERENCES run(run_id),
  FOREIGN KEY (artifact_id) REFERENCES artifact(artifact_id)
);

CREATE TABLE IF NOT EXISTS strategy_evidence (
  evidence_id  TEXT PRIMARY KEY,
  strategy_id  TEXT NOT NULL,
  setup_id     TEXT,
  kind         TEXT NOT NULL,
  policy_hash  TEXT,
  source_ref   TEXT NOT NULL,
  artifact_id  TEXT,
  created_at   TEXT NOT NULL,
  summary_json TEXT CHECK(summary_json IS NULL OR json_valid(summary_json)),
  record_json  TEXT CHECK(record_json IS NULL OR json_valid(record_json)),
  FOREIGN KEY (artifact_id) REFERENCES artifact(artifact_id)
);

CREATE TABLE IF NOT EXISTS panel (
  panel_id      TEXT PRIMARY KEY,
  purpose       TEXT,
  timeframe     TEXT,
  dataset_count INTEGER,
  symbol_count  INTEGER,
  manifest_path TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  summary_json  TEXT CHECK(summary_json IS NULL OR json_valid(summary_json))
);

CREATE TABLE IF NOT EXISTS panel_member (
  panel_id            TEXT NOT NULL,
  dataset_id          TEXT NOT NULL,
  symbol              TEXT,
  manifest_path       TEXT,
  funding_report_path TEXT,
  rows                INTEGER,
  first_ts            INTEGER,
  last_ts             INTEGER,
  artifact_id         TEXT,
  PRIMARY KEY (panel_id, dataset_id),
  FOREIGN KEY (artifact_id) REFERENCES artifact(artifact_id)
);

CREATE TABLE IF NOT EXISTS feature_report (
  artifact_id       TEXT PRIMARY KEY,
  symbol            TEXT,
  exchange          TEXT,
  source_manifest   TEXT,
  generated_at      TEXT,
  indicator_count   INTEGER,
  timeframe_count   INTEGER,
  has_market_events INTEGER NOT NULL CHECK(has_market_events IN (0, 1)),
  summary_json      TEXT CHECK(summary_json IS NULL OR json_valid(summary_json)),
  FOREIGN KEY (artifact_id) REFERENCES artifact(artifact_id)
);

CREATE TABLE IF NOT EXISTS research_report (
  artifact_id  TEXT PRIMARY KEY,
  report_kind  TEXT NOT NULL,
  report_id    TEXT NOT NULL,
  status       TEXT,
  generated_at TEXT,
  summary_json TEXT CHECK(summary_json IS NULL OR json_valid(summary_json)),
  FOREIGN KEY (artifact_id) REFERENCES artifact(artifact_id)
);

CREATE INDEX IF NOT EXISTS idx_artifact_retention ON artifact(retention_class, created_at);
CREATE INDEX IF NOT EXISTS idx_dataset_symbol_timeframe ON dataset(symbol, timeframe, last_ts DESC);
CREATE INDEX IF NOT EXISTS idx_strategy_evidence_strategy ON strategy_evidence(strategy_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_panel_member_symbol ON panel_member(symbol);
CREATE INDEX IF NOT EXISTS idx_feature_report_symbol ON feature_report(symbol, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_research_report_kind ON research_report(report_kind, generated_at DESC);
