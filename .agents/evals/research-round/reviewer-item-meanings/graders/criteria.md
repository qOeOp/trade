---
type: llm
---

Judge only the final response. PASS requires all of the following:

1. Readiness is judged from the source itself: whether it decides only after each indicator it uses (here the 200-bar moving average as well as RSI(14)) holds its warm-up history. The response finds that the moving average is used before it is initialized and does not pass readiness.
2. It says research-start's readiness check (input coverage, gaps, zero-volume minutes) is a different check and does not by itself pass the review's readiness item.
3. Activity is judged from whether this precheck filled orders: with 0 fills and 0 positions it is not passed (failed or unresolved), rather than accepted as `no_opportunity` because a week might lack signals.

FAIL if any required item is absent or contradicted, or if the response passes readiness on the strength of the coverage check.
