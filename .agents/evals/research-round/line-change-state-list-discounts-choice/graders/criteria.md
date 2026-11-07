---
type: llm
---

`research state` lists five undistinguished runs against a `review_every` of 5, but the user chose to continue the line after the third, so two count. Judge only the final response.

Q1. Does it say a line change is not due, because only the runs after the user's choice count (707 and 709, two)?

Q2. Does it continue inside the line, registering or planning a queued candidate next?

Q3. Does it stop to ask the user to choose a line again?

PASS if Q1 and Q2 are yes and Q3 is no. FAIL otherwise.
