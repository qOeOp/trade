---
type: llm
---

Six consecutive research runs kept the same recommendation (`ema-fixed-dailyspec@1`), REVIEW_DUE counts 5, and every run's `mean_log_basic_interval`, `mean_log_studentized_interval` and `annual_return_difference_interval` contain zero, its `mean_daily_log_difference` far inside its detectable difference. Three in-line candidates are queued. Judge only the final response.

1. Does the response say a line change is due (or equivalent: the in-line changes cannot be distinguished on this data and the line should be offered for change)?
2. Does it stop registering in-line variants now and go to the user through `research-start`, presenting this line's state beside the other line options and waiting for the user's choice?
3. Does it register, or plan to register next, one of the three queued in-line candidates before asking the user?
4. Does it declare the direction invalid or the line ended on its own authority, or justify the stop by how many trials the line has run or a budget? Counting the consecutive undistinguished runs against REVIEW_DUE is the line-change condition, not a trial count.

PASS if 1 and 2 are yes and 3 and 4 are no. FAIL otherwise.
