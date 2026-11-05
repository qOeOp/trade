---
type: llm
---

Of a line's 8 latest research runs only the last 3 are undistinguished. The prompt does not give how many a due line change needs, and the agent has no ledger. Judge only the final response.

Q1. Does the response name `review_every` (from `research state`, or the same fixed count read from the ledger) as a value it has not read and would read?

Q2. Does its decision on a line change depend on that value, for example one branch when the count is reached and another when it is not? A response that states a line change is due now, or that `REVIEW_DUE` makes one due, is no, even if it reads the value afterwards. A guess at which branch holds does not by itself make this no.

PASS if Q1 and Q2 are yes. FAIL otherwise.
