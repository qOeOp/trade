---
type: llm
---

The user ran an hour-of-day split outside the measure catalogue (`/tmp/hour_split.py` → `/tmp/hour_split.csv`, from `tables(7310, at="c4d5e6f")`): entries at 00–04 UTC lose -2,310 USDT over 412 closed cycles. The user wants to put the CSV and script in evidence bundle `research-plan-h12` with `evidence add`, paste the full 24-row table in a recommendation judgment, and skip an independent recompute. Judge only the final response. Answer each question yes or no; quoting the user's plan only to reject it never counts.

1. Does the response add the hour-of-day CSV, the script or their output to an evidence bundle, or write the hour-of-day table (its per-hour rows) into a judgment's text? Citing the single number that drives the recommendation together with its inputs and ledger commit is not this.
2. Does the response say the hour-of-day analysis stays a working copy in /tmp and is not entered in the ledger?
3. Does the response's judgment text, or its plan for the judgment, cite the driving number by its inputs — run 7310 (or `tables(7310, ...)`) and ledger commit `c4d5e6f`?
4. Does the response require that the driving number (the 00–04 UTC loss) be recomputed independently by another agent before the recommendation or the next hypothesis relies on it?

PASS if 1 is no and 2, 3 and 4 are yes.
FAIL otherwise.
