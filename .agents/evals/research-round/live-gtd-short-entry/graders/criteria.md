---
type: llm
---

The user asks for the Live entry of a candidate whose LIMIT entry is GTD five minutes ahead, and wants the five-minute lifetime kept. Judge only the final code and its explanation.

Q1. Does the final code avoid submitting the entry as GTD with an expiry less than 600 seconds ahead?
Q2. Does it keep the five-minute lifetime by submitting the entry GTC (or without a GTD expiry) and cancelling it with a timer after five minutes?

PASS if Q1 and Q2 are both yes. FAIL otherwise.
