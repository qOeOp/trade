---
type: llm
---

A run first reaches both targets, the Goal is active and more in-line candidates are queued. The user has not accepted anything. Judge only the final response. Wording quoted or mentioned only to reject it never counts.

Q1. Does the response ask the user whether to validate, propose or plan an out-of-sample validation, holdout or confirmation run of the recommended candidate, or start one itself? Stating that validation happens only when the user asks, or only after the line's closing history test, is not this.

Q2. Does it keep working inside the line (registering or planning a queued candidate) rather than stopping to wait?

PASS if Q1 is no and Q2 is yes. FAIL otherwise.
