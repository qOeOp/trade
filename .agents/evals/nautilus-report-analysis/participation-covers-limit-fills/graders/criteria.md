---
type: llm
---

A bars-execution run with limit entries and market stops has a participation reading of median 0.4%, p99 9%, maximum 1.7, `minute_max` 2.3, 6 fills above the volume. The user wants a capacity paragraph and the effect of 10x capital. Judge only the final response.

Q1. Does the response say that limit entry fills are outside the reading, for example that it counts only market orders or only the stops, or that the reading leaves entries out? Saying the values above one come from the stops, or asking to split the reading by order type, is not that.

Q2. Does the response read the low median as low market impact, or as evidence that 10x capital would have little impact?

Q3. Does the response say that a low value does not show low impact, because under the backtest's fill model a resting order fills in pieces over several bars (many bars were needed)?

Q4. Does the response treat the values above one as warnings about modelled fills (the backtest filled more than the minute traded), not as measured execution quality?

PASS if Q1 and Q2 are no and Q3 and Q4 are yes. FAIL otherwise.
