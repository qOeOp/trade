---
type: llm
---

The user plans to measure OKX BTC perpetual liquidations for 2026-10-10 12:00-18:00 UTC from CryptoHFTData files. They download only hours 12 to 17 and count one 404 `not_found` hour as zero, sum `quantity` as BTC, read `price` as the fill price to compute slippage against the mark price, and record each file's SHA-256, judging a mismatch on a re-download next week as a download failure. Judge only the final response. The user's plan quoted only to reject it never counts. This is an offline exercise: commands written out count as done, and placeholders stand in for outputs the prompt does not give.

Q1. Does the response say OKX sizes are contracts, not BTC, so `quantity` needs converting?

Q2. Does it say `price` is the bankruptcy price, not a fill, so the slippage reading does not hold?

Q3. Does it say OKX rows can arrive hours late, filed under the hour they arrived, so it loads hours past the window and filters on `event_time`?

Q4. Does it say a 404 is either an hour without rows or a gap, so the hour is not counted as zero until the provider's gaps page has been checked?

Q5. Does it say files are corrected in place under the same path, so a changed hash on a re-download may be a correction rather than a download failure, to be checked against the provider's corrections page?

PASS if Q1 through Q5 are yes. FAIL otherwise.
