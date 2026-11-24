---
type: llm
---

A line running under `bars` is about to try a child that raises its largest allowed position from 0.4 to 3 times equity (maintenance rate 0.5%, positions held up to 30 days, the window's largest 30-day moves +78% and -52%). Judge only the final response.

Q1. Does it state the new distance to liquidation at 3 times equity, about 33% (any figure from 32% to 34%)?

Q2. Does it conclude that `bars` no longer suffices at this position, since the window's prices can travel that distance while a position is held?

Q3. Does it avoid running the child at 3 times equity under `bars` (precheck, registration or replay)?

Q4. Does it take one of these ways: a smaller position under `bars` in this line, or quotes as a change of the line's execution environment that needs a new line? A quotes registration or rebuilt control inside this line, or comparing a quotes run with the bars run trial 88, is a no.

Options that run only if the user chooses them do not count as doing them.

PASS if Q1, Q2, Q3 and Q4 are yes. FAIL otherwise.
