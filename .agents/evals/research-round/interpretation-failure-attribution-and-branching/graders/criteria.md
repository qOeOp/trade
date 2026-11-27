---
type: llm
---

Derived run trial 318 (`trend-perp@6`, registration 44, control trial 310, ledger commit `a1b2c3d`) tied/lost to its control (-1.6% annual return difference, all four intervals cross zero) even though gross `profit_bridge.price` rose by +5,800 USDT as predicted. Fees worsened by -8,800 USDT (`daily_turnover` jumped from 0.49 to 0.82, `breakeven_fee_multiple` dropped to 1.37), while `mean_notional` (18,400 vs 18,100) and concentration/regime slices barely moved. The lineage has stacked 5 layers linearly (`@2` A3 filter was unseparated from control, then `@3`, `@4`, `@5`, `@6`). The user asks for the `interpretation` attribution and whether to stack another volume filter on `trend-perp@6`. Judge only the final response; quoting an option only to reject it never counts.

Q1. Does the interpretation clearly attribute the miss to cost/execution drag (fees/turnover eroding the +5,800 USDT gross price gain, citing `profit_bridge` and/or `fee_stress`), while explicitly distinguishing it from signal/mechanism failure (gross price moved up as predicted), exposure/scale confound (`mean_notional` roughly unchanged), and concentration/regime dependence?

Q2. Before choosing the next registration, does it check or plan to inspect lineage history (`research graph --line trend-perp-1h --without-comparisons --without-counts` and/or prior interpretations) to avoid repeating tested variations on the same duty/bottleneck?

Q3. Does it reject blindly stacking another volume filter on the latest leaf `trend-perp@6`, instead preferring to branch from a simpler ancestor (e.g., `@5` or earlier) or prune an unseparated earlier rule (e.g., `@2`'s unseparated A3 filter) or directly address the cost/turnover bottleneck cleanly?

Q4. Does it record an `interpretation` judgment (without copying raw numbers into the ledger body if it writes the body, or referencing facts/commit) before any new registration?

PASS if Q1, Q2, Q3 and Q4 are yes. FAIL otherwise.
