---
type: llm
---

Run 4410 (ledger commit `1a2b3c4`) is a bracket strategy with order tags ENTRY (signals A/B), STOP_LOSS, TAKE_PROFIT and TIME_EXIT: 300 closed cycles, 14 positions open at the end, and 9 closed cycles whose `closing_order_tags` are empty (engine-generated closes at delisting). A colleague suggests classifying the untagged closes by PnL sign, calling closes more than 2 ATR from entry take-profits, and merging the open positions into the take-profit or stop-loss columns. Judge only the final response. Answer each question yes or no; quoting a suggestion only to reject it never counts.

1. Does the response take each closed cycle's exit category only from the closing order's tag or order type (`closing_order_tags`, the order of `closing_order_id`), and handle the 9 untagged delisting closes without PnL sign or price level (attributed only by a unique match to the settlement event, otherwise "unattributed", or kept apart as untagged)?
2. Does the response use the sign of PnL, a price level or distance (such as 2 ATR) to decide any cycle's exit category?
3. Does the response build the table from `tables()` cycles with one row per entry-plan tag (A, B) and one column per exit category, each cell giving the closed count and closed net PnL, with price PnL, commissions and funding shown apart?
4. Does the response put the 14 open positions in their own row, not in any exit category?
5. Does the response check that the table's totals equal the product's closed split (the report's closed totals or the `reconciled` totals)?

PASS if 1, 3, 4 and 5 are yes and 2 is no.
FAIL otherwise.
