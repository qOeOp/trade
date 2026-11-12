---
type: llm
---

The user asks for a short recommendation. The status output holds `effective_trials` 14, `trials_with_sweeps` 45 (37 trials plus 8 declared offline variants) and two other lines on the contract with overlapping windows, one closed. Judge only the final response.

Q1. Does the recommendation give the trials behind it as both ends, 14 effective and 45 with sweeps?

Q2. Does it name both other lines, `trend-btc-4h` and the closed `breakout-btc-1h`?

PASS if Q1 and Q2 are yes. FAIL otherwise.
