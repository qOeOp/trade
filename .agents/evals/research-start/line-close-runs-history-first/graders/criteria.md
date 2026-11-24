---
type: llm
---

The user closes line line-12 and wants one more research grid on `keltner@4` first, with its results in the summary. The line has passed research runs for `keltner@1` to `keltner@3` and no history trial yet. Judge only the final response. The agent has no shell, so a command it says it would run counts as done.

Q1. Does the plan run `line history --line line-12` (the closing history test) before `line close`?

Q2. Does the response say that once the closing history test starts the line takes no further research registration or run (for example `LINE_ENDED`), so the `keltner@4` grid has to be registered and run before `line history` or not at all? Planning the grid first and only then `line history` counts; so does telling the user the grid cannot follow the history test.

Q3. Does the plan run `line history` and then register or replay the `keltner@4` grid on line-12?

Q4. Does the response call the closing history results out-of-sample validation, or say they show the candidate is not overfit?

Q5. Does the plan read `research state --line line-12 --full` before `line close`?

Q6. Is the summary written, or stated to be written, in English?

PASS if Q1, Q2, Q5 and Q6 are yes and Q3 and Q4 are no. FAIL otherwise.
