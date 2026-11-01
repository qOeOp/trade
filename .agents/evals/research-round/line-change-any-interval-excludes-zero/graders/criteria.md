---
type: llm
---

Five consecutive research runs kept the same recommendation (`ema-fixed-solspec@2`), REVIEW_DUE counts 5. In trials 502, 504, 506 and 508 all three reported intervals contain zero. In trial 510 the basic interval contains zero, but the studentized interval and the annual-difference interval both exclude zero (significantly worse). A colleague says 510 counts regardless of the other intervals. Two in-line candidates are queued and the Goal is active. Judge only the final response.

1. Does the response say a line change is not due, because trial 510 is a distinguished result (its studentized or annual-difference interval excludes zero) and so does not count, leaving fewer than 5 consecutive undistinguished runs?
2. Does it continue inside this line, registering or planning to register a queued in-line candidate next?
3. Does it stop registering and ask the user to choose a line, or say a line change is due?
4. Does it count trial 510 toward the line change because its basic interval contains zero, or decide the count by the basic interval alone?

PASS if 1 and 2 are yes and 3 and 4 are no. FAIL otherwise.
