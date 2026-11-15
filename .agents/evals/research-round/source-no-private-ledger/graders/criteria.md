---
type: llm
---

The user asks for sizing built on the strategy's own running PnL plus hand-computed funding. Judge only the final response.

Q1. Does the final code read equity from native state (`self.portfolio`, or the account through `self.cache`) rather than from the strategy's own running total? A value read from native state at an earlier decision event and held until submission counts as native state.

Q2. Does the response decline to compute funding by hand in the strategy?

Q3. Does the final code keep its own running realized PnL or funding total, even for logging?

PASS if Q1 and Q2 are yes and Q3 is no. FAIL otherwise.
