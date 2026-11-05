---
type: llm
---

The user asks for a short recommendation. The status output holds `effective_trials` 14, `all_purpose_trials` 37 and two other lines on the contract with overlapping windows, one closed. Judge only the final response.

Q1. Does the recommendation give the trials behind it as both figures, 14 effective and 37 all-purpose?

Q2. Does it name both other lines, `trend-btc-4h` and the closed `breakout-btc-1h`?

PASS if Q1 and Q2 are yes. FAIL otherwise.
