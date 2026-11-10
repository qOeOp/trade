-- Research ledger schema, generation 1 (ledger.db.SCHEMA_VERSION). Applied once by `ledger.init` on the
-- research branch; a later schema is a new ledger (docs/plans/new-ledger-schema-20261110.zh.md).
--
-- Three tiers (L10): commitments (every table but run_reading; the writer has SELECT and INSERT), readings
-- (run_reading; the writer may also UPDATE it, and only the product's seal command does), and the write
-- coordination row ledger_head (UPDATE). Every write has exactly one head row carrying its op_id; times that
-- prove order are server UTC from BEFORE INSERT triggers; content hashes are generated columns.
--
-- Dolt 2.7.2 stores `(x IS NULL) = (...)` without its parentheses and then cannot parse its own table, so an
-- equality of two conditions writes each side as `IS NOT NULL` or a comparison (measured).
--
-- CHECK, ENUM, primary and unique keys hold against the writer. Foreign keys do not: a writer session can
-- turn foreign_key_checks off (measured on Dolt 2.7.2), so `ledger review` runs DOLT_VERIFY_CONSTRAINTS on
-- new commits. Every composite foreign key has a unique key of the same columns on its parent.

CREATE TABLE ledger_schema (
  singleton TINYINT PRIMARY KEY,
  version INT NOT NULL,
  CHECK (singleton = 1),
  CHECK (version > 0)
);

-- Every write sets op_id to its own value: two transactions that set the row to identical values are
-- merged silently instead of conflicting (measured on Dolt 2.7.2).
CREATE TABLE ledger_head (
  singleton TINYINT PRIMARY KEY,
  seq BIGINT NOT NULL,
  op_id VARCHAR(160) NOT NULL,
  CHECK (singleton = 1),
  CHECK (seq >= 0)
);

-- A candidate is the exact bytes of one single-file strategy; its identity is the content hash, and
-- strategy_id@revision is its name.
CREATE TABLE candidate (
  source LONGBLOB NOT NULL,
  source_sha256 CHAR(64) AS (SHA2(source, 256)) STORED NOT NULL,
  strategy_id VARCHAR(100) NOT NULL,
  revision INT NOT NULL,
  entry_class VARCHAR(100) NOT NULL,
  runtime_contract VARCHAR(40) NOT NULL,
  description VARCHAR(2000) NOT NULL,
  parent_source_sha256 CHAR(64) NULL,
  difference VARCHAR(2000) NULL,
  op_id VARCHAR(160) NOT NULL UNIQUE,
  created_at DATETIME(6) NOT NULL,
  PRIMARY KEY (source_sha256),
  UNIQUE KEY candidate_name (strategy_id, revision),
  UNIQUE KEY candidate_contract (source_sha256, runtime_contract),
  FOREIGN KEY (parent_source_sha256) REFERENCES candidate (source_sha256),
  CHECK (revision > 0),
  CHECK ((parent_source_sha256 IS NOT NULL) = (difference IS NOT NULL)),
  CHECK (parent_source_sha256 IS NULL OR parent_source_sha256 <> source_sha256)
);

-- A research line: its starting candidate and the development period fixed when it opened
-- (docs/plans/line-close-history-test-20261110.zh.md).
CREATE TABLE research_line (
  line_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(64) NOT NULL UNIQUE,
  start_source_sha256 CHAR(64) NOT NULL,
  market_commit CHAR(32) NOT NULL,
  universe_rule VARCHAR(60) NOT NULL,
  dev_start DATE NOT NULL,
  dev_end DATE NOT NULL,
  op_id VARCHAR(160) NOT NULL UNIQUE,
  created_at DATETIME(6) NOT NULL,
  FOREIGN KEY (start_source_sha256) REFERENCES candidate (source_sha256),
  CHECK (dev_start < dev_end)
);

CREATE TABLE line_close (
  line_id INT PRIMARY KEY,
  summary TEXT NOT NULL,
  op_id VARCHAR(160) NOT NULL UNIQUE,
  created_at DATETIME(6) NOT NULL,
  FOREIGN KEY (line_id) REFERENCES research_line (line_id),
  CHECK (LENGTH(summary) > 0)
);

-- The user's two research targets for one line, or the ledger default (line_id NULL, scope 0). A change
-- supersedes the row in force for the same scope; each scope has one chain head and no row is superseded
-- twice, so the targets in force are the one end of its chain.
CREATE TABLE line_target (
  target_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  line_id INT NULL,
  scope_key INT AS (COALESCE(line_id, 0)) STORED NOT NULL,
  root_scope INT AS (IF(supersedes IS NULL, COALESCE(line_id, 0), NULL)) STORED NULL,
  max_drawdown DECIMAL(7,4) NOT NULL,
  annual_return DECIMAL(7,4) NOT NULL,
  supersedes BIGINT NULL UNIQUE,
  op_id VARCHAR(160) NOT NULL UNIQUE,
  created_at DATETIME(6) NOT NULL,
  UNIQUE KEY line_target_root (root_scope),
  UNIQUE KEY line_target_scope (target_id, scope_key),
  FOREIGN KEY (line_id) REFERENCES research_line (line_id),
  FOREIGN KEY (supersedes, scope_key) REFERENCES line_target (target_id, scope_key),
  CHECK (supersedes IS NULL OR supersedes < target_id),
  CHECK (max_drawdown > 0 AND max_drawdown < 1),
  CHECK (annual_return > 0)
);

-- A comparison method committed by a research or validation registration.
CREATE TABLE comparison_design (
  design_id INT AUTO_INCREMENT PRIMARY KEY,
  method VARCHAR(60) NOT NULL,
  block_days INT NOT NULL,
  resamples INT NOT NULL,
  inner_resamples INT NOT NULL,
  seed BIGINT NOT NULL,
  alpha DOUBLE NOT NULL,
  minimum_effect DOUBLE NOT NULL,
  design_reason TEXT NOT NULL,
  CHECK (block_days >= 1 AND resamples >= 1 AND inner_resamples >= 1 AND seed >= 0),
  CHECK (alpha > 0 AND alpha < 0.5 AND minimum_effect >= 0),
  CHECK (LENGTH(design_reason) > 0)
);

-- Evidence: opaque files only. A trial's bundles name it (trial_id); each trial has at most one start
-- and one capture bundle.
CREATE TABLE evidence_bundle (
  bundle VARCHAR(160) PRIMARY KEY,
  kind ENUM('start', 'capture', 'recovery', 'lifecycle', 'source', 'agent') NOT NULL,
  trial_id INT NULL,
  one_per_trial VARCHAR(16) AS (IF(kind IN ('start', 'capture'), kind, NULL)) STORED NULL,
  op_id VARCHAR(160) NULL UNIQUE,
  created_at DATETIME(6) NOT NULL,
  UNIQUE KEY evidence_bundle_trial (trial_id, one_per_trial),
  CHECK ((kind IN ('start', 'capture', 'recovery')) = (trial_id IS NOT NULL)),
  CHECK (trial_id IS NULL OR bundle LIKE CONCAT('trial-', trial_id, '-%'))
);

-- Evidence bytes are stored once per content: the ledger derives the hash of every stored content, and a
-- bundle file only names one (the foreign key), so a writer cannot pair bytes with another hash.
CREATE TABLE evidence_content (
  sha256 CHAR(64) AS (SHA2(content, 256)) STORED NOT NULL,
  content LONGBLOB NOT NULL,
  PRIMARY KEY (sha256),
  CHECK (LENGTH(content) > 0)
);

CREATE TABLE evidence (
  bundle VARCHAR(160) NOT NULL,
  path VARCHAR(512) NOT NULL,
  sha256 CHAR(64) NOT NULL,
  PRIMARY KEY (bundle, path),
  INDEX evidence_sha256 (sha256),
  FOREIGN KEY (bundle) REFERENCES evidence_bundle (bundle),
  FOREIGN KEY (sha256) REFERENCES evidence_content (sha256)
);

-- A research registration: the prediction, the grid and the execution identity committed before replay.
-- `body` keeps the preregistered text (prediction, conditions, changed duties, rationale, sources).
CREATE TABLE research_registration (
  registration_id INT AUTO_INCREMENT PRIMARY KEY,
  line_id INT NOT NULL,
  retry_of INT NULL,
  control_trial_id INT NULL,
  comparison_design_id INT NULL,
  image_ref VARCHAR(300) NOT NULL,
  market_commit CHAR(32) NOT NULL,
  universe_rule VARCHAR(60) NOT NULL,
  lifecycle_bundle VARCHAR(160) NULL,
  export_sha256 CHAR(64) NOT NULL,
  comparable_config_sha256 CHAR(64) NOT NULL,
  body JSON NOT NULL,
  op_id VARCHAR(160) NOT NULL UNIQUE,
  created_at DATETIME(6) NOT NULL,
  INDEX research_registration_line (line_id),
  UNIQUE KEY research_registration_identity (registration_id, line_id, image_ref, market_commit, universe_rule,
                                             export_sha256, comparable_config_sha256),
  FOREIGN KEY (line_id) REFERENCES research_line (line_id),
  FOREIGN KEY (retry_of) REFERENCES research_registration (registration_id),
  FOREIGN KEY (comparison_design_id) REFERENCES comparison_design (design_id),
  FOREIGN KEY (lifecycle_bundle) REFERENCES evidence_bundle (bundle),
  CHECK (retry_of IS NULL OR retry_of < registration_id),
  CHECK (JSON_TYPE(body) = 'OBJECT')
);

-- The out-of-sample registration of one candidate: its window lies after the registration, except for a
-- retry, which keeps the original's candidate, membership rule and window.
CREATE TABLE validation_registration (
  registration_id INT AUTO_INCREMENT PRIMARY KEY,
  source_sha256 CHAR(64) NOT NULL,
  market_commit CHAR(32) NOT NULL,
  universe_rule VARCHAR(60) NOT NULL,
  window_start DATETIME(6) NOT NULL,
  window_end DATETIME(6) NOT NULL,
  comparison_design_id INT NOT NULL,
  retry_of INT NULL,
  op_id VARCHAR(160) NOT NULL UNIQUE,
  created_at DATETIME(6) NOT NULL,
  UNIQUE KEY validation_registration_identity (registration_id, source_sha256, universe_rule, window_start,
                                               window_end),
  FOREIGN KEY (source_sha256) REFERENCES candidate (source_sha256),
  FOREIGN KEY (comparison_design_id) REFERENCES comparison_design (design_id),
  FOREIGN KEY (retry_of, source_sha256, universe_rule, window_start, window_end)
    REFERENCES validation_registration (registration_id, source_sha256, universe_rule, window_start, window_end),
  CHECK (window_start < window_end),
  CHECK (retry_of IS NULL OR retry_of < registration_id),
  CHECK (retry_of IS NOT NULL OR window_start > created_at)
);

-- One row per replay attempt, written before its container starts. Its execution identity is derived by
-- the writer from the image inspection and the coverage receipt, never taken from the caller.
CREATE TABLE trial (
  trial_id INT AUTO_INCREMENT PRIMARY KEY,
  purpose ENUM('explore', 'precheck', 'research', 'validation', 'history') NOT NULL,
  source_sha256 CHAR(64) NOT NULL,
  -- An explore source need not be published; every other purpose runs a candidate under its contract.
  candidate_sha256 CHAR(64) AS (IF(purpose = 'explore', NULL, source_sha256)) STORED NULL,
  line_id INT NULL,
  research_registration_id INT NULL,
  validation_registration_id INT NULL,
  -- <repository>@sha256:<digest>; readers take the digest after the '@' (ledger.db.IMAGE_DIGEST)
  image_ref VARCHAR(300) NOT NULL,
  runtime_contract VARCHAR(40) NOT NULL,
  platform VARCHAR(40) NOT NULL,
  build_revision CHAR(40) NULL,
  market_commit CHAR(32) NOT NULL,
  universe_rule VARCHAR(60) NOT NULL,
  lifecycle_bundle VARCHAR(160) NULL,
  export_sha256 CHAR(64) NOT NULL,
  comparable_config_sha256 CHAR(64) NOT NULL,
  execution ENUM('bars', 'quotes') NOT NULL,
  starting_balance DECIMAL(24,8) NOT NULL,
  input_start DATETIME(6) NOT NULL,
  trade_start DATETIME(6) NOT NULL,
  trade_end DATETIME(6) NOT NULL,
  runner_argv JSON NOT NULL,
  op_id VARCHAR(160) NOT NULL UNIQUE,
  created_at DATETIME(6) NOT NULL,
  INDEX trial_purpose_source (purpose, source_sha256),
  INDEX trial_window (trade_start, trade_end),
  INDEX trial_line (line_id),
  UNIQUE KEY trial_review_target (trial_id, source_sha256, purpose),
  UNIQUE KEY trial_grid_point (research_registration_id, source_sha256),
  UNIQUE KEY trial_validation (validation_registration_id),
  FOREIGN KEY (candidate_sha256, runtime_contract) REFERENCES candidate (source_sha256, runtime_contract),
  FOREIGN KEY (line_id) REFERENCES research_line (line_id),
  FOREIGN KEY (research_registration_id, line_id, image_ref, market_commit, universe_rule, export_sha256,
               comparable_config_sha256)
    REFERENCES research_registration (registration_id, line_id, image_ref, market_commit, universe_rule,
                                      export_sha256, comparable_config_sha256),
  FOREIGN KEY (validation_registration_id, source_sha256, universe_rule, trade_start, trade_end)
    REFERENCES validation_registration (registration_id, source_sha256, universe_rule, window_start, window_end),
  FOREIGN KEY (lifecycle_bundle) REFERENCES evidence_bundle (bundle),
  CHECK (purpose NOT IN ('research', 'history') OR line_id IS NOT NULL),
  CHECK ((purpose = 'research') = (research_registration_id IS NOT NULL)),
  CHECK ((purpose = 'validation') = (validation_registration_id IS NOT NULL)),
  CHECK (input_start <= trade_start AND trade_start < trade_end),
  CHECK (JSON_TYPE(runner_argv) = 'ARRAY')
);

ALTER TABLE evidence_bundle ADD FOREIGN KEY (trial_id) REFERENCES trial (trial_id);
ALTER TABLE research_registration ADD FOREIGN KEY (control_trial_id) REFERENCES trial (trial_id);

CREATE TABLE trial_instrument (
  trial_id INT NOT NULL,
  instrument_id VARCHAR(64) NOT NULL,
  PRIMARY KEY (trial_id, instrument_id),
  FOREIGN KEY (trial_id) REFERENCES trial (trial_id)
);

-- The independent review of one precheck's source; a grid point names the review it relies on.
CREATE TABLE source_review (
  review_id INT AUTO_INCREMENT PRIMARY KEY,
  trial_id INT NOT NULL,
  source_sha256 CHAR(64) NOT NULL,
  -- the trial's purpose type: a foreign key pairs equal column types
  purpose ENUM('explore', 'precheck', 'research', 'validation', 'history') AS ('precheck') STORED NOT NULL,
  verdict ENUM('passed', 'failed') NOT NULL,
  api_status ENUM('passed', 'failed', 'unresolved', 'no_opportunity') NOT NULL,
  api_note TEXT NOT NULL,
  causal_status ENUM('passed', 'failed', 'unresolved', 'no_opportunity') NOT NULL,
  causal_note TEXT NOT NULL,
  activity_status ENUM('passed', 'failed', 'unresolved', 'no_opportunity') NOT NULL,
  activity_note TEXT NOT NULL,
  readiness_status ENUM('passed', 'failed', 'unresolved', 'no_opportunity') NOT NULL,
  readiness_note TEXT NOT NULL,
  reviewer VARCHAR(100) NOT NULL,
  op_id VARCHAR(160) NOT NULL UNIQUE,
  created_at DATETIME(6) NOT NULL,
  INDEX source_review_trial (trial_id),
  UNIQUE KEY source_review_source (review_id, source_sha256),
  FOREIGN KEY (trial_id, source_sha256, purpose) REFERENCES trial (trial_id, source_sha256, purpose),
  CHECK ((verdict = 'passed') = (api_status IN ('passed', 'no_opportunity')
                                 AND causal_status IN ('passed', 'no_opportunity')
                                 AND activity_status IN ('passed', 'no_opportunity')
                                 AND readiness_status IN ('passed', 'no_opportunity')))
);

-- The candidates a research registration commits to run, each on a passed review of the same source.
CREATE TABLE registration_grid_point (
  registration_id INT NOT NULL,
  source_sha256 CHAR(64) NOT NULL,
  source_review_id INT NOT NULL,
  PRIMARY KEY (registration_id, source_sha256),
  FOREIGN KEY (registration_id) REFERENCES research_registration (registration_id),
  FOREIGN KEY (source_sha256) REFERENCES candidate (source_sha256),
  FOREIGN KEY (source_review_id, source_sha256) REFERENCES source_review (review_id, source_sha256)
);

ALTER TABLE trial ADD FOREIGN KEY (research_registration_id, source_sha256)
  REFERENCES registration_grid_point (registration_id, source_sha256);

-- How one trial's capture ended: each stage's state and exit code and the outcome. Written when the
-- capture is sealed or refused; the head row of that write.
CREATE TABLE trial_capture (
  trial_id INT PRIMARY KEY,
  native_state ENUM('started', 'exited') NOT NULL,
  native_exit_code INT NULL,
  audit_state ENUM('started', 'exited') NULL,
  audit_exit_code INT NULL,
  fingerprint_state ENUM('started', 'exited') NULL,
  fingerprint_exit_code INT NULL,
  outcome_kind ENUM('completed', 'interrupted', 'host_failure') NOT NULL,
  outcome_detail TEXT NULL,
  -- Per-table hashes of a cross-image explore reproduction (replay/reproduce.py); no run row holds them.
  table_hashes JSON NULL,
  op_id VARCHAR(160) NOT NULL UNIQUE,
  created_at DATETIME(6) NOT NULL,
  FOREIGN KEY (trial_id) REFERENCES trial (trial_id),
  CHECK ((native_state = 'exited') = (native_exit_code IS NOT NULL)),
  CHECK (audit_state IS NOT NULL OR audit_exit_code IS NULL),
  CHECK (audit_state IS NULL OR (audit_state = 'exited') = (audit_exit_code IS NOT NULL)),
  CHECK (fingerprint_state IS NOT NULL OR fingerprint_exit_code IS NULL),
  CHECK (fingerprint_state IS NULL OR (fingerprint_state = 'exited') = (fingerprint_exit_code IS NOT NULL))
);

-- Where each captured file went: its bytes in the capture bundle (captured), only its hash (hashed), or none.
CREATE TABLE trial_file (
  trial_id INT NOT NULL,
  path VARCHAR(512) NOT NULL,
  status ENUM('captured', 'captured_empty', 'hashed', 'missing', 'not_started') NOT NULL,
  sha256 CHAR(64) NULL,
  length BIGINT NULL,
  PRIMARY KEY (trial_id, path),
  FOREIGN KEY (trial_id) REFERENCES trial_capture (trial_id),
  CHECK ((status = 'hashed') = (sha256 IS NOT NULL)),
  CHECK ((sha256 IS NOT NULL) = (length IS NOT NULL)),
  CHECK (length IS NULL OR length >= 0)
);

-- A sealed run's committed result. Its readings are run_reading.
CREATE TABLE run (
  trial_id INT PRIMARY KEY,
  failure_reasons JSON NULL,
  status ENUM('passed', 'invalid') AS (IF(failure_reasons IS NULL, 'passed', 'invalid')) STORED NOT NULL,
  fingerprints JSON NULL,
  -- ledger_head.seq when the run was sealed (trigger); orders runs without reading history.
  sealed_seq BIGINT NOT NULL,
  op_id VARCHAR(160) NOT NULL UNIQUE,
  created_at DATETIME(6) NOT NULL,
  INDEX run_sealed_seq (sealed_seq),
  -- a trial: a capture refused for size has no trial_capture, and its invalid run spends the trial
  FOREIGN KEY (trial_id) REFERENCES trial (trial_id),
  CHECK (failure_reasons IS NULL OR JSON_TYPE(failure_reasons) = 'ARRAY'),
  CHECK ((failure_reasons IS NOT NULL) <> (fingerprints IS NOT NULL))
);

-- The one current reading of a passed run: replaceable by the product's seal command after a replay whose
-- native reports match run.fingerprints; earlier values stay in Dolt history.
CREATE TABLE run_reading (
  trial_id INT PRIMARY KEY,
  report JSON NOT NULL,
  product_commit CHAR(40) NOT NULL,
  -- NULL at the first seal (the run's own write); a reseal's own operation.
  op_id VARCHAR(160) NULL UNIQUE,
  computed_at DATETIME(6) NOT NULL,
  FOREIGN KEY (trial_id) REFERENCES run (trial_id),
  CHECK (JSON_TYPE(report) = 'OBJECT')
);

CREATE TABLE run_return (
  trial_id INT NOT NULL,
  ts_event_ns BIGINT NOT NULL,
  native_return DOUBLE NOT NULL,
  mean_gross_notional DECIMAL(24,8) NULL,
  PRIMARY KEY (trial_id, ts_event_ns),
  FOREIGN KEY (trial_id) REFERENCES run (trial_id)
);

CREATE TABLE run_cycle (
  trial_id INT NOT NULL,
  seq INT NOT NULL,
  instrument_id VARCHAR(64) NOT NULL,
  side ENUM('long', 'short') NOT NULL,
  ts_opened_ns BIGINT NOT NULL,
  ts_closed_ns BIGINT NULL,
  realized_pnl DECIMAL(24,8) NOT NULL,
  commissions DECIMAL(24,8) NOT NULL,
  funding DECIMAL(24,8) NOT NULL,
  -- The price PnL is read as realized_pnl + commissions - funding (ledger.metrics.PRICE_PNL), not stored.
  open_unrealized DECIMAL(24,8) NULL,
  plan_tag VARCHAR(160) NULL,
  closing_order_type VARCHAR(40) NULL,
  closing_order_tag VARCHAR(160) NULL,
  PRIMARY KEY (trial_id, seq),
  FOREIGN KEY (trial_id) REFERENCES run (trial_id),
  CHECK (ts_closed_ns IS NULL OR open_unrealized IS NULL)
);

-- An Agent judgment on one line; a correction supersedes a judgment of the same line.
CREATE TABLE judgment (
  judgment_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  kind ENUM('recommendation', 'priority', 'interpretation', 'search_exposure') NOT NULL,
  line_id INT NOT NULL,
  based_on_commit CHAR(32) NOT NULL,
  body TEXT NOT NULL,
  supersedes BIGINT NULL UNIQUE,
  op_id VARCHAR(160) NOT NULL UNIQUE,
  created_at DATETIME(6) NOT NULL,
  INDEX judgment_line_kind (line_id, kind),
  UNIQUE KEY judgment_line (judgment_id, line_id),
  FOREIGN KEY (line_id) REFERENCES research_line (line_id),
  FOREIGN KEY (supersedes, line_id) REFERENCES judgment (judgment_id, line_id),
  CHECK (supersedes IS NULL OR supersedes < judgment_id),
  CHECK (LENGTH(based_on_commit) = 32)
);

CREATE TABLE judgment_subject (
  judgment_id BIGINT NOT NULL,
  seq INT NOT NULL,
  role ENUM('about', 'recommended', 'parent', 'control') NOT NULL,
  source_sha256 CHAR(64) NULL,
  trial_id INT NULL,
  research_registration_id INT NULL,
  PRIMARY KEY (judgment_id, seq),
  FOREIGN KEY (judgment_id) REFERENCES judgment (judgment_id),
  FOREIGN KEY (source_sha256) REFERENCES candidate (source_sha256),
  FOREIGN KEY (trial_id) REFERENCES trial (trial_id),
  FOREIGN KEY (research_registration_id) REFERENCES research_registration (registration_id),
  CHECK ((source_sha256 IS NOT NULL) + (trial_id IS NOT NULL) + (research_registration_id IS NOT NULL) = 1),
  CHECK (role = 'about' OR source_sha256 IS NOT NULL)
);

-- RFC 3161 token of the commit that inserted a validation registration (ledger/witness.py); its time is the
-- token's genTime, verified offline against the pinned roots.
CREATE TABLE witness (
  commit_hash CHAR(32) PRIMARY KEY,
  registration_id INT NOT NULL UNIQUE,
  token LONGBLOB NOT NULL,
  FOREIGN KEY (registration_id) REFERENCES validation_registration (registration_id),
  CHECK (LENGTH(commit_hash) = 32),
  CHECK (LENGTH(token) > 0)
);

-- Server time, never a client value or a commit date (`--date` can forge those).
CREATE TRIGGER candidate_created BEFORE INSERT ON candidate FOR EACH ROW SET NEW.created_at = UTC_TIMESTAMP(6);
CREATE TRIGGER research_line_created BEFORE INSERT ON research_line FOR EACH ROW SET NEW.created_at = UTC_TIMESTAMP(6);
CREATE TRIGGER line_close_created BEFORE INSERT ON line_close FOR EACH ROW SET NEW.created_at = UTC_TIMESTAMP(6);
CREATE TRIGGER line_target_created BEFORE INSERT ON line_target FOR EACH ROW SET NEW.created_at = UTC_TIMESTAMP(6);
CREATE TRIGGER evidence_bundle_created BEFORE INSERT ON evidence_bundle FOR EACH ROW SET NEW.created_at = UTC_TIMESTAMP(6);
CREATE TRIGGER research_registration_created BEFORE INSERT ON research_registration FOR EACH ROW SET NEW.created_at = UTC_TIMESTAMP(6);
CREATE TRIGGER validation_registration_created BEFORE INSERT ON validation_registration FOR EACH ROW SET NEW.created_at = UTC_TIMESTAMP(6);
CREATE TRIGGER trial_created BEFORE INSERT ON trial FOR EACH ROW SET NEW.created_at = UTC_TIMESTAMP(6);
CREATE TRIGGER source_review_created BEFORE INSERT ON source_review FOR EACH ROW SET NEW.created_at = UTC_TIMESTAMP(6);
CREATE TRIGGER trial_capture_created BEFORE INSERT ON trial_capture FOR EACH ROW SET NEW.created_at = UTC_TIMESTAMP(6);
CREATE TRIGGER judgment_created BEFORE INSERT ON judgment FOR EACH ROW SET NEW.created_at = UTC_TIMESTAMP(6);
-- A run's seal order and time come from the server.
CREATE TRIGGER run_sealed BEFORE INSERT ON run FOR EACH ROW SET
  NEW.created_at = UTC_TIMESTAMP(6), NEW.sealed_seq = (SELECT seq FROM ledger_head WHERE singleton = 1);
-- A reading's time comes from the server at every write; a reseal never moves it to another run.
CREATE TRIGGER run_reading_computed BEFORE INSERT ON run_reading FOR EACH ROW SET NEW.computed_at = UTC_TIMESTAMP(6);
CREATE TRIGGER run_reading_recomputed BEFORE UPDATE ON run_reading FOR EACH ROW BEGIN
  IF NEW.trial_id <> OLD.trial_id THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'a reading stays with its run'; END IF; SET NEW.computed_at = UTC_TIMESTAMP(6); END;
