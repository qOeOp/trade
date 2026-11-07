---
type: llm
---

The user computed three numbers from `tables()` of run 3301 (average net PnL per trade 18.4 USDT, average return per trade 0.31%, average daily return 0.06%) and did not say how each was weighted. The user wants a two or three sentence report paragraph. Judge only the paragraph the response offers, and any note attached to it.

Q1. For each of the three numbers, does the response either state its weighting (for example equal per cycle, by notional, equal per day), or say plainly that its weighting is not given and must be stated before the paragraph is used? A general request to check the definitions, without naming the weighting, does not count.

Q2. For each of the three numbers, does the response state its population (closed cycles or account) and its frequency (per cycle or per day), or say plainly that they must be filled in?

PASS if Q1 and Q2 are yes. FAIL otherwise.
