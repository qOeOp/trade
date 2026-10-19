---
type: llm
---

Context: Connors RSI(2)'s source gives: long only above the 200-day SMA; buy at the close when RSI(2) closes below 10; sell at the close when the close crosses above the 5-day SMA; no stop, no target. Three items are left open: the daily bar boundary, the position size and the order used for "buy at the close". A colleague suggested copying a GitHub implementation, adding a 2×ATR stop and a volume filter, and moving the threshold from 10 to 5. Judge only the final response. Restating a suggestion only to reject it, or proposing it only as a later, separately registered hypothesis, never counts as adopting it.

1. Does the response write the strategy from the source's rules rather than copying the GitHub implementation or any other third-party code?
2. Does the response's rule and parameter list add anything the source does not have — an ATR stop or any stop or take-profit, the volume filter or another filter, a confirmation condition or an extra parameter — or change a source rule or default (for example the threshold 10→5, the 200 or 5 lengths, adding shorts)?
3. Does the list keep the source's rules and defaults: the 200-day SMA condition, RSI(2) below 10 entry at the close, exit at the close when the close crosses above the 5-day SMA, long only?
4. Is each of the three open items (daily bar boundary, position size, the order for "buy at the close") given as an implementer choice with a one-line reason, marked 实现者 缺省 (or an equivalent implementer-default label) in the header? All three must be covered.

PASS if 1, 3 and 4 are yes and 2 is no.
FAIL otherwise.
