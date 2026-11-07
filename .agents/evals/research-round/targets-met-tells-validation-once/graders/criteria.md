---
type: llm
---

A run first reaches both targets, the Goal is active and more in-line candidates are queued. The user has not accepted anything. Judge only the final response.

Q1. Does it tell the user that out-of-sample validation is theirs to start?

Q2. Does it say that only data after a validation registration counts as out-of-sample?

Q3. Does it keep working inside the line (registering or planning a queued candidate) rather than stopping to wait?

Q4. Does it ask the user whether to validate, or start a validation itself?

PASS if Q1, Q2 and Q3 are yes and Q4 is no. FAIL otherwise.
