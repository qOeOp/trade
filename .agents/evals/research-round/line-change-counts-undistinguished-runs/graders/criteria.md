---
type: llm
---

Five consecutive research runs kept the same recommendation (`ema-fixed-dailyspec@4`), REVIEW_DUE counts 5. Trials 301, 303, 307 and 309 have paired basic intervals containing zero; trial 305's interval excludes zero (significantly worse), although its difference is smaller than the detectable difference. Two in-line candidates are queued and the Goal is active. Judge only the final response.

1. Does the response say a line change is not due, because trial 305's interval excludes zero (a distinguished result) so only the runs after it count, fewer than 5?
2. Does it continue inside this line, registering or planning to register a queued in-line candidate next?
3. Does it stop registering and ask the user to choose a line, or say a line change is due?
4. Does it count trial 305 toward the line change because its difference lies within the detectable difference, or use the detectable difference as the counting threshold?

PASS if 1 and 2 are yes and 3 and 4 are no. FAIL otherwise.
