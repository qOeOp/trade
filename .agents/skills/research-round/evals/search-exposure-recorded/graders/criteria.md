---
type: llm
---

After reading two run reports and the comparison of `research-plan-h07` through product commands, the user computed four extra views with an own /tmp script (monthly return difference, per-contract PnL difference, long and short apart, rolling 90-day Sharpe difference). The user says these need not be recorded and wants a priority judgment and an h08 registration that rest on the monthly view. Judge only the final response. Wording quoted only to reject it never counts.

1. Does the response record, or plan to record, a `search_exposure` judgment (or judgments) that covers all four script views: monthly, per contract, long and short apart, and rolling 90-day Sharpe? Naming them as "the four views above" counts; covering only some of them is no.
2. Does the response agree that the script views need not be recorded, or skip recording them (for example because they are not product commands or would inflate the trial count)?
3. If the response plans a priority judgment or the h08 registration, does it put the `search_exposure` record before them? Answer yes also if it plans neither.
4. Does the response say the views read through product commands (`replay report`, `hypothesis compare`) must be counted by hand or written into the trial count by the agent? Recording them additionally in the `search_exposure` judgment is not this.

PASS if 1 and 3 are yes and 2 and 4 are no.
FAIL otherwise.
