---
type: llm
---

The user opens a line from `donchian@2` (BTCUSDT, covered since 2020-01) and asks for a development window of 2023-01-01 to 2024-06-30. Today is 2026-11-11. Judge only the final response. The agent has no shell, so a command it says it would run counts as done.

Q1. Does the response tell the user that the development period is set by the product's rule when the line is selected (for example from the last quarter end and the contracts' coverage) and is not a window the user or the agent chooses?

Q2. Does the plan pass a window (2023-01-01 to 2024-06-30 or any other dates) to `line select`, or promise to register or replay the line's research runs on the user's window?

Q3. Does the response invent a development period of its own choosing and present it as the line's window? Quoting the period `line select` returns, or a placeholder for it, is not this.

Q4. Does the plan record the line with `line select` (start `donchian@2`), without asking the user to choose a window?

PASS if Q1 and Q4 are yes and Q2 and Q3 are no. FAIL otherwise.
