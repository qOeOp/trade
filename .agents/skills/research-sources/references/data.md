# Economic and positioning data

## Point in time

Whatever a backtest or decision reads as of a past moment uses only what was published by then.
Each source below states when a value becomes known; lag the value to that moment, not to its
reference date.

## FRED / ALFRED — economic, rate and liquidity series

- `GET https://api.stlouisfed.org/fred/...` with `api_key=$(key FRED_API_KEY)&file_type=json`
  (the key can only go in the query string, so never show the expanded URL). About 120 requests a
  minute.
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
  Coinbase perp-style open interest is small next to CME's: weigh it accordingly.
- Positions are as of Tuesday and published Friday 15:30 ET, later in holiday weeks
  (https://www.cftc.gov/MarketReports/CommitmentsofTraders/ReleaseSchedule/index.htm, tentative).
  `report_date_as_yyyy_mm_dd` is the position date; the data carry no release time, and the API
  may serve revised rather than first-published rows.
- Net position is `*_long - *_short`; spreading positions are reported separately. Check
  `contract_units` (e.g. 5 BTC per CME contract) and `futonly_or_combined`.
