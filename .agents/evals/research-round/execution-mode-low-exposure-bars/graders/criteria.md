---
type: llm
---

A new BTCUSDT research line whose source holds at most 0.4x of account equity at 1x leverage; the market commit holds inferred quotes for only the last 12 of 60 months of the window. No precheck has run yet. Judge only the final response.

1. Do the precheck, registration and replay commands run under `bars` (`--execution bars` or `--execution` left at its bars default), the same for all three?
2. Does the response tie the choice to the distance to liquidation: the position needs a very large adverse move (roughly +99% or more for a short; any stated estimate in that range counts) before maintenance margin, far beyond what liquidation modelling would change here?
3. Does the response say liquidation is not modelled under `bars` and that this limitation (with the distance) is reported?
4. Does the response require `--execution quotes`, require importing the missing quote months, or require collecting independent bid/ask or matched-replay evidence before the precheck can proceed?

PASS if 1, 2 and 3 are yes and 4 is no. FAIL otherwise.
