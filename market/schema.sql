-- Market database tables, generation 2. Created empty by `market init` (the administrator); the
-- first `market import` on the empty database writes the market_schema row and the commit tests
-- (market/store.py), every later import only runs them.
--
-- Rules: insert only (market_schema's import_seq is the one updated cell); one Dolt commit per
-- import; a run cites one commit. Times are UTC milliseconds as Binance reports them. Bar/quote prices
-- and bar volumes use market_schema's scales; agg_trade has its own codec below. Other timeframes are derived at export.

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

-- The import account may update market_schema only to step import_seq (Dolt 2.4.2 has no column grants):
-- the generation, scales and universe rule are fixed once written.
CREATE TRIGGER market_schema_fixed BEFORE UPDATE ON market_schema FOR EACH ROW BEGIN IF NEW.singleton <> OLD.singleton OR NEW.version <> OLD.version OR NEW.price_scale <> OLD.price_scale OR NEW.volume_scale <> OLD.volume_scale OR NEW.universe_rule <> OLD.universe_rule OR NEW.import_seq <> OLD.import_seq + 1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'market_schema: an import only steps import_seq by one'; END IF; END;

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

-- Best bid and ask inferred from Binance aggTrades under one declared rule (market/quotes.py: the rule's
-- name is in every quote import's commit message), one row per change of the inferred state.
-- `agg_trade_id` is the aggTrade that produced the state: it separates the rows of one
-- millisecond and lets a row be checked against a re-downloaded archive. Sizes are not observable and are
-- not stored (the exporter fills the instrument's max quantity: no depth modeled). Prices x 10^price_scale.
CREATE TABLE quote (
  symbol VARCHAR(40) NOT NULL,
  ts BIGINT NOT NULL,
  agg_trade_id BIGINT NOT NULL,
  bid BIGINT NOT NULL,
  ask BIGINT NOT NULL,
  PRIMARY KEY (symbol, ts, agg_trade_id),
  CHECK (bid > 0 AND ask > bid)
);

-- Complete Binance USD-M aggTrades, including trades which did not change the inferred quote.
-- Price and quantity are exact signed integers x 1e8, independently of market_schema's bar scales.
-- The codec identity, daily archive hashes and readings belong to the import commit, not each row.
CREATE TABLE agg_trade (
  symbol VARCHAR(40) NOT NULL,
  transact_time BIGINT NOT NULL,
  agg_trade_id BIGINT NOT NULL,
  price BIGINT NOT NULL,
  quantity BIGINT NOT NULL,
  first_trade_id BIGINT NOT NULL,
  last_trade_id BIGINT NOT NULL,
  is_buyer_maker BOOLEAN NOT NULL,
  PRIMARY KEY (symbol, transact_time, agg_trade_id)
);

-- Binance USD-M daily `metrics` archives (market/metrics.py): open interest and three long/short ratios every
-- five minutes, keyed by the archive's create_time and named as the archive names them. A row describes
-- create_time + 5 min; an export makes it visible later (market/export.py). A ratio the archive leaves empty
-- stays NULL. The archive's taker volume ratio and open interest value are not stored. Decimals are exact.
CREATE TABLE metrics (
  symbol VARCHAR(40) NOT NULL,
  create_time BIGINT NOT NULL,
  sum_open_interest DECIMAL(38,16) NOT NULL,
  count_toptrader_long_short_ratio DECIMAL(38,16) NULL,
  sum_toptrader_long_short_ratio DECIMAL(38,16) NULL,
  count_long_short_ratio DECIMAL(38,16) NULL,
  PRIMARY KEY (symbol, create_time),
  CHECK (create_time % 300000 = 0),
  CHECK (sum_open_interest >= 0 AND count_toptrader_long_short_ratio >= 0 AND sum_toptrader_long_short_ratio >= 0
         AND count_long_short_ratio >= 0)
);
