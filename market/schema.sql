-- Market data schema, generation 1. Applied once on main by `ledger init --kind market`; imports
-- append on main. Field review: docs/plans/ws8b-market-data-field-review.zh.md.
--
-- Rules: insert only; one Dolt commit per import; a run cites one commit. Times are UTC
-- milliseconds as Binance reports them. Prices and volumes are integers at the scales recorded in
-- market_schema. Other timeframes are derived at export.

CREATE TABLE market_schema (
  singleton TINYINT PRIMARY KEY,
  version INT NOT NULL,
  price_scale TINYINT NOT NULL,
  volume_scale TINYINT NOT NULL,
  pool_rule VARCHAR(60) NOT NULL,
  CHECK (singleton = 1)
);

-- Exchange terms, one row per observation that differs from the previous one. `exchange_info`
-- rows are the public exchangeInfo filters verbatim (the decimals of an increment are the
-- precision); `inferred` rows describe a contract that left exchangeInfo before its first import:
-- increments from the most decimals its trades used, the other terms unknown.
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
  PRIMARY KEY (symbol, observed_at),
  CHECK ((terms_source = 'inferred') = (min_quantity IS NULL AND max_quantity IS NULL AND min_notional IS NULL
                                        AND min_price IS NULL AND max_price IS NULL))
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

-- Quote volume of every closed UTC daily kline of every eligible USDT perpetual: the pool's input.
CREATE TABLE daily_volume (
  symbol VARCHAR(40) NOT NULL,
  day DATE NOT NULL,
  quote_volume DECIMAL(38,10) NOT NULL,
  PRIMARY KEY (symbol, day),
  CHECK (quote_volume >= 0)
);

-- The monthly pool under market_schema.pool_rule (market/universe.py).
CREATE TABLE pool (
  month DATE NOT NULL,
  `rank` TINYINT NOT NULL,
  symbol VARCHAR(40) NOT NULL,
  PRIMARY KEY (month, symbol),
  UNIQUE KEY pool_rank (month, `rank`),
  CHECK (`rank` BETWEEN 1 AND 50),
  CHECK (DAYOFMONTH(month) = 1)
);

-- Commit verification (group `commit`, service-wide): cheap guards on the normal path only.
INSERT INTO dolt_tests VALUES
  ('pool_ranks_are_contiguous', 'commit',
   'SELECT COUNT(*) FROM (SELECT month FROM pool GROUP BY month HAVING MAX(`rank`) <> COUNT(*)) x',
   'expected_single_value', '==', '0'),
  ('pool_members_traded_on_the_eve', 'commit',
   'SELECT COUNT(*) FROM pool p LEFT JOIN daily_volume d ON d.symbol = p.symbol AND d.day = DATE_SUB(p.month, INTERVAL 1 DAY) WHERE d.symbol IS NULL',
   'expected_single_value', '==', '0');
