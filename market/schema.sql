-- Market database tables, generation 2. Created empty by `market init` (the administrator); the
-- first `market import` on the empty database writes the market_schema row and the commit tests
-- (market/store.py), every later import only runs them.
--
-- Rules: insert only (market_schema's import_seq is the one updated cell); one Dolt commit per
-- import; a run cites one commit. Times are UTC milliseconds as Binance reports them. Prices and
-- volumes are integers at the scales recorded in market_schema. Other timeframes are derived at export.

CREATE TABLE market_schema (
  singleton TINYINT PRIMARY KEY,
  version INT NOT NULL,
  price_scale TINYINT NOT NULL,
  volume_scale TINYINT NOT NULL,
  universe_rule VARCHAR(60) NOT NULL,
  import_seq BIGINT NOT NULL,
  CHECK (singleton = 1),
  CHECK (import_seq >= 0)
);

-- Exchange terms, one row per observation that differs from the previous one. `exchange_info`
-- rows are the public exchangeInfo filters verbatim (the decimals of an increment are the
-- precision) with the contract's classification; `inferred` rows describe a contract that left
-- exchangeInfo before its first import: increments from the most decimals its trades used.
CREATE TABLE instrument (
  symbol VARCHAR(40) NOT NULL,
  observed_at BIGINT NOT NULL,
  terms_source ENUM('exchange_info', 'inferred') NOT NULL,
  price_increment VARCHAR(40) NOT NULL,
  size_increment VARCHAR(40) NOT NULL,
  min_quantity VARCHAR(40) NULL,
  max_quantity VARCHAR(40) NULL,
  min_notional VARCHAR(40) NULL,
  min_price VARCHAR(40) NULL,
  max_price VARCHAR(40) NULL,
  classification JSON NULL,
  PRIMARY KEY (symbol, observed_at),
  CHECK ((terms_source = 'inferred') = (min_quantity IS NULL AND max_quantity IS NULL AND min_notional IS NULL
                                        AND min_price IS NULL AND max_price IS NULL AND classification IS NULL))
);

-- One-minute klines. LAST from `klines`, MARK from `markPriceKlines` (which carry no volume).
CREATE TABLE bar (
  symbol VARCHAR(40) NOT NULL,
  price_type ENUM('LAST', 'MARK') NOT NULL,
  ts_open BIGINT NOT NULL,
  open BIGINT NOT NULL,
  high BIGINT NOT NULL,
  low BIGINT NOT NULL,
  close BIGINT NOT NULL,
  volume BIGINT NOT NULL,
  PRIMARY KEY (symbol, price_type, ts_open),
  CHECK (low > 0 AND low <= open AND low <= close AND high >= open AND high >= close AND volume >= 0),
  CHECK (price_type = 'LAST' OR volume = 0)
);

-- Funding settlements at the exchange's settlement time (millisecond jitter kept).
CREATE TABLE funding (
  symbol VARCHAR(40) NOT NULL,
  funding_time BIGINT NOT NULL,
  rate DECIMAL(20,10) NOT NULL,
  PRIMARY KEY (symbol, funding_time),
  CHECK (rate > -1 AND rate < 1)
);

-- The common tradable range: members at each UTC month start under a versioned rule (market/universe.py).
CREATE TABLE universe_month (
  universe_rule VARCHAR(60) NOT NULL,
  month DATE NOT NULL,
  symbol VARCHAR(40) NOT NULL,
  PRIMARY KEY (universe_rule, month, symbol),
  CHECK (DAYOFMONTH(month) = 1)
);

CREATE VIEW v_universe AS
SELECT universe_rule, month, symbol
FROM universe_month;
