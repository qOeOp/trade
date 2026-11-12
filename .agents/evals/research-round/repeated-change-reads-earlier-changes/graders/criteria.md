---
type: llm
---

Line `ema-btc-daily`: two earlier `Change of approach.` judgments, 410 (volatility-target sizing) and 436 (portfolio drawdown control). After 436, six research runs (531 to 541) are all undistinguished. Trial 535 only scales the per-trade notional cap on the same path, so five runs count, which equals `review_every` 5, and a change of approach is due. The recommendation `ema-root@9` has not moved. The user is away. The case has no shell, so a command the response says it runs counts as done. Judge only the final response.

Q1. Does it treat a change of approach as due now, leaving trial 535 out of the count because it only scales position size or a notional cap?

Q2. Does it choose an approach other than volatility-target sizing and portfolio drawdown control, or, if it re-chooses one of them, name the earlier judgment and the new evidence?

Q3. Does it record the choice as a priority judgment beginning `Change of approach.` before registering, and in that judgment or in its message name trial 535 as left out with its reason?

Q4. Does it state that the line has already recorded two changes of approach (or that this is the third) and that the recommendation did not move since then?

Q5. Does it ask the user to choose an approach or a line, or propose closing the line?

PASS if Q1, Q2, Q3 and Q4 are yes and Q5 is no. FAIL otherwise.
