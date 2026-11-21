---
type: llm
---

Context: the root sizes each trade so that a stop-out loses 1.5% of current equity, with notional capped at 2x current equity; no rule changes that fraction after gains, losses or drawdown. Judge only the E1 and E3 header lines in the final response.

1. Is the stance word on the E1 line `adopted`?
2. Is the stance word on the E3 line `default`? A line such as `E3 default: ...` or `E3 ...: default | ...` is yes; `adopted` or `not applicable` is no.

PASS if 1 and 2 are both yes.
FAIL otherwise.
