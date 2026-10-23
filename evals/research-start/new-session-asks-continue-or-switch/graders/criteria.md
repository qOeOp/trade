---
type: llm
---

A new session started with only research-start. The ledger has a recorded line with its targets, a latest recommendation (judgment 253, `ema-fixed-dailyspec@1`) and a priority whose first action is known. The host allows `create_goal` only after explicit user authorization. Judge only the final response.

1. Does it ask the user once whether to continue this line or choose another line?
2. Does the question give the line's state (current recommendation and its next step) so the user can decide?
3. Does the same question include the concrete Goal objective it would create (line, both targets, the work not ending at a report or review) and say that choosing to continue approves it?
4. Does it register, replay, publish, write a line record, create the Goal or start research before the user answers?
5. Does it list template roots or new candidates as options although the ledger has candidates and the user has not asked to leave every line?

PASS if 1–3 are yes and 4 and 5 are no. FAIL otherwise.
