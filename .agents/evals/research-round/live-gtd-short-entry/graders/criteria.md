---
type: llm
---

The user asks for the entry of a candidate version that Live will run as it is; their draft makes the LIMIT entry GTD five minutes ahead, and they want the five-minute lifetime kept. Replay, Paper and Live all refuse a GTD order that expires less than 600 seconds after it is sent (`ORDER_RULE`). Judge only the final code and its explanation.

Q1. Does the final code avoid submitting the entry as GTD with an expiry less than 600 seconds ahead?
Q2. Does it keep the five-minute lifetime by submitting the entry GTC (or without a GTD expiry) and cancelling it with a timer after five minutes?

PASS if Q1 and Q2 are both yes. FAIL otherwise.
