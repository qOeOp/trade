# Data and Q&A sources

## FRED / ALFRED — economic and rate series

- `GET https://api.stlouisfed.org/fred/...` with `api_key=$(key FRED_API_KEY)&file_type=json` (the key can
  only go in the query string, so never show the expanded URL). About 120 requests a minute.
- `series/search?search_text=...` to find IDs; `series?series_id=` for units, frequency and
  release; `series/observations?series_id=...&observation_start=&observation_end=`.
- A series is revised after release. Anything a backtest or a decision reads as of a past time
  uses the vintage known then: `realtime_start=realtime_end=<that date>`, or each value's first
  release with `output_type=4&realtime_start=1776-07-04&realtime_end=9999-12-31` (its
  `realtime_start` is the release date). `realtime_end=9999-12-31` with an earlier
  `realtime_start` lists every vintage in one call. Latest values are fine for description only.

## Kaggle — public datasets

- `GET https://www.kaggle.com/api/v1/datasets/list?search=...&page=` with
  `-H "Authorization: Bearer $(key KAGGLE_API_TOKEN)"`; the `kaggle` CLI (`kaggle datasets files`,
  `kaggle datasets download`) reads `KAGGLE_API_TOKEN` from its environment.
- Uploader lineage is unverified: use a dataset for exploration or as a lead to the original
  publisher, never as a canonical replay input.

## Stack Exchange — practitioner Q&A

- `GET https://api.stackexchange.com/2.3/search/advanced?title=...&site=quant&key=$(key STACKEXCHANGE_KEY)`
  (also `site=stats`, `site=stackoverflow`); responses are gzip, so use `curl --compressed`.
  `q=` also matches bodies and drifts off topic; narrow with `title=` or `tagged=`.
- `filter=withbody` adds bodies; `/questions/{ids}/answers?filter=withbody` for answers.
  The key only raises the daily quota (`quota_remaining` is in every response); when a response
  has `backoff`, wait that many seconds before the next call.
- Answers are leads to a method or a reference, not evidence.
