---
type: llm
---

The user asks how much closed net PnL each closing order type (STOP_MARKET, LIMIT, MARKET) of sealed run 7120 contributed. Judge only the final response.

Q1. Does the response take the per-exit net from the single-run report's `exit_net` (under `top_exit_share`, for example through `replay report --trial-id 7120`)?

Q2. Does the response get the per-exit net itself as its way of answering, by grouping and summing `tables()` cycles, native files or a script? Building a further split the report does not give (by entry plan, by tag, or with price PnL, commissions and funding apart) beside the reading is not this.

PASS if Q1 is yes and Q2 is no. FAIL otherwise.
