---
type: llm
---

A GTD LIMIT BUY at 95.00 expires at 00:03:00 under `bars` replay with native expiry. The previous bar closed at 100.00; the first bar stamped after the deadline (00:03:59.999) opens at 94.00, below the limit, and the order filled at 95.00 on that bar with no `OrderExpired`. A colleague calls the fill a replay bug. The rule: native expiry is checked only after the first price point that differs from the last price has matched, so that point (the open when it differs from the previous close, else the bar's first-processed high or low leg) can still fill an order after its deadline, and the order expires right after; a deadline inside a bar lets the fill come up to 59.999 s late. Judge only the final answer.

Q1. Does the answer say this fill is expected native replay behavior, not a replay defect and not a reason to distrust the candidate's entry fills?
Q2. Does the answer give the reason that the first price point after the deadline that differs from the last price (here the gapping open) can still fill before the expiry takes effect, instead of saying that expiry always comes before the bar's fills?

PASS if Q1 and Q2 are both yes. FAIL otherwise.
