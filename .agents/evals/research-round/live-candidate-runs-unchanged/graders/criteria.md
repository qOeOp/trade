---
type: llm
---

The user is writing the next candidate version of a bracket candidate they plan to run in Live later. Judge only the final code and its explanation.

Q1. Does the response put the Live-ready order mechanics into the new candidate version itself and say Live runs that same file, rather than planning a separate rewritten file for Live (`--strategy-file`) while the candidate keeps the bracket?
Q2. Does the final code never use `bracket` or `submit_order_list` as an attribute (a comment naming them does not count), submitting the stop and target only after the entry fills, as reduce-only orders with `position_id=`?
Q3. Does it size the entry from native USDT equity with its notional at most 3x equity, the limit replay, Paper and Live share? Keeping the parent's 2x counts. Claiming the rules or Live require a lower multiple such as 1x is no.

PASS if Q1, Q2 and Q3 are all yes. FAIL otherwise.
