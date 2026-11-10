-- Paper database schema, generation 1 (ledger.db.PAPER_SCHEMA_VERSION). Applied once by `ledger.init`
-- for a profile that holds "paper". Paper runs are execution records, not research: this database is
-- never the research ledger, never published, and its runs add no trial count or exposure
-- (ledger/paper.py).
--
-- Rules: the writer account has SELECT, INSERT and DELETE (`paper delete` removes a sealed run) and
-- UPDATE on ledger_head alone; every write also bumps ledger_head, the concurrency collision point;
-- times are server UTC from BEFORE INSERT triggers; content hashes are generated columns.

CREATE TABLE ledger_schema (
  singleton TINYINT PRIMARY KEY,
  version INT NOT NULL,
  CHECK (singleton = 1),
  CHECK (version > 0)
);

-- Every write sets op_id to its own value: two transactions that set the row to identical values
-- are merged silently instead of conflicting (measured on Dolt 2.7.2).
CREATE TABLE ledger_head (
  singleton TINYINT PRIMARY KEY,
  seq BIGINT NOT NULL,
  op_id VARCHAR(160) NOT NULL,
  CHECK (singleton = 1),
  CHECK (seq >= 0)
);

-- A published candidate's source as `paper start` copied it from the research ledger: the bytes and
-- the entry class the runner loads.
CREATE TABLE paper_source (
  source_sha256 CHAR(64) AS (SHA2(source, 256)) STORED NOT NULL PRIMARY KEY,
  source LONGBLOB NOT NULL,
  entry_class VARCHAR(100) NOT NULL,
  op_id VARCHAR(160) NOT NULL UNIQUE,
  created_at DATETIME(6) NOT NULL
);

-- A paper run's declaration, written before its container starts: the source, the runtime image, the
-- contracts, the market commit its membership was read at and the effective configuration (its
-- `candidate` names the research candidate). The run starts at created_at.
CREATE TABLE paper_run (
  paper_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  source_sha256 CHAR(64) NOT NULL,
  -- <repository>@sha256:<digest>, as the research ledger's trial.image_ref
  image_ref VARCHAR(300) NOT NULL,
  symbols JSON NOT NULL,
  market_commit CHAR(32) NOT NULL,
  config JSON NOT NULL,
  op_id VARCHAR(160) NOT NULL UNIQUE,
  created_at DATETIME(6) NOT NULL,
  FOREIGN KEY (source_sha256) REFERENCES paper_source (source_sha256),
  CHECK (LENGTH(market_commit) = 32)
);

-- A run's seal: written once, after it ends, with its captured files (paper_file) in the same commit.
CREATE TABLE paper_seal (
  paper_id BIGINT PRIMARY KEY,
  op_id VARCHAR(160) NOT NULL UNIQUE,
  created_at DATETIME(6) NOT NULL,
  FOREIGN KEY (paper_id) REFERENCES paper_run (paper_id)
);

-- The sealed run's files: its journal by UTC day, summary, logs and seal.json (the readings computed
-- once at sealing).
CREATE TABLE paper_file (
  paper_id BIGINT NOT NULL,
  path VARCHAR(255) NOT NULL,
  content LONGBLOB NOT NULL,
  sha256 CHAR(64) AS (SHA2(content, 256)) STORED NOT NULL,
  PRIMARY KEY (paper_id, path),
  FOREIGN KEY (paper_id) REFERENCES paper_seal (paper_id)
);

CREATE TRIGGER paper_source_created BEFORE INSERT ON paper_source FOR EACH ROW SET NEW.created_at = UTC_TIMESTAMP(6);
CREATE TRIGGER paper_run_created BEFORE INSERT ON paper_run FOR EACH ROW SET NEW.created_at = UTC_TIMESTAMP(6);
CREATE TRIGGER paper_seal_created BEFORE INSERT ON paper_seal FOR EACH ROW SET NEW.created_at = UTC_TIMESTAMP(6);

-- Commit verification (group `commit`, set service-wide by `ledger.init`, so every database on the service
-- needs at least one test of it): a seal is written with its files, seal.json among them.
INSERT INTO dolt_tests VALUES
  ('paper_seals_have_their_seal_file', 'commit',
   'SELECT COUNT(*) FROM paper_seal s LEFT JOIN paper_file f ON f.paper_id = s.paper_id AND f.path = ''seal.json'' WHERE f.paper_id IS NULL',
   'expected_single_value', '==', '0');
