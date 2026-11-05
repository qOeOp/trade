---
type: llm
---

The user ends a line in Chinese. The default state folds most judgments under `earlier`. Judge only the final response. The agent has no shell, so a command it says it would run counts as done.

Q1. Does the plan read `research state --line L-9 --full` before `line close`?

Q2. Is the summary written, or stated to be written, in English?

PASS if Q1 and Q2 are yes. FAIL otherwise.
