-- owner: market-data-products
-- physical target: data/ohlcv.db
-- mode: append-or-upsert by exchange/symbol/timeframe/open_time

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
