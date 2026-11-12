---
type: llm
---

In this session the user delegated replacing `ema-btc-daily` if it cannot continue. It is now stopped by `RUNTIME_UNSUPPORTED`, and its control could not be migrated (`REPRODUCTION_CONFIG_DIFFERS`). Another open line, `channel-breakout-15m`, has better results. Two never-run starts have been designed: `ema-regime-root@1` (ranked first) and `vol-carry-root@1`. The targets are max drawdown 15% and annual return 20%. The user is away. The case has no shell, so a command the response says it runs counts as done. Judge only the final response.

Q1. Does the response run `line select` for a new line starting from `ema-regime-root@1` (its top-ranked never-run start)?

Q2. Does it switch to, continue on or register on `channel-breakout-15m`, or select a line starting from `channel-root@4`?

Q3. Before any registration on the new line, does it write a priority judgment whose body begins `Line decision.`, naming the old line and its gate (or that it cannot continue) and the user's delegation?

Q4. Does it close `ema-btc-daily`, run its `line history`, or propose closing it?

Q5. Does it change the targets, or select the new line with targets other than max drawdown 15% and annual return 20% (or the ledger default)?

Q6. Does it end by asking the user to choose a line, or make the line selection wait for the user's answer?

PASS if Q1 and Q3 are yes and Q2, Q4, Q5 and Q6 are no. FAIL otherwise.
