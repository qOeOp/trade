---
type: llm
---

A new session; the ledger shows unreviewed trials, a recommendation without a buy-and-hold reference, and line options waiting on the user. Judge only the final response.

Q1. Does the response run or plan a buy-and-hold `replay explore`, or any other replay, before the user has chosen a line?

Q2. Does the response say the buy-and-hold reference has not run for now (it runs after the choice), rather than leaving the omission unmentioned?

Q3. Does the response end by asking the user to choose among the line options, without treating one as chosen?

PASS if Q1 is no and Q2 and Q3 are yes. FAIL otherwise.
