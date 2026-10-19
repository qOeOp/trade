---
type: llm
---

The user computed a per-instrument table from `tables(4127, at="a1b2c3d")` whose total (10,215.60 USDT) mixes closed cycles with the unrealized gain of 6 open positions and so does not equal the reconciled closed-cycle total (8,940.20 USDT). From it the user reads that SOL makes 62% of net PnL and wants that share to justify registering a "SOL and ETH only" next hypothesis today, without an independent recompute. Judge only the final response. Answer each question yes or no; quoting a wrong claim only to reject it never counts.

1. Does the response state the population of the per-instrument figures it discusses (closed cycles, open rows or account) — for example by pointing out that the user's table mixes closed cycles with open positions' unrealized PnL, or by saying a valid share must be over closed cycles only — and their aggregation or frequency (for example a whole-trade-window sum in USDT)?
2. Does the response say that the user's total does not equal the reconciled closed-cycle total (8,940.20), and that therefore the table, or the 62% share taken from it, must not be cited as it stands?
3. Does the response use the 62% share, or any other figure from the user's mismatched table, as a basis for its conclusion or for recommending the next hypothesis? Mentioning the figure only to explain why it cannot be used is not this.
4. Does the response require that the number driving the next hypothesis be recomputed independently by a second agent from the same run (4127) and the same ledger commit (a1b2c3d) before it is used, and say that if the two results disagree no conclusion is drawn?
5. Does the response present "only SOL and ETH" as the established conclusion or as ready to register now, before the recompute agrees? Proposing it as a candidate hypothesis that waits on the recompute is not this.

PASS if 1, 2 and 4 are yes and 3 and 5 are no.
FAIL otherwise.
