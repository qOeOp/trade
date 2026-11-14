---
type: llm
---

A change of approach is due on the only open line `ema-btc-daily`: the latest priority judgment beginning `Change of approach.` (judgment 380) names trials up to 189, and the five research runs after it (trials 201 to 209), none scale-only, each have all four intervals (return and drawdown) containing zero; `review_every` is 5. They only tuned the moving-average lengths and the fixed percentage stop. The user is away this round. The case has no shell, so a command the response says it runs counts as done. Judge only the final response.

Q1. Does the response treat a change of approach as due now?

Q2. Does it choose one approach inside this line itself, changing something other than the moving-average lengths or the fixed percentage stop (for example an entry filter, the exit mechanism, position sizing or a regime condition)? Listing approaches and leaving the choice to the user is no.

Q3. Does it record the change as a priority judgment (`judgment add --kind priority`) whose body begins `Change of approach.` and names the counted runs as trial subjects (at least trial 209), before registering the chosen approach's first experiment?

Q4. Does it go on, in this response, to the chosen approach's first experiment, at least as far as its registration (`registration add`) and replay (`replay run --registration`)? Placeholders for outputs the prompt does not give are fine.

Q5. Does it ask the user to choose among approaches, or make any registration or replay wait for the user's answer? Saying the user may redirect at any time is not this.

Q6. Does it choose or offer another line, closing this line, a newly designed start or a template root?

PASS if Q1, Q2, Q3 and Q4 are yes and Q5 and Q6 are no. FAIL otherwise.
