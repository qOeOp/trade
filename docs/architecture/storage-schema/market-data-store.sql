-- owner: market-data-products
-- physical target: data/market_data.db
-- mode: manifest upsert plus immutable archive / L2 admission / referrer CAS

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

CREATE TABLE IF NOT EXISTS l2_epoch_manifest (
  epoch_id               TEXT PRIMARY KEY,
  schema_version         TEXT NOT NULL,
  exchange               TEXT NOT NULL,
  symbol                 TEXT NOT NULL,
  stream_epoch           TEXT NOT NULL,
  started_at_ms          INTEGER NOT NULL,
  finished_at_ms         INTEGER NOT NULL,
  continuity_status      TEXT NOT NULL,
  termination_reason     TEXT NOT NULL,
  snapshot_ref           TEXT NOT NULL,
  snapshot_hash          TEXT NOT NULL,
  last_update_id         INTEGER NOT NULL,
  received_messages      INTEGER NOT NULL,
  recorded_frames        INTEGER NOT NULL,
  applied_events         INTEGER NOT NULL,
  manifest_path          TEXT NOT NULL,
  manifest_hash          TEXT NOT NULL UNIQUE,
  admitted_at            TEXT NOT NULL,
  source_completeness    TEXT NOT NULL,
  external_completeness  TEXT NOT NULL,
  manifest_json          TEXT NOT NULL CHECK(json_valid(manifest_json)),
  UNIQUE(exchange, symbol, stream_epoch)
);

CREATE TABLE IF NOT EXISTS l2_segment_manifest (
  epoch_id           TEXT NOT NULL,
  segment_sequence   INTEGER NOT NULL,
  segment_ref        TEXT NOT NULL,
  frame_count        INTEGER NOT NULL,
  payload_bytes      INTEGER NOT NULL,
  segment_bytes      INTEGER NOT NULL,
  payload_hash       TEXT NOT NULL,
  segment_hash       TEXT NOT NULL,
  writer_elapsed_ns  INTEGER NOT NULL,
  PRIMARY KEY(epoch_id, segment_sequence),
  UNIQUE(epoch_id, segment_ref),
  FOREIGN KEY(epoch_id) REFERENCES l2_epoch_manifest(epoch_id)
);

CREATE TABLE IF NOT EXISTS l2_epoch_retention (
  epoch_id           TEXT PRIMARY KEY,
  retention_class    TEXT NOT NULL,
  compaction_ref     TEXT,
  deletion_eligible  INTEGER NOT NULL,
  updated_at         TEXT NOT NULL,
  FOREIGN KEY(epoch_id) REFERENCES l2_epoch_manifest(epoch_id)
);

CREATE TABLE IF NOT EXISTS l2_epoch_admission_observation (
  manifest_path      TEXT NOT NULL,
  manifest_hash      TEXT NOT NULL,
  first_seen_at      TEXT NOT NULL,
  last_seen_at       TEXT NOT NULL,
  observation_count  INTEGER NOT NULL,
  outcome            TEXT NOT NULL,
  reason             TEXT NOT NULL,
  epoch_id           TEXT,
  PRIMARY KEY(manifest_path, manifest_hash)
);

CREATE TABLE IF NOT EXISTS l2_epoch_compaction_job (
  job_id                TEXT PRIMARY KEY,
  epoch_id              TEXT NOT NULL UNIQUE,
  source_manifest_hash  TEXT NOT NULL,
  output_path           TEXT NOT NULL UNIQUE,
  proposal_path         TEXT NOT NULL UNIQUE,
  policy_version        TEXT NOT NULL,
  batch_rows            INTEGER NOT NULL,
  job_json              TEXT NOT NULL CHECK(json_valid(job_json)),
  prepared_at           TEXT NOT NULL,
  FOREIGN KEY(epoch_id) REFERENCES l2_epoch_manifest(epoch_id)
);

CREATE TABLE IF NOT EXISTS l2_epoch_compaction (
  compaction_id   TEXT PRIMARY KEY,
  job_id          TEXT NOT NULL UNIQUE,
  epoch_id        TEXT NOT NULL UNIQUE,
  proposal_path   TEXT NOT NULL UNIQUE,
  proposal_hash   TEXT NOT NULL UNIQUE,
  parquet_path    TEXT NOT NULL UNIQUE,
  parquet_hash    TEXT NOT NULL UNIQUE,
  parquet_bytes   INTEGER NOT NULL,
  row_count       INTEGER NOT NULL,
  policy_version  TEXT NOT NULL,
  proposal_json   TEXT NOT NULL CHECK(json_valid(proposal_json)),
  admitted_at     TEXT NOT NULL,
  FOREIGN KEY(job_id) REFERENCES l2_epoch_compaction_job(job_id),
  FOREIGN KEY(epoch_id) REFERENCES l2_epoch_manifest(epoch_id)
);

CREATE TABLE IF NOT EXISTS l2_experiment_attachment_referrer_receipt (
  receipt_id               TEXT PRIMARY KEY,
  receipt_hash             TEXT NOT NULL UNIQUE,
  registered_at            TEXT NOT NULL,
  authority_snapshot_id    TEXT NOT NULL UNIQUE,
  authority_snapshot_ref   TEXT NOT NULL UNIQUE,
  authority_snapshot_hash  TEXT NOT NULL UNIQUE,
  reservation_hash         TEXT NOT NULL UNIQUE,
  request_hash             TEXT NOT NULL UNIQUE,
  dataset_manifest_hash    TEXT NOT NULL,
  source_id                TEXT NOT NULL,
  source_hash              TEXT NOT NULL,
  compaction_id            TEXT NOT NULL,
  epoch_id                 TEXT NOT NULL,
  batch_id                 TEXT NOT NULL,
  batch_hash               TEXT NOT NULL UNIQUE,
  frame_start_inclusive    INTEGER NOT NULL,
  frame_end_exclusive      INTEGER NOT NULL,
  receipt_json             TEXT NOT NULL CHECK(json_valid(receipt_json)),
  FOREIGN KEY(compaction_id) REFERENCES l2_epoch_compaction(compaction_id),
  FOREIGN KEY(epoch_id) REFERENCES l2_epoch_manifest(epoch_id)
);
