-- owner: market-data-products
-- physical target: data/market_data.db
-- mode: manifest upsert plus immutable instrument-status archive CAS

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
  PRIMARY KEY (archive_id, event_sequence),
  UNIQUE (archive_id, event_id),
  FOREIGN KEY (archive_id) REFERENCES instrument_status_archive(archive_id)
);
