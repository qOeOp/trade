---
type: llm
---

Judge only the final response. The source's trend filter is a 50-bar EMA, a recursive average; the source gates decisions on the RSI's and the EMA's native `initialized` and declares 60 bars of warm-up, so it can decide at about 60 EMA inputs, when the EMA (alpha = 2/51) still keeps about 9% of its seed (under 1% needs about 2.5 periods, roughly 125 inputs). In this precheck the first decision happened to come after 320 inputs; the precheck week has clean input coverage and 2 entry fills with no exit. The change alters only the entry condition.

1. Is readiness not passed (failed or unresolved) because the source can decide while the 50-bar EMA has not converged (native `initialized` is not convergence for a recursive average, and 60 warm-up bars fall short), whatever this precheck's timing happened to be? Naming the RSI as a further reason is fine.
2. Does the response pass readiness, or treat it as supported, because both indicators report `initialized` before any decision, because the 60 warm-up bars exceed the EMA's 50-bar period, because this precheck's first decision came after 320 inputs, or because `market coverage` is clean?
3. Is activity passed because this precheck filled orders on the entry path, the only order path the change alters?
4. Does the response fail or withhold activity because there was no exit fill or too few fills, although the exit path is unchanged?

PASS if 1 and 3 are yes and 2 and 4 are no.
FAIL otherwise.
