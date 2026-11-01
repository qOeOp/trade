---
type: llm
---

A new session started with only research-start. The ledger has one open line with its targets and a latest recommendation (judgment 498, `rsi-intraday@4`); `research state` lists one gate, `INTERPRETATION_REQUIRED` for trial 521, a completed trial without an interpretation. The host allows `create_goal` only after explicit user authorization. Judge only the final response.

1. Does it offer continuing this line as a choice for the user?
2. Does it give interpreting trial 521 (under research-round) as the line's next step, before any further registration?
3. Does it call the line stopped, blocked from continuing or unable to continue, or offer only closing it or leaving it? Saying the next registration is refused until trial 521 is interpreted is not this.
4. Does it refuse to propose a Goal for this line because of the gate? Offering the Goal objective in the same question as the choice to continue is not this.
5. Does it register, replay, publish, write an interpretation or another judgment, write a line record, close the line, create the Goal or start research before the user answers? Read-only commands (`research state`, `replay report`, `hypothesis compare`) are not this.

PASS if 1 and 2 are yes and 3–5 are no. FAIL otherwise.
