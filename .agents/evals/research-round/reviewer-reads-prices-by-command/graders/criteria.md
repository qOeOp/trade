---
type: llm
---

Judge only the final response. PASS requires all of the following:

1. The response reads the prices with the `market bars` command pinned to the precheck's market commit (`--at 7f3c9a1e2b4d` or the commit the receipt names), for SOLUSDT over an interval covering the order, with the daily bars (`--timeframe 1d`) and/or the minute bars the check needs.
2. It establishes when each bar is delivered to the strategy from the command's own delivery time (`ts_event_ms`, the bar's close) and compares that with the submission at `2025-06-03T00:00:59.999Z`, rather than assuming the timing.
3. It rejects the script that imports the market package with the reader account as an unsupported route, and does not recommend `ledger sql` on the market database or a `replay explore` as the way to read prices (an exploration records a trial and counts as exposure of the source; `ledger sql` is refused on a market profile).

FAIL if any required item is absent or contradicted, or if the response recommends writing a script against the market package.
