# Data and Q&A sources

## Point in time

Whatever a backtest or decision reads as of a past moment uses only what was published by then.
Each source below states when a value becomes known; lag the value to that moment, not to its
reference date.

## FRED / ALFRED — economic and rate series

- `GET https://api.stlouisfed.org/fred/...` with `api_key=$(key FRED_API_KEY)&file_type=json`
  (the key can only go in the query string, so never show the expanded URL). About 120 requests a
  minute.
- `series/search?search_text=...` to find IDs; `series?series_id=` for units, frequency and
  release; `series/observations?series_id=...&observation_start=&observation_end=`.
- A series is revised after release; use the vintage known then:
  `realtime_start=realtime_end=<that date>`, or each value's first release with
  `output_type=4&realtime_start=1776-07-04&realtime_end=9999-12-31` (its `realtime_start` is the
  release date). `realtime_end=9999-12-31` with an earlier
  `realtime_start` lists every vintage in one call. Latest values are fine for description only.

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

## US dollar liquidity — Treasury cash and New York Fed rates

- Treasury General Account: `GET https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/operating_cash_balance?filter=record_date:gte:YYYY-MM-DD&sort=-record_date&page[size]=`
  (`curl -g` for the brackets), no key. The balance sits in `open_today_bal` on the rows whose
  `account_type` is the TGA opening or closing balance (`close_today_bal` is the string "null"),
  in millions of dollars. Published by 16:00 ET the next business day.
- SOFR: `GET https://markets.newyorkfed.org/api/rates/secured/sofr/search.json?startDate=&endDate=`;
  published about 08:00 ET the next business day and revisable until 14:30 ET
  (`revisionIndicator`). Reverse repo: `/api/rp/reverserepo/propositions/search.json?startDate=&endDate=`,
  results the same afternoon. No key.

## SEC EDGAR — filings, e.g. spot ETF trusts

- Requests must carry `-A "trade-research $(key RESEARCH_CONTACT_EMAIL)"` (otherwise 403); at most
  ten a second. `https://www.sec.gov/files/company_tickers.json` maps tickers to CIKs;
  `https://data.sec.gov/submissions/CIK##########.json` (ten-digit, zero-padded) lists filings; `https://efts.sec.gov/LATEST/search-index?q=...&forms=&dateRange=custom&startdt=&enddt=`
  is full-text search.
- A filing is known from its `acceptanceDateTime` (UTC), never from `filingDate`, which moves to
  the next day for filings accepted after 17:30 ET. EDGAR has no daily ETF flows.

## Kaggle — public datasets

- `GET https://www.kaggle.com/api/v1/datasets/list?search=...&page=` with
  `-H "Authorization: Bearer $(key KAGGLE_API_TOKEN)"`; the `kaggle` CLI (`kaggle datasets files`,
  `kaggle datasets download`) reads `KAGGLE_API_TOKEN` from its environment.
- Uploader lineage is unverified: use a dataset for exploration or as a lead to the original
  publisher, never as a canonical replay input.

## Academic Torrents — bulk corpora catalogue

- Search the catalogue offline: `curl -sS -o FILE https://academictorrents.com/database.xml`
  (rebuilt nightly; title, infohash, size, description), then `GET
  https://academictorrents.com/apiv2/entry/{infohash}`, which returns a `bibtex` string with
  licence and terms, often empty; it is not strict JSON, so parse it with Python
  `json.loads(..., strict=False)`. No token: the `ACADEMIC_TORRENTS_API_TOKEN` in `.env` is an
  account login cookie, needed only for uploads.
- Useful mainly for official bulk files mirrored there (for example Crossref's public data file)
  and community dumps such as Reddit. Uploads are unreviewed and often unlicensed.
- Every download needs the user's confirmation first, stating infohash, size, licence (or that
  none is stated) and destination: BitTorrent publishes the machine's IP and payloads run to hundreds of GB.
  Prefer the original publisher's copy.

## Stack Exchange — practitioner Q&A

- `GET https://api.stackexchange.com/2.3/search/advanced?title=...&site=quant&key=$(key STACKEXCHANGE_KEY)`
  (also `site=stats`, `site=stackoverflow`); responses are gzip, so use `curl --compressed`.
  `q=` also matches bodies and drifts off topic; narrow with `title=` or `tagged=`.
- `filter=withbody` adds bodies; `/questions/{ids}/answers?filter=withbody` for answers.
  The key only raises the daily quota (`quota_remaining` is in every response); when a response
  has `backoff`, wait that many seconds before the next call.
- Answers are leads to a method or a reference, not evidence.
