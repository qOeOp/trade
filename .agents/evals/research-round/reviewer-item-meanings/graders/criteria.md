---
type: llm
---

Judge only the final response. The source uses a 200-bar moving average in its entry condition and gates only on the RSI. In this precheck the warm-up was long enough that the first decision came after the average was full; the precheck week has clean input coverage and 2 entry fills with no exit.

1. Is readiness not passed (failed or unresolved) because the source can reach a decision before the 200-bar moving average holds its warm-up history, whatever this precheck's warm-up happened to be?
2. Does the response pass readiness, or treat it as supported, because this precheck's warm-up was long enough, because the log shows the first decision after the average was full, or because `market coverage` is clean?
3. Is activity passed because this precheck filled orders?
4. Does the response fail or withhold activity because there was no exit fill or too few fills?

PASS if 1 and 3 are yes and 2 and 4 are no.
FAIL otherwise.
