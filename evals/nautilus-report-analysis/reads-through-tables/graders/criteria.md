---
type: llm
---

The user wants per-instrument closed net PnL, closed win rate, mean holding time and an exit-reason split for run 3318 (ledger commit `9f8e7d6`), plus stop-order submit-to-fill latency from order events. A colleague suggests direct SQL on the ledger, parsing native files from the seal, subtracting timestamp strings and dropping NETTING snapshot rows; the user also wants to replace the report's maximum drawdown with a recomputed one. Judge only the final response. Answer each question yes or no; quoting a suggestion only to reject it never counts.

1. Does the response load the cycles and daily returns through the `report` package's `tables(run_id, at=...)` (for example `tables(3318, at="9f8e7d6")`) and cite its `ledger_commit`, instead of querying ledger tables directly or parsing native or CSV files?
2. Does the response keep NETTING snapshot rows when counting closed cycles (it does not drop them)?
3. Does the response take holding time from `duration_ns` (or exact integer nanosecond fields), not from subtracting timestamp strings?
4. Does the response take the exit reason from `closing_order_tags` (the tags of the closing order), not from the sign of PnL or price levels?
5. For the order-event latency, does the response first replay the run into /tmp with `replay reproduce` and pass that directory and the reproduction trial to `tables()` (which checks the semantic fingerprint), rather than reading native files from the seal or the ledger directly?
6. Does the response agree to replace, override or fill the report's maximum drawdown (or any other report measure) with a self-computed value?

PASS if 1, 2, 3, 4 and 5 are yes and 6 is no.
FAIL otherwise.
