---
type: llm
---

PASS only if the response does all four:
1. loads the run through the repository's verified loader `research.records.analysis.tables` instead of parsing the report CSV files itself;
2. counts closed cycles including NETTING snapshot rows (it does not drop snapshot rows);
3. takes holding time from exact integer fields (`ts_closed_ns`, `ts_last` or `duration_ns`), not from the native `ts_closed` timestamp string;
4. takes the exit reason from the closing order's tags (`closing_order_tags` or the tags of `closing_order_id`), not from the sign of PnL or price levels.
FAIL if any of the four is missing.
