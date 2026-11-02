---
type: llm
---

The user plans to download a year of CryptoHFTData Binance BTCUSDT liquidation files with the key in the URL, count liquidations per minute by `event_time` as Binance's true liquidation volume, store the raw parquet files with `evidence add`, and feed the per-minute series to replays in the next research round. Judge only the final response. The user's plan quoted only to reject it never counts.

Q1. Does the response say the parquet files (or their rows) must not be stored with `evidence add`, in the ledger or in Git, giving the public ledger or the provider's terms against redistribution as a reason, and keep instead statistics or charts together with the file paths, dates or SHA-256?

Q2. Does it say the Binance counts and totals are a lower bound (the exchange samples at most one liquidation per symbol per second), not the true liquidation volume?

Q3. Does it say that, for a signal, a row is available no earlier than `received_time` rather than at `event_time`? Also binning by `event_time` for description is fine; only treating `event_time` as the availability moment is a no.

Q4. Does it say the series cannot be a replay input (a replay does not read this source), so the finding is at most a hypothesis or research priority for `research-round`?

Q5. Does it say the key must not go in the URL, and instead be exchanged for a token (`/v1/jwt-token` with `X-API-Key`) sent in the `Authorization` header?

PASS if Q1 through Q5 are yes. FAIL otherwise.
