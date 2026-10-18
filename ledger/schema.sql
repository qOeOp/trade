-- Research ledger schema, generation 1 (ledger.db.SCHEMA_VERSION). Applied once by `ledger.init`
-- on the research branch. Every table and view of the ledger database in the design, including
-- the run tables later phases write, so the generation is the final one.
--
-- Rules: insert only (the writer account has INSERT, and UPDATE on ledger_head alone); every write
-- also bumps the single ledger_head row, the concurrency collision point; times that prove order
-- are server UTC from BEFORE INSERT triggers; content hashes are generated columns.
--
-- Dolt 2.4.2: a CHECK of the form `(a) = (b IS NOT NULL)` is stored unparseable and breaks its
-- table, so such checks are written as an explicit OR of the two cases.

CREATE TABLE ledger_schema (
  singleton TINYINT PRIMARY KEY,
  version INT NOT NULL,
  CHECK (singleton = 1),
  CHECK (version > 0)
);

-- Every write sets op_id to its own value: two transactions that set the row to identical values
-- are merged silently instead of conflicting (measured on Dolt 2.4.2).
CREATE TABLE ledger_head (
  singleton TINYINT PRIMARY KEY,
  seq BIGINT NOT NULL,
  op_id VARCHAR(160) NOT NULL,
  CHECK (singleton = 1),
  CHECK (seq >= 0)
);

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

CREATE TABLE candidate (
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
  UNIQUE KEY candidate_source (source_sha256),
  FOREIGN KEY (parent_strategy_id, parent_revision) REFERENCES candidate (strategy_id, revision),
  CHECK (revision > 0),
  CHECK ((parent_strategy_id IS NULL AND parent_revision IS NULL AND difference IS NULL)
         OR (parent_strategy_id IS NOT NULL AND parent_revision IS NOT NULL AND difference IS NOT NULL)),
  CHECK (NOT (parent_strategy_id = strategy_id AND parent_revision = revision))
);

-- One row per replay attempt, written before its container starts.
CREATE TABLE trial (
  trial_id INT AUTO_INCREMENT PRIMARY KEY,
  purpose ENUM('explore', 'precheck', 'research', 'validation') NOT NULL,
  source_sha256 CHAR(64) NOT NULL,
  image_ref VARCHAR(300) NOT NULL,
  image_digest CHAR(71) AS (SUBSTRING_INDEX(image_ref, '@', -1)) STORED,
  instruments JSON NOT NULL,
  input_start DATETIME(6) NOT NULL,
  trade_start DATETIME(6) NOT NULL,
  trade_end DATETIME(6) NOT NULL,
  op_id VARCHAR(160) NOT NULL UNIQUE,
  created_at DATETIME(6) NOT NULL,
  INDEX trial_source (source_sha256),
  CHECK (input_start <= trade_start AND trade_start < trade_end)
);

CREATE TABLE registration_attempt (
  registration_bundle VARCHAR(160) NOT NULL,
  source_sha256 CHAR(64) NOT NULL,
  trial_id INT NOT NULL UNIQUE,
  PRIMARY KEY (registration_bundle, source_sha256),
  FOREIGN KEY (registration_bundle) REFERENCES evidence_bundle (bundle),
  FOREIGN KEY (source_sha256) REFERENCES candidate (source_sha256),
  FOREIGN KEY (trial_id) REFERENCES trial (trial_id)
);

CREATE TABLE run (
  run_id INT AUTO_INCREMENT PRIMARY KEY,
  trial_id INT NOT NULL UNIQUE,
  status ENUM('passed', 'invalid') NOT NULL,
  failure_reasons JSON NULL,
  audit JSON NOT NULL,
  fingerprints JSON NULL,
  op_id VARCHAR(160) NOT NULL UNIQUE,
  created_at DATETIME(6) NOT NULL,
  FOREIGN KEY (trial_id) REFERENCES trial (trial_id),
  CHECK ((status = 'invalid' AND failure_reasons IS NOT NULL) OR (status = 'passed' AND failure_reasons IS NULL))
);

CREATE TABLE run_sealed (
  run_id INT NOT NULL,
  metrics_revision CHAR(40) NOT NULL,
  report JSON NOT NULL,
  op_id VARCHAR(160) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  PRIMARY KEY (run_id, metrics_revision),
  INDEX run_sealed_op (op_id),
  FOREIGN KEY (run_id) REFERENCES run (run_id)
);

CREATE TABLE run_return (
  run_id INT NOT NULL,
  ts_event_ns BIGINT NOT NULL,
  native_return DOUBLE NOT NULL,
  mean_gross_notional DECIMAL(24,8) NULL,
  PRIMARY KEY (run_id, ts_event_ns),
  FOREIGN KEY (run_id) REFERENCES run (run_id)
);

CREATE TABLE run_cycle (
  run_id INT NOT NULL,
  seq INT NOT NULL,
  instrument_id VARCHAR(64) NOT NULL,
  side ENUM('long', 'short') NOT NULL,
  ts_opened_ns BIGINT NOT NULL,
  ts_closed_ns BIGINT NULL,
  realized_pnl DECIMAL(24,8) NULL,
  commissions DECIMAL(24,8) NOT NULL,
  funding DECIMAL(24,8) NOT NULL,
  price_pnl DECIMAL(24,8) AS (IF(ts_closed_ns IS NULL, NULL, realized_pnl + commissions - funding)) VIRTUAL,
  open_unrealized DECIMAL(24,8) NULL,
  plan_tag VARCHAR(160) NULL,
  closing_order_type VARCHAR(40) NULL,
  closing_order_tag VARCHAR(160) NULL,
  PRIMARY KEY (run_id, seq),
  FOREIGN KEY (run_id) REFERENCES run (run_id)
);

CREATE TABLE validation_registration (
  registration_id INT AUTO_INCREMENT PRIMARY KEY,
  strategy_id VARCHAR(100) NOT NULL,
  revision INT NOT NULL,
  market_commit CHAR(32) NOT NULL,
  universe_rule VARCHAR(60) NOT NULL,
  window_start DATETIME(6) NOT NULL,
  window_end DATETIME(6) NOT NULL,
  design JSON NOT NULL,
  retry_of INT NULL,
  op_id VARCHAR(160) NOT NULL UNIQUE,
  created_at DATETIME(6) NOT NULL,
  FOREIGN KEY (strategy_id, revision) REFERENCES candidate (strategy_id, revision),
  FOREIGN KEY (retry_of) REFERENCES validation_registration (registration_id),
  CHECK (window_start < window_end),
  CHECK (retry_of IS NULL OR retry_of < registration_id)
);

CREATE TABLE validation_binding (
  registration_id INT PRIMARY KEY,
  trial_id INT NOT NULL UNIQUE,
  op_id VARCHAR(160) NOT NULL UNIQUE,
  FOREIGN KEY (registration_id) REFERENCES validation_registration (registration_id),
  FOREIGN KEY (trial_id) REFERENCES trial (trial_id)
);

CREATE TABLE judgment (
  judgment_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  kind VARCHAR(32) NOT NULL,
  line_bundle VARCHAR(200) NOT NULL,
  based_on_commit CHAR(32) NOT NULL,
  body TEXT NOT NULL,
  cadence_trials INT NULL,
  supersedes BIGINT NULL UNIQUE,
  op_id VARCHAR(160) NOT NULL UNIQUE,
  created_at DATETIME(6) NOT NULL,
  FOREIGN KEY (line_bundle) REFERENCES evidence_bundle (bundle),
  FOREIGN KEY (supersedes) REFERENCES judgment (judgment_id),
  CHECK (kind IN ('recommendation', 'priority', 'review_cadence', 'interpretation', 'search_exposure')),
  CHECK (line_bundle LIKE 'research-line-%'),
  CHECK ((kind = 'review_cadence' AND cadence_trials IS NOT NULL AND cadence_trials >= 1)
         OR (kind <> 'review_cadence' AND cadence_trials IS NULL))
);

CREATE TABLE judgment_subject (
  judgment_id BIGINT NOT NULL,
  seq INT NOT NULL,
  role VARCHAR(16) NOT NULL,
  strategy_id VARCHAR(100) NULL,
  revision INT NULL,
  trial_id INT NULL,
  registration_bundle VARCHAR(200) NULL,
  PRIMARY KEY (judgment_id, seq),
  FOREIGN KEY (judgment_id) REFERENCES judgment (judgment_id),
  FOREIGN KEY (strategy_id, revision) REFERENCES candidate (strategy_id, revision),
  FOREIGN KEY (trial_id) REFERENCES trial (trial_id),
  FOREIGN KEY (registration_bundle) REFERENCES evidence_bundle (bundle),
  CHECK ((strategy_id IS NOT NULL AND revision IS NOT NULL AND trial_id IS NULL AND registration_bundle IS NULL)
         OR (strategy_id IS NULL AND revision IS NULL AND trial_id IS NOT NULL AND registration_bundle IS NULL)
         OR (strategy_id IS NULL AND revision IS NULL AND trial_id IS NULL AND registration_bundle IS NOT NULL)),
  CHECK (role NOT IN ('recommended', 'parent', 'control') OR strategy_id IS NOT NULL)
);

-- RFC 3161 token of a validation registration's birth commit (ledger/witness.py); its time is
-- the token's genTime, verified offline against the pinned roots.
CREATE TABLE witness (
  commit_hash CHAR(32) PRIMARY KEY,
  token LONGBLOB NOT NULL,
  op_id VARCHAR(160) NOT NULL UNIQUE,
  CHECK (LENGTH(commit_hash) = 32),
  CHECK (LENGTH(token) > 0)
);

-- Read views. Historical reads go through the revision database `db/<commit>`, which keeps the
-- view definitions of that commit. Views are not an access boundary.
CREATE VIEW v_candidates AS
  SELECT strategy_id, revision, source_sha256, entry_class, runtime_contract,
         parent_strategy_id, parent_revision, difference, created_at
  FROM candidate;

CREATE VIEW v_trials AS
  SELECT t.trial_id, t.purpose, t.source_sha256, a.registration_bundle,
         b.registration_id AS validation_registration, t.image_digest,
         t.trade_start, t.trade_end, r.run_id, r.status AS run_status, t.created_at
  FROM trial t
  LEFT JOIN registration_attempt a ON a.trial_id = t.trial_id
  LEFT JOIN validation_binding b ON b.trial_id = t.trial_id
  LEFT JOIN run r ON r.trial_id = t.trial_id;

CREATE VIEW v_runs AS
  SELECT run_id, trial_id, status, failure_reasons, audit, created_at
  FROM run;

CREATE VIEW v_judgments AS
  SELECT j.judgment_id, j.kind, j.line_bundle, j.based_on_commit, j.cadence_trials, j.body,
         s.role, s.strategy_id, s.revision, s.trial_id, s.registration_bundle, j.created_at
  FROM judgment j
  LEFT JOIN judgment_subject s ON s.judgment_id = j.judgment_id
  WHERE NOT EXISTS (SELECT 1 FROM judgment n WHERE n.supersedes = j.judgment_id);

CREATE VIEW v_evidence AS
  SELECT b.bundle, b.created_at, e.path, e.sha256, e.byte_length
  FROM evidence_bundle b
  JOIN evidence e ON e.bundle = b.bundle;

CREATE VIEW v_validations AS
  SELECT g.registration_id, g.strategy_id, g.revision, g.market_commit, g.universe_rule,
         g.window_start, g.window_end, b.trial_id, r.run_id, r.status AS run_status, g.created_at
  FROM validation_registration g
  LEFT JOIN validation_binding b ON b.registration_id = g.registration_id
  LEFT JOIN run r ON r.trial_id = b.trial_id;

-- Server time, never a client value or a commit date (`--date` can forge those).
CREATE TRIGGER evidence_bundle_created BEFORE INSERT ON evidence_bundle FOR EACH ROW SET NEW.created_at = UTC_TIMESTAMP(6);
CREATE TRIGGER candidate_created BEFORE INSERT ON candidate FOR EACH ROW SET NEW.created_at = UTC_TIMESTAMP(6);
CREATE TRIGGER trial_created BEFORE INSERT ON trial FOR EACH ROW SET NEW.created_at = UTC_TIMESTAMP(6);
CREATE TRIGGER run_created BEFORE INSERT ON run FOR EACH ROW SET NEW.created_at = UTC_TIMESTAMP(6);
CREATE TRIGGER run_sealed_created BEFORE INSERT ON run_sealed FOR EACH ROW SET NEW.created_at = UTC_TIMESTAMP(6);
CREATE TRIGGER validation_registration_created BEFORE INSERT ON validation_registration FOR EACH ROW SET NEW.created_at = UTC_TIMESTAMP(6);
CREATE TRIGGER judgment_created BEFORE INSERT ON judgment FOR EACH ROW SET NEW.created_at = UTC_TIMESTAMP(6);

-- Commit verification (group `commit`, set service-wide by `ledger.init`): guards the normal path;
-- `--skip-verification` bypasses it, so it is not a trust boundary. Each query counts violations.
INSERT INTO dolt_tests VALUES
  ('research_and_validation_trials_have_published_sources', 'commit',
   'SELECT COUNT(*) FROM trial t LEFT JOIN candidate c ON c.source_sha256 = t.source_sha256 WHERE t.purpose IN (''research'', ''validation'') AND c.strategy_id IS NULL',
   'expected_single_value', '==', '0'),
  ('validation_trials_are_bound', 'commit',
   'SELECT COUNT(*) FROM trial t LEFT JOIN validation_binding b ON b.trial_id = t.trial_id WHERE t.purpose = ''validation'' AND b.trial_id IS NULL',
   'expected_single_value', '==', '0'),
  ('validation_windows_start_after_registration', 'commit',
   'SELECT COUNT(*) FROM validation_registration WHERE retry_of IS NULL AND window_start <= created_at',
   'expected_single_value', '==', '0'),
  ('validation_runs_match_their_registration', 'commit',
   'SELECT COUNT(*) FROM run r JOIN validation_binding b ON b.trial_id = r.trial_id JOIN trial t ON t.trial_id = r.trial_id JOIN validation_registration g ON g.registration_id = b.registration_id JOIN candidate c ON c.strategy_id = g.strategy_id AND c.revision = g.revision WHERE t.source_sha256 <> c.source_sha256 OR t.trade_start <> g.window_start OR t.trade_end <> g.window_end',
   'expected_single_value', '==', '0'),
  ('validation_retries_keep_candidate_and_window', 'commit',
   'SELECT COUNT(*) FROM validation_registration g JOIN validation_registration o ON o.registration_id = g.retry_of WHERE g.strategy_id <> o.strategy_id OR g.revision <> o.revision OR g.window_start <> o.window_start OR g.window_end <> o.window_end',
   'expected_single_value', '==', '0'),
  ('witnesses_stamp_validation_registrations', 'commit',
   'SELECT COUNT(*) FROM witness w WHERE NOT EXISTS (SELECT 1 FROM dolt_diff_validation_registration d WHERE d.to_commit = w.commit_hash AND d.diff_type = ''added'')',
   'expected_single_value', '==', '0'),
  ('research_trials_follow_their_registration', 'commit',
   'SELECT COUNT(*) FROM registration_attempt a JOIN trial t ON t.trial_id = a.trial_id JOIN evidence_bundle b ON b.bundle = a.registration_bundle WHERE b.created_at >= t.created_at',
   'expected_single_value', '==', '0');
