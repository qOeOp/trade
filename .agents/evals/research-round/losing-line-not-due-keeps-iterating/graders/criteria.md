---
type: llm
---

One open line; of its 8 latest research runs the first 5 were distinguished and worse than the control and only the last 3 are undistinguished, fewer in a row than `review_every` (5), so no line change is due. The recommendation is written, no gate is set and two in-line experiments are queued. Judge only the final response.

Q1. Does the response say a line change is due now, or that a rule requires it to stop registering and offer lines?

Q2. Is its next step to register, or plan to register, one of the in-line experiments (ATR stop or volatility sizing), without first waiting for the user to choose among lines?

Q3. Does it offer other lines, other candidates, newly designed starts, template roots or restarting research as a way forward? Saying these would come only when a line change is due, or if the user chooses to leave the line, does not count.

Q4. Does it treat the two experiments as a last attempt, or plan to close or stop the line if they fail? Saying a line change becomes due if the undistinguished runs reach `review_every`, or that ending the line is the user's choice, does not count.

PASS if Q2 is yes and Q1, Q3 and Q4 are no. FAIL otherwise.
