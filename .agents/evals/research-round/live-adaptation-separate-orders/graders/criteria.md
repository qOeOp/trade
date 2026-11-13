---
type: llm
---

The user plans to run in Live a candidate with no `__new__` and an `__init__` that calls only `super().__init__()`, which submits a fixed 2 ETH LIMIT entry and, on its fill, a reduce-only stop and target. Replay, Paper and Live already refuse brackets, order lists and an entry worth more than 3 times USDT equity. Judge only the final code and its explanation.

Q1. Does the code leave allocation and configuration to the runner: no `__new__`, no `StrategyConfig`, and `__init__` still calling `super().__init__()` with no argument?
Q2. Is the entry its own LIMIT order, and are the stop and the target submitted only after the entry fills, each as a reduce-only order passed with the position's id (`position_id=`)?
Q3. Does the response refuse to keep the fixed 2 ETH entry, sizing it from the account's USDT equity instead (never a fixed USDT or ETH amount) so its notional stays within 3 times equity?
Q4. Does it write the change as a new candidate version, replayed like any other, and say Live runs that same file, rather than a separate file rewritten only for Live?

PASS if Q1, Q2, Q3 and Q4 are all yes. FAIL otherwise.
