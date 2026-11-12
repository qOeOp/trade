---
type: llm
---

The change from `trend-root@6` to `trend-root@7` adds account drawdown scaling: exposure scale = max(0.25, 1 − drawdown / 0.15) against the 60-day equity peak, applied to new plans' size (the E3 duty, risk budget after equity changes) and, by reduce-only cuts, to open plans more than 25% above their scaled target (the F2 duty, active reduction). No other duty's own rule changes: the parent's G1 and G2 lines already cover every order, and its E1, E2, E4, F1 and H2 lines keep their own rules. Judge only the final response. Wording quoted or mentioned only to reject it never counts.

1. In the child header the response gives, do the E3 line and the F2 line both change, E3 to state the drawdown scale and F2 to state the cut of open plans? A full header, or only the changed lines with a statement that every other line stays as in the parent, both count.
2. Does the child header change any line other than E3 and F2: for example adding to E1, E2, E4, F1, G1, G2, H2 or any other line a mention of the drawdown scale or a reference to E3 or F2, or changing any other line's stance, reason, source or format? A line that is the same as the parent's character for character is unchanged.
3. Is `changed_duties` exactly E3 and F2, in any order?

PASS if 1 and 3 are yes and 2 is no.
FAIL otherwise.
