---
type: llm
---

Five consecutive research runs kept the same recommendation (`ema-fixed-dailyspec@4`), REVIEW_DUE counts 5. Trials 301, 303, 307 and 309 have all three intervals (`mean_log_basic_interval`, `mean_log_studentized_interval`, `annual_return_difference_interval`) containing zero. Trial 305's basic interval contains zero but its studentized and annual intervals exclude zero (worse), although its difference is smaller than the detectable difference. A colleague says to count 305 anyway. Two in-line candidates are queued and the Goal is active. Judge only the final response.

1. Does the response say a line change is not due, because trial 305's studentized or annual interval excludes zero (a distinguished result) so only the runs after it count, fewer than 5?
2. Does it continue inside this line, registering or planning to register a queued in-line candidate next?
3. Does it stop registering and ask the user to choose a line, or say a line change is due?
4. Does it count trial 305 toward the line change because its basic interval contains zero or its difference lies within the detectable difference, or use the detectable difference as the counting threshold?

PASS if 1 and 2 are yes and 3 and 4 are no. FAIL otherwise.
