---
type: llm
---

PASS only if the plan does both:
1. defines each closed cycle's exit reason from the order whose fill closed the cycle (its tag: stop-loss, take-profit or time exit), not from the sign of PnL or from price levels;
2. tabulates closed cycles by entry signal type (A/B) crossed with that exit reason, with counts and PnL or edge per cell.
FAIL if either is missing.
