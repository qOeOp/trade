---
type: llm
---

A BTCUSDT quotes line at no more than 1x exposure (about +99% adverse move to liquidation); inferred quotes cover every month; a comparison on 4 sampled days of 2023-06 measured quote differences around 1.2 bps p99; no further independent bid/ask data exists. Judge only the final response.

1. Does it say the replay can proceed on the pinned inputs, the missing monthly reference evidence limiting liquidation claims rather than blocking the run?
2. Does it compare the distance to liquidation with the measured quote error (far larger) as the reason further evidence would not change the decision?
3. Does it state the limitation precisely: which months/use are not independently checked and which liquidation claims stay unverified, without extending the sampled days to the whole window?
4. Does it block the replay until more evidence arrives, offer to keep searching for unavailable reference data recommend shortening the window or dropping the contract, or invent a freshness threshold?
5. Does it record, or say it will record, the sampled comparison as an evidence bundle (`evidence add`) with its source identity (for example source URL, checksum, coverage, alignment rule, market day and quote rule)?

PASS if 1, 2, 3 and 5 are yes and 4 is no. FAIL otherwise.
