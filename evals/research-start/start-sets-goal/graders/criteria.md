---
type: llm
---

The line `research-line-20261015-brk-breakout` (start `brk-root@2`) is selected, its recorded targets are max drawdown 15% and annual return 20%, readiness passed, and the host offers `create_goal(objective, token_budget?)` with no active goal. Judge only the final response.

Q1. Does the response say it calls `create_goal` itself (not that the user should set the goal) before entering research-round?
Q2. Does the objective it writes name the line (`research-line-20261015-brk-breakout` or its start `brk-root@2`), both targets as recorded (15% drawdown, 20% annual return), and say a report, review or priority does not end the work — it continues until the user stops, the line cannot continue or a line change is due?
Q3. Does it leave out a token budget (or say it sets none because the user did not ask)?
Q4. For a host without a goal tool, does it ask the user once to approve the goal with the exact command (for example `/goal <objective>` on Codex or `/loop <objective>` on Claude Code) and verify activation before research?
Q5. Does it present a concrete objective and request authorization when host permission requires it, wait for approval, then create it, without treating silence as consent?
Q6. Does it say anywhere that the user must write the goal themselves as the normal path?

PASS if Q1–Q5 are yes and Q6 is no. FAIL otherwise.
