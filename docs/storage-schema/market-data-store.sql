-- owner: market-data-products
-- physical target: data/market_data.db or parquet-backed tables
-- mode: append-or-upsert by manifest/content hash

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

CREATE TABLE IF NOT EXISTS canonical_candle (
  manifest_id TEXT NOT NULL,
  exchange    TEXT NOT NULL,
  symbol      TEXT NOT NULL,
  timeframe   TEXT NOT NULL,
  open_time   BIGINT NOT NULL,
  close_time  BIGINT NOT NULL,
  open        DOUBLE NOT NULL,
  high        DOUBLE NOT NULL,
  low         DOUBLE NOT NULL,
  close       DOUBLE NOT NULL,
  volume      DOUBLE,
  quote_volume DOUBLE,
  PRIMARY KEY (exchange, symbol, timeframe, open_time)
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
