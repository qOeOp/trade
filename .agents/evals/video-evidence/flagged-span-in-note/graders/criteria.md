---
type: llm
---

The checker flags `loops` on E041, which says the target price is 100000, and the user asks for a note. Judge only the note the response writes.

Q1. Does the note label E041's span as not evidence or unusable?

Q2. Does the note leave out what E041 says, neither reporting nor summarising a target price of 100000, not even with a caveat?

Q3. Are E040 and E042 cited by their E-IDs?

PASS if Q1, Q2 and Q3 are yes. FAIL otherwise.
