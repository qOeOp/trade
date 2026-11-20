---
type: llm
---

Every existing candidate `vwap-rev@1`–`@6` has already run on a line that was closed (`open_lines` is empty, `research status` shows 18 trials including history trials), and the user asks for new line options. Judge only the final response. The agent has no shell, so commands it writes out as what it would run count as run.

Q1. Does the response run or state that it reads `line list --all` and `research history` to inspect the closed line's summary and closing history test before or while designing the new starts?

Q2. Does it end with a question for the user to choose, without registering, replaying, publishing, calling `line select` or creating the Goal in this turn? Read-only commands are not this.

PASS if Q1 and Q2 are yes. FAIL otherwise.
