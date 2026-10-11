-- Research ledger schema, generation 1. Applied once on main by `ledger init`; every round branch
-- inherits it. Field review: docs/plans/ws2-ledger-field-review.zh.md.
--
-- Rules: insert only; every write also updates the single ledger_head row (concurrency guard,
-- the later writer gets error 1213); record-level windows are UTC DATETIME(6), native report rows
-- carry nanosecond BIGINT times; typed report columns are generated from the stored raw row.

CREATE TABLE ledger_schema (
  singleton TINYINT PRIMARY KEY,
  version INT NOT NULL,
  CHECK (singleton = 1)
);

-- Every write sets op_id to its own unique value: two writes that set the row to the same value
-- would merge silently instead of conflicting (measured on Dolt 2.4.2).
CREATE TABLE ledger_head (
  singleton TINYINT PRIMARY KEY,
  seq BIGINT NOT NULL,
  op_id VARCHAR(160) NOT NULL,
  CHECK (singleton = 1),
  CHECK (seq >= 0)
);

-- The user's three targets for this round's goal; one row per round branch.
CREATE TABLE goal (
  singleton TINYINT PRIMARY KEY,
  goal_id VARCHAR(100) NOT NULL UNIQUE,
  max_drawdown DECIMAL(10,6) NOT NULL,
  min_annual_return DECIMAL(10,6) NOT NULL,
  min_plan_win_rate DECIMAL(10,6) NOT NULL,
  drawdown_measure ENUM('native_mark_equity_5m') NOT NULL,
  window_start DATETIME(6) NOT NULL,
  window_end DATETIME(6) NOT NULL,
  known_exposure VARCHAR(2000) NOT NULL,
  op_id VARCHAR(160) NOT NULL UNIQUE,
  created_at DATETIME(6) NOT NULL,
  CHECK (singleton = 1),
  CHECK (max_drawdown > 0 AND max_drawdown < 1),
  CHECK (min_annual_return > 0),
  CHECK (min_plan_win_rate >= 0 AND min_plan_win_rate < 1),
  CHECK (window_start < window_end)
);

-- Derived evidence (video bundle files, source notes in claims.json format, exploration notes).
CREATE TABLE evidence_bundle (
  bundle VARCHAR(160) PRIMARY KEY,
  op_id VARCHAR(160) NOT NULL UNIQUE,
  created_at DATETIME(6) NOT NULL
);

CREATE TABLE evidence (
  bundle VARCHAR(160) NOT NULL,
  path VARCHAR(512) NOT NULL,
  content LONGBLOB NOT NULL,
  sha256 CHAR(64) AS (SHA2(content, 256)) STORED,
  byte_length BIGINT AS (LENGTH(content)) STORED,
  PRIMARY KEY (bundle, path),
  INDEX evidence_sha256 (sha256),
  FOREIGN KEY (bundle) REFERENCES evidence_bundle (bundle),
  CHECK (LENGTH(content) > 0)
);

CREATE TABLE strategy_revision (
  strategy_id VARCHAR(100) NOT NULL,
  revision INT NOT NULL,
  source LONGBLOB NOT NULL,
  source_sha256 CHAR(64) AS (SHA2(source, 256)) STORED,
  entry_class VARCHAR(100) NOT NULL,
  runtime_contract VARCHAR(40) NOT NULL,
  description VARCHAR(2000) NOT NULL,
  parent_strategy_id VARCHAR(100) NULL,
  parent_revision INT NULL,
  difference VARCHAR(2000) NULL,
  op_id VARCHAR(160) NOT NULL UNIQUE,
  created_at DATETIME(6) NOT NULL,
  PRIMARY KEY (strategy_id, revision),
  UNIQUE KEY strategy_source (source_sha256),
  FOREIGN KEY (parent_strategy_id, parent_revision) REFERENCES strategy_revision (strategy_id, revision),
  CHECK (revision > 0),
  CHECK ((parent_strategy_id IS NULL AND parent_revision IS NULL AND difference IS NULL)
         OR (parent_strategy_id IS NOT NULL AND parent_revision IS NOT NULL AND difference IS NOT NULL))
);

-- One row per native replay, exploration or sealed, written before the replay starts.
CREATE TABLE trial (
  trial_id INT AUTO_INCREMENT PRIMARY KEY,
  mode ENUM('explore', 'sealed') NOT NULL,
  strategy_source_sha256 CHAR(64) NOT NULL,
  image_ref VARCHAR(300) NOT NULL,
  image_digest CHAR(71) AS (SUBSTRING_INDEX(image_ref, '@', -1)) STORED,
  coins JSON NOT NULL,
  input_start DATETIME(6) NOT NULL,
  trade_start DATETIME(6) NOT NULL,
  trade_end DATETIME(6) NOT NULL,
  op_id VARCHAR(160) NOT NULL UNIQUE,
  created_at DATETIME(6) NOT NULL,
  INDEX trial_source (strategy_source_sha256),
  INDEX trial_created (created_at),
  CHECK (input_start <= trade_start AND trade_start < trade_end)
);

-- A sealed replay of a published strategy revision, stored whole after its audit.
CREATE TABLE run (
  run_id INT AUTO_INCREMENT PRIMARY KEY,
  trial_id INT NOT NULL UNIQUE,
  status ENUM('passed', 'invalid') NOT NULL,
  failure_reasons JSON NULL,
  image_revision CHAR(40) NULL,
  runtime_inspection JSON NOT NULL,
  runtime_contract VARCHAR(40) AS (JSON_UNQUOTE(JSON_EXTRACT(runtime_inspection, '$.runtime_contract'))) STORED,
  nautilus_version VARCHAR(40) AS (JSON_UNQUOTE(JSON_EXTRACT(runtime_inspection, '$.nautilus_version'))) STORED,
  dependency_lock_sha256 CHAR(64) AS (JSON_UNQUOTE(JSON_EXTRACT(runtime_inspection, '$.dependency_lock_sha256'))) STORED,
  effective_config JSON NOT NULL,
  input_identity JSON NOT NULL,
  reader_revision CHAR(40) NOT NULL,
  summary JSON NULL,
  audit JSON NULL,
  final_equity_usdt DECIMAL(24,8) AS (CAST(JSON_UNQUOTE(JSON_EXTRACT(summary, '$.final_equity_usdt')) AS DECIMAL(24,8))) STORED,
  annual_return DOUBLE AS (CAST(JSON_EXTRACT(summary, '$.annualized_return_pct') AS DOUBLE) / 100) STORED,
  -- Product readings (research/records/analysis.py); NULL when the run is invalid or the reading
  -- was refused, with the reason in reading_limitations.
  max_drawdown DOUBLE NULL,
  return_drawdown DOUBLE AS (annual_return / NULLIF(max_drawdown, 0)) STORED,
  plans_closed INT NULL,
  plans_won INT NULL,
  plans_open INT NULL,
  plan_win_rate DOUBLE AS (CAST(plans_won AS DOUBLE) / NULLIF(plans_closed + plans_open, 0)) STORED,
  closed_positions INT NULL,
  open_positions INT NULL,
  realized_pnl_usdt DECIMAL(24,8) NULL,
  commissions_usdt DECIMAL(24,8) NULL,
  funding_usdt DECIMAL(24,8) NULL,
  price_pnl_usdt DECIMAL(24,8) NULL,
  unrealized_usdt DECIMAL(24,8) NULL,
  reading_limitations JSON NOT NULL,
  exposures LONGBLOB NULL,
  op_id VARCHAR(160) NOT NULL UNIQUE,
  created_at DATETIME(6) NOT NULL,
  FOREIGN KEY (trial_id) REFERENCES trial (trial_id),
  CHECK ((status = 'invalid' AND failure_reasons IS NOT NULL) OR (status = 'passed' AND failure_reasons IS NULL)),
  CHECK (status = 'passed' OR (plans_closed IS NULL AND max_drawdown IS NULL AND exposures IS NULL))
);

CREATE TABLE run_order (
  run_id INT NOT NULL,
  seq INT NOT NULL,
  raw JSON NOT NULL,
  tags JSON NOT NULL,
  client_order_id VARCHAR(100) AS (JSON_UNQUOTE(JSON_EXTRACT(raw, '$.client_order_id'))) STORED,
  instrument_id VARCHAR(64) AS (JSON_UNQUOTE(JSON_EXTRACT(raw, '$.instrument_id'))) STORED,
  side VARCHAR(8) AS (JSON_UNQUOTE(JSON_EXTRACT(raw, '$.side'))) STORED,
  order_type VARCHAR(32) AS (JSON_UNQUOTE(JSON_EXTRACT(raw, '$.type'))) STORED,
  status VARCHAR(32) AS (JSON_UNQUOTE(JSON_EXTRACT(raw, '$.status'))) STORED,
  quantity DECIMAL(38,18) AS (CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(raw, '$.quantity')), '') AS DECIMAL(38,18))) STORED,
  filled_qty DECIMAL(38,18) AS (CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(raw, '$.filled_qty')), '') AS DECIMAL(38,18))) STORED,
  price DECIMAL(38,18) AS (CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(raw, '$.price')), '') AS DECIMAL(38,18))) STORED,
  avg_px DECIMAL(38,18) AS (CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(raw, '$.avg_px')), '') AS DECIMAL(38,18))) STORED,
  ts_init BIGINT AS (CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(raw, '$.ts_init')), '') AS SIGNED)) STORED,
  ts_last BIGINT AS (CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(raw, '$.ts_last')), '') AS SIGNED)) STORED,
  parent_order_id VARCHAR(100) AS (NULLIF(JSON_UNQUOTE(JSON_EXTRACT(raw, '$.parent_order_id')), '')) STORED,
  PRIMARY KEY (run_id, seq),
  UNIQUE KEY run_order_id (run_id, client_order_id),
  INDEX run_order_instrument (run_id, instrument_id),
  FOREIGN KEY (run_id) REFERENCES run (run_id)
);

CREATE TABLE run_fill (
  run_id INT NOT NULL,
  seq INT NOT NULL,
  raw JSON NOT NULL,
  ts_event_ns BIGINT NOT NULL,
  event_id VARCHAR(64) AS (JSON_UNQUOTE(JSON_EXTRACT(raw, '$.event_id'))) STORED,
  client_order_id VARCHAR(100) AS (JSON_UNQUOTE(JSON_EXTRACT(raw, '$.client_order_id'))) STORED,
  instrument_id VARCHAR(64) AS (JSON_UNQUOTE(JSON_EXTRACT(raw, '$.instrument_id'))) STORED,
  order_side VARCHAR(8) AS (JSON_UNQUOTE(JSON_EXTRACT(raw, '$.order_side'))) STORED,
  liquidity_side VARCHAR(16) AS (JSON_UNQUOTE(JSON_EXTRACT(raw, '$.liquidity_side'))) STORED,
  last_qty DECIMAL(38,18) AS (CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(raw, '$.last_qty')), '') AS DECIMAL(38,18))) STORED,
  last_px DECIMAL(38,18) AS (CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(raw, '$.last_px')), '') AS DECIMAL(38,18))) STORED,
  commission_usdt DECIMAL(38,18) AS (CAST(NULLIF(SUBSTRING_INDEX(JSON_UNQUOTE(JSON_EXTRACT(raw, '$.commission')), ' ', 1), '') AS DECIMAL(38,18))) STORED,
  position_id VARCHAR(160) AS (JSON_UNQUOTE(JSON_EXTRACT(raw, '$.position_id'))) STORED,
  PRIMARY KEY (run_id, seq),
  INDEX run_fill_order (run_id, client_order_id),
  FOREIGN KEY (run_id) REFERENCES run (run_id)
);

CREATE TABLE run_position (
  run_id INT NOT NULL,
  seq INT NOT NULL,
  raw JSON NOT NULL,
  position_id VARCHAR(200) AS (JSON_UNQUOTE(JSON_EXTRACT(raw, '$.position_id'))) STORED,
  instrument_id VARCHAR(64) AS (JSON_UNQUOTE(JSON_EXTRACT(raw, '$.instrument_id'))) STORED,
  is_snapshot TINYINT AS (IF(JSON_UNQUOTE(JSON_EXTRACT(raw, '$.is_snapshot')) = 'True', 1, 0)) STORED,
  closed TINYINT AS (IF(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(raw, '$.ts_closed')), '') = '', 0, 1)) STORED,
  realized_pnl_usdt DECIMAL(38,18) AS (CAST(NULLIF(SUBSTRING_INDEX(JSON_UNQUOTE(JSON_EXTRACT(raw, '$.realized_pnl')), ' ', 1), '') AS DECIMAL(38,18))) STORED,
  PRIMARY KEY (run_id, seq),
  INDEX run_position_instrument (run_id, instrument_id),
  FOREIGN KEY (run_id) REFERENCES run (run_id)
);

CREATE TABLE run_account (
  run_id INT NOT NULL,
  seq INT NOT NULL,
  raw JSON NOT NULL,
  ts_event_ns BIGINT NOT NULL,
  total DECIMAL(38,18) AS (CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(raw, '$.total')), '') AS DECIMAL(38,18))) STORED,
  locked DECIMAL(38,18) AS (CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(raw, '$.locked')), '') AS DECIMAL(38,18))) STORED,
  free DECIMAL(38,18) AS (CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(raw, '$.free')), '') AS DECIMAL(38,18))) STORED,
  PRIMARY KEY (run_id, seq),
  FOREIGN KEY (run_id) REFERENCES run (run_id)
);

CREATE TABLE run_return (
  run_id INT NOT NULL,
  ts_event_ns BIGINT NOT NULL,
  native_return DOUBLE NOT NULL,
  PRIMARY KEY (run_id, ts_event_ns),
  FOREIGN KEY (run_id) REFERENCES run (run_id)
);

-- Native order event history (order_events.jsonl.gz, WS4); a run without that report has none.
CREATE TABLE run_order_event (
  run_id INT NOT NULL,
  seq INT NOT NULL,
  raw JSON NOT NULL,
  event_id VARCHAR(64) AS (JSON_UNQUOTE(JSON_EXTRACT(raw, '$.event_id'))) STORED,
  client_order_id VARCHAR(100) AS (JSON_UNQUOTE(JSON_EXTRACT(raw, '$.client_order_id'))) STORED,
  event_type VARCHAR(48) AS (JSON_UNQUOTE(JSON_EXTRACT(raw, '$.type'))) STORED,
  ts_event_ns BIGINT AS (CAST(JSON_EXTRACT(raw, '$.ts_event') AS SIGNED)) STORED,
  PRIMARY KEY (run_id, seq),
  INDEX run_order_event_order (run_id, client_order_id),
  FOREIGN KEY (run_id) REFERENCES run (run_id)
);

-- Candidate freeze: one development run of a fixed revision, judged once against the goal gates.
CREATE TABLE freeze (
  freeze_id INT AUTO_INCREMENT PRIMARY KEY,
  run_id INT NOT NULL UNIQUE,
  source_bundle VARCHAR(160) NULL,
  distinct_sources INT NOT NULL,
  result ENUM('passed', 'failed', 'invalid') NOT NULL,
  failed_part ENUM('gross_edge', 'cost', 'frequency', 'tail', 'integrity') NULL,
  note VARCHAR(2000) NOT NULL,
  reader_revision CHAR(40) NOT NULL,
  op_id VARCHAR(160) NOT NULL UNIQUE,
  created_at DATETIME(6) NOT NULL,
  FOREIGN KEY (run_id) REFERENCES run (run_id),
  FOREIGN KEY (source_bundle) REFERENCES evidence_bundle (bundle),
  CHECK ((result = 'failed' AND failed_part IS NOT NULL) OR (result <> 'failed' AND failed_part IS NULL)),
  CHECK (distinct_sources >= 1)
);

-- Confirmation: preregistered on a window that begins after the plan is witnessed.
CREATE TABLE confirmation_plan (
  plan_id INT AUTO_INCREMENT PRIMARY KEY,
  freeze_id INT NOT NULL UNIQUE,
  window_start DATETIME(6) NOT NULL,
  window_end DATETIME(6) NOT NULL,
  op_id VARCHAR(160) NOT NULL UNIQUE,
  created_at DATETIME(6) NOT NULL,
  FOREIGN KEY (freeze_id) REFERENCES freeze (freeze_id),
  CHECK (window_start < window_end)
);

CREATE TABLE confirmation_verdict (
  verdict_id INT AUTO_INCREMENT PRIMARY KEY,
  plan_id INT NOT NULL UNIQUE,
  run_id INT NOT NULL UNIQUE,
  result ENUM('passed', 'failed', 'invalid') NOT NULL,
  failed_part ENUM('gross_edge', 'cost', 'frequency', 'tail', 'integrity') NULL,
  note VARCHAR(2000) NOT NULL,
  reader_revision CHAR(40) NOT NULL,
  op_id VARCHAR(160) NOT NULL UNIQUE,
  created_at DATETIME(6) NOT NULL,
  FOREIGN KEY (plan_id) REFERENCES confirmation_plan (plan_id),
  FOREIGN KEY (run_id) REFERENCES run (run_id),
  CHECK ((result = 'failed' AND failed_part IS NOT NULL) OR (result <> 'failed' AND failed_part IS NULL))
);

-- A verdict is never edited: a correction is a new row naming the verdict it replaces.
CREATE TABLE correction (
  correction_id INT AUTO_INCREMENT PRIMARY KEY,
  freeze_id INT NULL,
  verdict_id INT NULL,
  result ENUM('passed', 'failed', 'invalid') NOT NULL,
  failed_part ENUM('gross_edge', 'cost', 'frequency', 'tail', 'integrity') NULL,
  note VARCHAR(2000) NOT NULL,
  op_id VARCHAR(160) NOT NULL UNIQUE,
  created_at DATETIME(6) NOT NULL,
  FOREIGN KEY (freeze_id) REFERENCES freeze (freeze_id),
  FOREIGN KEY (verdict_id) REFERENCES confirmation_verdict (verdict_id),
  CHECK ((freeze_id IS NULL AND verdict_id IS NOT NULL) OR (freeze_id IS NOT NULL AND verdict_id IS NULL)),
  CHECK ((result = 'failed' AND failed_part IS NOT NULL) OR (result <> 'failed' AND failed_part IS NULL))
);

-- External witness: the RFC 3161 response stamping a freeze or confirmation-plan commit, stored by
-- a later write (research/records/witness.py); verified offline against tsa-roots.pem.
-- Its time is the token's genTime; nothing else here is a time.
CREATE TABLE witness (
  commit_hash CHAR(32) PRIMARY KEY,
  token LONGBLOB NOT NULL,
  op_id VARCHAR(160) NOT NULL UNIQUE,
  CHECK (LENGTH(commit_hash) = 32),
  CHECK (LENGTH(token) > 0)
);

-- Observed fee rate per liquidity side on fill notional (quantity x price); the account terms are
-- run.effective_config.native_account. Nothing here is typed by the Agent.
CREATE VIEW run_cost_basis AS
  SELECT run_id, liquidity_side, COUNT(*) AS fills, SUM(commission_usdt) AS commissions_usdt,
         SUM(last_qty * last_px) AS notional_usdt,
         SUM(commission_usdt) / NULLIF(SUM(last_qty * last_px), 0) AS fee_rate
  FROM run_fill GROUP BY run_id, liquidity_side;

-- Each freeze with its latest correction applied.
CREATE VIEW freeze_latest AS
  SELECT f.freeze_id, f.run_id, f.created_at,
         COALESCE(c.result, f.result) AS result,
         IF(c.correction_id IS NULL, f.failed_part, c.failed_part) AS failed_part,
         c.correction_id
  FROM freeze f
  LEFT JOIN correction c ON c.correction_id = (
    SELECT MAX(x.correction_id) FROM correction x WHERE x.freeze_id = f.freeze_id);

-- Each confirmation verdict with its latest correction applied.
CREATE VIEW verdict_latest AS
  SELECT v.verdict_id, v.plan_id, v.run_id, v.created_at,
         COALESCE(c.result, v.result) AS result,
         IF(c.correction_id IS NULL, v.failed_part, c.failed_part) AS failed_part,
         c.correction_id
  FROM confirmation_verdict v
  LEFT JOIN correction c ON c.correction_id = (
    SELECT MAX(x.correction_id) FROM correction x WHERE x.verdict_id = v.verdict_id);

-- Server time, never a client value or a commit date (`--date` can forge those).
CREATE TRIGGER goal_created BEFORE INSERT ON goal FOR EACH ROW SET NEW.created_at = UTC_TIMESTAMP(6);
CREATE TRIGGER evidence_bundle_created BEFORE INSERT ON evidence_bundle FOR EACH ROW SET NEW.created_at = UTC_TIMESTAMP(6);
CREATE TRIGGER strategy_revision_created BEFORE INSERT ON strategy_revision FOR EACH ROW SET NEW.created_at = UTC_TIMESTAMP(6);
CREATE TRIGGER trial_created BEFORE INSERT ON trial FOR EACH ROW SET NEW.created_at = UTC_TIMESTAMP(6);
CREATE TRIGGER run_created BEFORE INSERT ON run FOR EACH ROW SET NEW.created_at = UTC_TIMESTAMP(6);
CREATE TRIGGER freeze_created BEFORE INSERT ON freeze FOR EACH ROW SET NEW.created_at = UTC_TIMESTAMP(6);
CREATE TRIGGER confirmation_plan_created BEFORE INSERT ON confirmation_plan FOR EACH ROW SET NEW.created_at = UTC_TIMESTAMP(6);
CREATE TRIGGER confirmation_verdict_created BEFORE INSERT ON confirmation_verdict FOR EACH ROW SET NEW.created_at = UTC_TIMESTAMP(6);
CREATE TRIGGER correction_created BEFORE INSERT ON correction FOR EACH ROW SET NEW.created_at = UTC_TIMESTAMP(6);

-- Commit verification (group `commit`, set service-wide by `ledger init`). Guards against mistakes
-- on the normal path; `--skip-verification` bypasses it, so it is not a trust boundary.
INSERT INTO dolt_tests VALUES
  ('freeze_runs_are_sealed', 'commit',
   'SELECT COUNT(*) FROM freeze f JOIN run r ON r.run_id = f.run_id JOIN trial t ON t.trial_id = r.trial_id WHERE t.mode <> ''sealed''',
   'expected_single_value', '==', '0'),
  ('freeze_runs_cover_the_goal_window', 'commit',
   'SELECT COUNT(*) FROM freeze f JOIN run r ON r.run_id = f.run_id JOIN trial t ON t.trial_id = r.trial_id JOIN goal g WHERE t.trade_start <> g.window_start OR t.trade_end <> g.window_end',
   'expected_single_value', '==', '0'),
  ('sealed_runs_have_published_sources', 'commit',
   'SELECT COUNT(*) FROM run r JOIN trial t ON t.trial_id = r.trial_id LEFT JOIN strategy_revision s ON s.source_sha256 = t.strategy_source_sha256 WHERE t.mode <> ''sealed'' OR s.strategy_id IS NULL',
   'expected_single_value', '==', '0'),
  ('confirmation_windows_start_after_registration', 'commit',
   'SELECT COUNT(*) FROM confirmation_plan WHERE window_start <= created_at',
   'expected_single_value', '==', '0'),
  ('confirmation_runs_use_the_frozen_source', 'commit',
   'SELECT COUNT(*) FROM confirmation_verdict v JOIN confirmation_plan p ON p.plan_id = v.plan_id JOIN freeze f ON f.freeze_id = p.freeze_id JOIN run fr ON fr.run_id = f.run_id JOIN trial ft ON ft.trial_id = fr.trial_id JOIN run vr ON vr.run_id = v.run_id JOIN trial vt ON vt.trial_id = vr.trial_id WHERE vt.mode <> ''sealed'' OR vt.strategy_source_sha256 <> ft.strategy_source_sha256 OR vt.trade_start < p.window_start OR vt.trade_end > p.window_end',
   'expected_single_value', '==', '0'),
  ('frozen_runs_are_not_confirmation_runs', 'commit',
   'SELECT COUNT(*) FROM freeze f JOIN confirmation_verdict v ON v.run_id = f.run_id',
   'expected_single_value', '==', '0'),
  ('witnesses_stamp_freeze_or_plan_commits', 'commit',
   'SELECT COUNT(*) FROM witness w WHERE NOT EXISTS (SELECT 1 FROM dolt_diff_freeze d WHERE d.to_commit = w.commit_hash AND d.diff_type = ''added'') AND NOT EXISTS (SELECT 1 FROM dolt_diff_confirmation_plan d WHERE d.to_commit = w.commit_hash AND d.diff_type = ''added'')',
   'expected_single_value', '==', '0'),
  ('one_goal_per_branch', 'commit',
   'SELECT IF(COUNT(*) > 1, 1, 0) FROM goal',
   'expected_single_value', '==', '0');
