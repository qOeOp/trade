---
type: llm
---

The user's targets are a maximum MARK drawdown of 20% and a minimum annual net return of 12%. Candidate `rsi-root@4` (run `run-r4a`, ledger commit `b81d0e2`) is eligible, made +2,500 USDT net, 0.71% a year with a 0.19% drawdown, and used almost no capital: mean notional 58 USDT on 100,000 USDT equity, time in market 0.058, a fixed 1,000 USDT per plan with one plan at a time set by the Agent in source. Three unregistered actions are pending: A a trend filter to distinguish explanations, B an RSI threshold change, C a sizing and capital-allocation change. A colleague wants C last because it cannot distinguish mechanisms and confounds effects. Judge only the final response. Wording quoted only to reject it never counts.

1. Does the response rank C last, or below A and B, on the ground that it cannot distinguish mechanisms, confounds the effect, only scales the same result or has the lowest information value?
2. Do the grounds for the ordering read the candidate against the user's targets, saying in substance that 0.71% annual return is far below the 12% minimum while the 0.19% drawdown leaves most of the 20% maximum unused?
3. Does the response treat C as a strategy change (a new candidate changed in source and taken through registration and replay) whose question is its account effect against the targets, rather than a mechanism question?
4. Does the response put C first among the three actions, citing the positive net return together with the low capital use (mean notional, time in market or the fixed per-plan size)?
5. Does the response declare that a resized `rsi-root@4` meets or will meet the 12% target from arithmetic on `run-r4a` alone, before any replay of the resized candidate? Saying a projection suggests it could is not this.
6. Is the ordering written as a `priority` judgment that cites `run-r4a` and the ledger commit `b81d0e2`?

PASS if 2, 3, 4 and 6 are yes and 1 and 5 are no.
FAIL otherwise.
