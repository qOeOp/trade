# Economic, positioning and crypto derivatives data

## Point in time

Whatever a backtest or decision reads as of a past moment uses only what was published by then.
Each source below states when a value becomes known; lag the value to that moment, not to its
reference date.

## FRED / ALFRED — economic, rate and liquidity series

- `GET https://api.stlouisfed.org/fred/...` with `api_key=$(key FRED_API_KEY)&file_type=json`
  (the key can only go in the query string, so never show the expanded URL). No keyless access:
  without the key every call returns 400. About 120 requests a minute.
- `series/search?search_text=...` to find IDs; `series?series_id=` for units, frequency and
  release; `series/observations?series_id=...&observation_start=&observation_end=`. Liquidity
  series include `SOFR`, `DFF`, `RRPONTSYD` (reverse repo), `WTREGEN` (Treasury General Account,
  weekly), `WALCL` (Fed balance sheet, weekly), `DTWEXBGS` (dollar index) and `VIXCLS`.
- A series is revised after release; use the vintage known then:
  `realtime_start=realtime_end=<that date>`, or each value's first release with
  `output_type=4&realtime_start=1776-07-04&realtime_end=9999-12-31` (its `realtime_start` is the
  release date). `realtime_end=9999-12-31` with an earlier `realtime_start` lists every vintage in
  one call. Latest values are fine for description only.

## CFTC Commitments of Traders — positioning in regulated crypto futures

- Socrata API, no key: `GET https://publicreporting.cftc.gov/resource/{dataset}.json` with
  `$select`, `$where`, `$order`, `$limit` (use `curl -G --data-urlencode`). Datasets: `gpe5-46if`
  (financial futures by trader class: dealers, asset managers, leveraged funds), `yw9f-hn96`
  (same, futures and options), `6dca-aqww` (legacy), `72hh-3qpy` (disaggregated).
- Crypto contracts include CME bitcoin, ether and their micros, and Coinbase Derivatives
  "perp style" contracts. Find codes with `$where=upper(market_and_exchange_names) like
  '%BITCOIN%'`; a code can move between exchanges, so filter on code and market name together.
- Positions are as of Tuesday and published Friday 15:30 ET, later in holiday weeks
  (https://www.cftc.gov/MarketReports/CommitmentsofTraders/ReleaseSchedule/index.htm, tentative).
  `report_date_as_yyyy_mm_dd` is the position date; the data carry no release time, and the API
  may serve revised rather than first-published rows.
- Net position is `*_long - *_short`; spreading positions are reported separately. Check
  `contract_units` (e.g. 5 BTC per CME contract) and `futonly_or_combined`.

## Third-party crypto derivatives data

Neither source is the venue, and both are for analysis in `/tmp` only: their rows and files never
go into the ledger (evidence bundles included), the market or Git, all of which are
public. Keep a statistic or chart from which no row can be rebuilt, with the calls or file paths,
their date and each file's SHA-256. A replay reads neither, so a finding from them is a hypothesis
for `research-round`, never a replay input or a test result.

### Coinalyze — aggregates across venues

- `GET https://api.coinalyze.net/v1/...` with the header `api_key: $(key COINALYZE_API_KEY)`.
  No keyless access (401). 40 calls a minute; each symbol in `symbols` (at most 20) is one call; a
  429 carries `Retry-After`.
- `exchanges` gives venue codes (Binance `A`, Bybit `6`, OKX `3`) and `future-markets` the
  symbols (`BTCUSDT_PERP.A`, `BTCUSDT.6`). `liquidation-history`, `open-interest-history`,
  `funding-rate-history`, `long-short-ratio-history` and `ohlcv-history` take `symbols`,
  `interval` (`1min` to `12hour`, `daily`) and `from`/`to` in Unix seconds.
- A liquidation row `{t, l, s}` is one bucket starting at `t`: `l` longs and `s` shorts
  liquidated, in the base asset (`oi_lq_vol_denominated_in`; `convert_to_usd=true` for USD). Empty
  buckets are left out, and the last row is the bucket still in progress: a bucket is complete
  only after it ends.
- Intraday history is cut daily. Measured for BTCUSDT on 2026-11-02: `1min` reached back 2–3
  weeks, `5min` 3–6 weeks, `1hour` 3–4 months, `4hour` 11 months, `12hour` 2.7 years; `daily`
  is kept in full (Binance from 2020-01).
- Its Binance liquidations are the same sampled stream as below, a lower bound. The API docs ask
  public users to cite Coinalyze.

### CryptoHFTData — events in hourly Parquet files

- `GET https://api.cryptohftdata.com/v1/download?file={exchange}/{YYYY-MM-DD}/{HH}/{symbol}_{type}.parquet`
  answers 302 to a signed storage URL: use `curl -L`, which drops the `Authorization` header on
  the way; the storage refuses it (400), so a script follows the redirect without it. Keyless: 60 requests a minute per IP
  (`RateLimit-*` headers, `Retry-After` on 429). With the key, never `api_key=` in the URL:
  exchange it in the same command and send the token (valid 4 hours) as a header. A 404
  `not_found` is an hour without rows, or a gap: check the gaps page below.

  ```bash
  TOKEN="$(curl -sS -X POST https://api.cryptohftdata.com/v1/jwt-token \
    -H "X-API-Key: $(key CRYPTOHFTDATA_API_KEY)" | jq -r .jwt_token)"
  curl -sSL -H "Authorization: Bearer $TOKEN" -o /tmp/f.parquet \
    "https://api.cryptohftdata.com/v1/download?file=binance_futures/2026-10-10/12/BTCUSDT_liquidations.parquet"
  ```

- `GET /v1/symbols?exchange=binance_futures&data_type=liquidations` lists the symbols, delisted
  ones included. Exchanges include `binance_futures`, `bybit` and `okx_futures` (symbols such as
  `BTCUSDT`, and `BTC-USDT-SWAP` on OKX); types are
  `orderbook`, `trades`, `ticker`, `mark_price`, `open_interest` and `liquidations` (from
  2025-06-28).
- Older files are a zstd frame around the Parquet (magic `28 b5 2f fd`), newer ones plain Parquet
  (`PAR1`): check the first bytes before reading.
- A liquidation row has `received_time` (their receive time, ns), `event_time` and `trade_time`
  (ms), `symbol`, `side`, and `quantity`, `price`, `average_price`, `filled_quantity` as decimal
  strings. It is knowable no earlier than `received_time`.
- Binance rows are its sampled `forceOrder` stream (the latest per symbol per second): counts and
  totals are lower bounds. Bybit and OKX `price` is the bankruptcy price, not a fill; OKX sizes are
  contracts, and its rows can arrive hours late, filed under the arrival hour: load hours past the
  window and filter on `event_time`.
- Files are corrected in place under the same path. Check
  https://www.cryptohftdata.com/docs/data-gaps-and-corrections for the window first.
- Terms: personal or internal use; no redistribution or re-aggregation of the data itself.
