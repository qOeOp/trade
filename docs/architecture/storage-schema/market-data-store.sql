-- owner: market-data-products
-- physical target: data/market_data.db
-- mode: manifest upsert plus immutable instrument-status / aggregate-trade archive CAS

CREATE TABLE IF NOT EXISTS market_manifest (
  manifest_id     TEXT PRIMARY KEY,
  dataset_kind    TEXT NOT NULL,
  source          TEXT NOT NULL,
  exchange        TEXT NOT NULL,
  symbol          TEXT,
  timeframe       TEXT,
  first_ts        BIGINT,
  last_ts         BIGINT,
  rows            BIGINT,
  content_hash    TEXT NOT NULL,
  manifest_path   TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  freshness_json  TEXT
);

CREATE TABLE IF NOT EXISTS funding_event (
  manifest_id  TEXT NOT NULL,
  exchange     TEXT NOT NULL,
  symbol       TEXT NOT NULL,
  funding_time BIGINT NOT NULL,
  funding_rate DOUBLE NOT NULL,
  mark_price   DOUBLE,
  PRIMARY KEY (exchange, symbol, funding_time)
);

CREATE TABLE IF NOT EXISTS feature_manifest (
  feature_manifest_id TEXT PRIMARY KEY,
  source_manifest_id  TEXT NOT NULL,
  feature_set_id      TEXT NOT NULL,
  symbol              TEXT,
  timeframe           TEXT,
  content_hash        TEXT NOT NULL,
  manifest_path       TEXT NOT NULL,
  generated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS instrument_status_archive (
  archive_id               TEXT PRIMARY KEY,
  schema_version           TEXT NOT NULL,
  venue_id                 TEXT NOT NULL,
  symbol                   TEXT NOT NULL,
  source_owner             TEXT NOT NULL,
  source_kind              TEXT NOT NULL,
  completeness             TEXT NOT NULL,
  coverage_start           TEXT NOT NULL,
  coverage_end             TEXT NOT NULL,
  source_observed_through  TEXT NOT NULL,
  source_ref               TEXT NOT NULL,
  source_hash              TEXT NOT NULL,
  source_record_count      INTEGER NOT NULL,
  imported_at              TEXT NOT NULL,
  archive_hash             TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS instrument_status_event (
  archive_id      TEXT NOT NULL,
  event_id        TEXT NOT NULL,
  event_sequence  INTEGER NOT NULL,
  status          TEXT NOT NULL,
  effective_at    TEXT NOT NULL,
  observed_at     TEXT NOT NULL,
  source_ref      TEXT NOT NULL,
  source_hash     TEXT NOT NULL,
  source_batch_id TEXT NOT NULL,
  PRIMARY KEY (archive_id, event_sequence),
  UNIQUE (archive_id, event_id),
  FOREIGN KEY (archive_id) REFERENCES instrument_status_archive(archive_id)
);

CREATE TABLE IF NOT EXISTS instrument_status_acquisition_receipt (
  acquisition_id       TEXT PRIMARY KEY,
  schema_version       TEXT NOT NULL,
  venue_id             TEXT NOT NULL,
  symbol               TEXT NOT NULL,
  source_capability    TEXT NOT NULL,
  transport            TEXT NOT NULL,
  terminal_status      TEXT NOT NULL,
  completed_at         TEXT NOT NULL,
  receipt_json         TEXT NOT NULL CHECK(json_valid(receipt_json)),
  receipt_hash         TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS instrument_status_source_payload (
  payload_ref       TEXT PRIMARY KEY,
  acquisition_id    TEXT NOT NULL,
  attempt_ordinal   INTEGER NOT NULL,
  content_hash      TEXT NOT NULL,
  byte_count        INTEGER NOT NULL,
  payload           BLOB NOT NULL,
  UNIQUE (acquisition_id, attempt_ordinal),
  FOREIGN KEY (acquisition_id) REFERENCES instrument_status_acquisition_receipt(acquisition_id)
);

CREATE TABLE IF NOT EXISTS instrument_status_source_batch (
  archive_id               TEXT NOT NULL,
  batch_id                 TEXT NOT NULL,
  batch_sequence           INTEGER NOT NULL,
  schema_version           TEXT NOT NULL,
  venue_id                 TEXT NOT NULL,
  symbol                   TEXT NOT NULL,
  coverage_start           TEXT NOT NULL,
  coverage_end             TEXT NOT NULL,
  source_observed_through  TEXT NOT NULL,
  retrieved_at             TEXT NOT NULL,
  source_ref               TEXT NOT NULL,
  raw_content_hash         TEXT NOT NULL,
  raw_record_count         INTEGER NOT NULL,
  acquisition_receipt_id   TEXT NOT NULL,
  acquisition_receipt_hash TEXT NOT NULL,
  previous_batch_hash      TEXT,
  batch_hash               TEXT NOT NULL,
  PRIMARY KEY (archive_id, batch_sequence),
  UNIQUE (archive_id, batch_id),
  UNIQUE (archive_id, batch_hash),
  FOREIGN KEY (archive_id) REFERENCES instrument_status_archive(archive_id),
  FOREIGN KEY (acquisition_receipt_id) REFERENCES instrument_status_acquisition_receipt(acquisition_id)
);

CREATE TABLE IF NOT EXISTS instrument_status_archive_audit (
  archive_id               TEXT PRIMARY KEY,
  audit_json               TEXT NOT NULL CHECK(json_valid(audit_json)),
  audit_hash               TEXT NOT NULL,
  supersedes_archive_hash  TEXT UNIQUE,
  correction_reason        TEXT,
  FOREIGN KEY (archive_id) REFERENCES instrument_status_archive(archive_id),
  FOREIGN KEY (supersedes_archive_hash) REFERENCES instrument_status_archive(archive_hash),
  CHECK(
    (supersedes_archive_hash IS NULL AND correction_reason IS NULL) OR
    (supersedes_archive_hash IS NOT NULL AND correction_reason IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS aggregate_trade_archive (
  archive_id       TEXT PRIMARY KEY,
  schema_version   TEXT NOT NULL,
  venue_id         TEXT NOT NULL,
  symbol           TEXT NOT NULL,
  coverage_start   TEXT NOT NULL,
  coverage_end     TEXT NOT NULL,
  source_hash      TEXT NOT NULL,
  archive_hash     TEXT NOT NULL UNIQUE,
  archive_json     TEXT NOT NULL CHECK(json_valid(archive_json)),
  raw_payload      BLOB NOT NULL
);
