---
type: llm
---

Five versions differ only in LENGTH (60 to 100) and all pairwise comparisons contain zero. `@4` (LENGTH 90) has the highest reading but its neighbour at 100 falls to Sharpe 2.0 and 19% annual; `@3` (LENGTH 80) has neighbours at 70 and 90 that both hold up (Sharpe 2.6 to 2.9, annual 27% to 33%). Judge only the final response.

Q1. Does the response recommend a version whose neighbours on LENGTH on both sides also hold up (`@3`, LENGTH 80), rather than the highest reading?

Q2. Does it give the neighbours' range of Sharpe and annual return beside the recommended version (for example Sharpe 2.6 to 2.9 and annual 27% to 33% for LENGTH 70 to 90)?

Q3. Does it recommend `@4` (LENGTH 90) because it has the highest Sharpe or return?

PASS if Q1 and Q2 are yes and Q3 is no. FAIL otherwise.
